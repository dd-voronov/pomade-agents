import type { JsonValue } from "pomade-kit/protocol";
import { describe, expect, it } from "vitest";

import { testSession } from "../shared/test-sessions.ts";
import { EXIT, SHOW_USAGE, USAGE, parseShow, runCli, type CallFailure, type CommandDeps, type Link } from "./cli.ts";

const SESSION = testSession({ id: "s1", record: { id: "s1", provider: "claude-code", agent: "claude", name: "G4 tickets", status: "done" } });

type Answer = unknown | CallFailure;
const fail = (code: string, message = "words"): CallFailure => ({ code, message });
const isFailure = (a: Answer): a is CallFailure => typeof a === "object" && a !== null && "code" in a;

interface Run {
  code: number;
  out: string;
  err: string;
  calls: [string, JsonValue][];
  connected: boolean;
  closed: boolean;
}

/** Runs the command against a scripted Pomade: `answers` per method, or how the connection fails. */
async function run(argv: string[], options: { tabId?: string | null; link?: Exclude<Link["status"], "connected">; answers?: Record<string, Answer>; workspace?: string | null } = {}): Promise<Run> {
  const result: Run = { code: -1, out: "", err: "", calls: [], connected: false, closed: false };
  const deps: CommandDeps = {
    out: (text) => (result.out += text),
    err: (text) => (result.err += text),
    tabId: options.tabId === undefined ? "tab-1" : options.tabId,
    workspace: () => (options.workspace === undefined ? "/ws" : options.workspace),
    connect: () => {
      result.connected = true;
      const status = options.link;
      if (status === "not-running") return Promise.resolve({ status });
      if (status === "refused" || status === "no-identity") return Promise.resolve({ status, reason: "unauthorized" });
      return Promise.resolve({
        status: "connected",
        call: (method, params) => {
          result.calls.push([method, params]);
          const answer = options.answers?.[method];
          return isFailure(answer) ? Promise.reject(answer) : Promise.resolve(answer);
        },
        projectNames: () => Promise.resolve(new Map([["alpha", "Alpha"]])),
        close: () => {
          result.closed = true;
        },
      });
    },
  };
  result.code = await runCli(argv, deps);
  return result;
}

describe("show's options", () => {
  it.each<[string[], ReturnType<typeof parseShow>]>([
    [[], { session: null, json: false, help: false }],
    [["--json"], { session: null, json: true, help: false }],
    [["--session", "abc", "--json"], { session: "abc", json: true, help: false }],
    [["--session=abc"], { session: "abc", json: false, help: false }],
    [["-h"], { session: null, json: false, help: true }],
  ])("reads %j", (args, options) => {
    expect(parseShow(args)).toEqual(options);
  });

  it.each<[string[], string]>([
    [["--session"], "--session needs a session id"],
    [["--session="], "--session needs a session id"],
    [["--session", "--json"], "--session needs a session id"],
    [["--session", "a", "--session", "b"], "--session is given twice"],
    [["--name", "x"], "unknown option --name"],
    [["abc"], 'show takes no argument (got "abc")'],
  ])("refuses %j as usage", async (args, problem) => {
    const r = await run(["show", ...args]);
    expect(r).toMatchObject({ code: EXIT.usage, out: "", connected: false });
    expect(r.err).toBe(`pomade-agents: ${problem}. Run "pomade-agents show --help" for usage.\n`);
  });
});

describe("the pomade-agents command", () => {
  it("prints usage for --help, and refuses no command, an unknown one and set-status as usage", async () => {
    expect(await run(["--help"])).toMatchObject({ code: 0, out: USAGE, err: "" });
    expect(await run(["show", "--help"])).toMatchObject({ code: 0, out: SHOW_USAGE, err: "", connected: false });
    for (const [argv, problem] of [
      [[], "no command given"],
      [["set-status", "done"], 'unknown command "set-status"'],
      [["--json"], "unknown option --json"],
    ] as const) {
      const r = await run([...argv]);
      expect(r).toMatchObject({ code: EXIT.usage, out: "", err: `pomade-agents: ${problem}. Run "pomade-agents --help" for usage.\n` });
    }
    expect(USAGE).not.toMatch(/set-status|set-name|set-note/);
  });

  it("shows the session of the calling terminal's tab as one JSON document, the shape sessions.get answers", async () => {
    const r = await run(["show", "--json"], { answers: { "sessions.ofTab": { agentTab: true, session: SESSION } } });
    expect(r).toMatchObject({ code: 0, err: "", calls: [["sessions.ofTab", { tabId: "tab-1" }]], closed: true });
    expect(JSON.parse(r.out)).toEqual(SESSION);
    expect(r.out.endsWith("}\n")).toBe(true);
  });

  it("shows the session --session names, in or out of a Pomade terminal, as text by default", async () => {
    const r = await run(["show", "--session", "s1"], { tabId: null, answers: { "sessions.get": { session: SESSION } } });
    expect(r).toMatchObject({ code: 0, err: "", calls: [["sessions.get", { id: "s1" }]], closed: true });
    expect(r.out.split("\n")[0]).toBe("G4 tickets");
    expect(r.out).toContain("status        Done\n");
  });

  it.each<[string, string[], Parameters<typeof run>[1], number, string]>([
    ["not in a Pomade terminal", ["show"], { tabId: null }, EXIT.noTab, "not in a Pomade terminal (POMADE_TAB_ID is not set) — name the session with --session <id>."],
    ["Pomade closed", ["show"], { link: "not-running" }, EXIT.pomadeClosed, "Pomade is not running — open Pomade and run it again. The session records are files in /ws/Apps/pomade-agents/sessions/ (the pomade-agents-sessions skill describes them)."],
    ["Pomade closed, no workspace recorded", ["show"], { link: "not-running", workspace: null }, EXIT.pomadeClosed, "Pomade is not running — open Pomade and run it again. The session records are files in <workspace>/Apps/pomade-agents/sessions/ (the pomade-agents-sessions skill describes them)."],
    ["Pomade refused it", ["show"], { link: "refused" }, EXIT.failed, "Pomade refused the command (unauthorized) — install the Agents app again, or update Pomade."],
    ["not run through the shim", ["show"], { link: "no-identity" }, EXIT.failed, "not started through Pomade's command folder (unauthorized) — run it in a Pomade terminal, or with Pomade's commands on PATH."],
    ["the backend absent", ["show"], { answers: { "sessions.ofTab": fail("app-absent", 'The app "pomade-agents" is not running') } }, EXIT.backendDown, `the Agents app's background part is not answering (app-absent: The app "pomade-agents" is not running) — it runs while Pomade runs; Pomade restarts it, so try again in a moment.`],
    ["the backend not answering", ["show", "--session", "s1"], { answers: { "sessions.get": fail("app-not-responding", "no answer") } }, EXIT.backendDown, "the Agents app's background part is not answering (app-not-responding: no answer) — it runs while Pomade runs; Pomade restarts it, so try again in a moment."],
    ["a plain terminal", ["show"], { answers: { "sessions.ofTab": { agentTab: false, session: null } } }, EXIT.noSessionInTab, "this terminal's tab runs no agent — it is not an agent tab. Run it in an agent's tab, or name the session with --session <id>."],
    ["an agent tab not prompted", ["show", "--json"], { answers: { "sessions.ofTab": { agentTab: true, session: null } } }, EXIT.noSessionInTab, "the agent in this tab has no session yet — it starts one with its first prompt. Or name a session with --session <id>."],
    ["an unknown session", ["show", "--session", "ghost"], { answers: { "sessions.get": fail("not-found") } }, EXIT.unknownSession, 'no session "ghost" — the app knows no transcript with this id.'],
    ["another refusal", ["show", "--session", "s1"], { answers: { "sessions.get": fail("invalid-params", "bad") } }, EXIT.failed, "the Agents app refused the call (invalid-params: bad)."],
    ["a malformed answer", ["show"], { answers: { "sessions.ofTab": { agentTab: "yes" } } }, EXIT.failed, "the Agents app answered sessions.ofTab with something this command does not read — the app and the command are out of step; install the app again."],
  ])("fails with one line and its own status: %s", async (_case, argv, options, code, line) => {
    const r = await run(argv, options);
    expect(r).toMatchObject({ code, out: "", err: `pomade-agents: ${line}\n` });
    if (r.connected && options?.link === undefined) expect(r.closed).toBe(true);
  });

  it("asks nothing when it has no tab to ask about, even with Pomade closed", async () => {
    expect(await run(["show", "--json"], { tabId: null, link: "not-running" })).toMatchObject({ code: EXIT.noTab, connected: false });
  });

  it("gives every failure its own exit status", () => {
    expect(new Set(Object.values(EXIT)).size).toBe(Object.keys(EXIT).length);
  });
});
