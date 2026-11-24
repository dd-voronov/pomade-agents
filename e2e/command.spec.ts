// The built `pomade-agents` command run as Pomade's shim runs it — a child process with the
// environment a shim and a Pomade terminal give it, finding the socket through `POMADE_HOME` —
// against the fake Pomade and the real backend (DESIGN §7, CONTRACTS "Command"): `show` answers the
// session of the agent tab it runs in, or the one `--session` names, and every failure is one line
// on stderr with its own exit status.

import { BUILT_COMMAND } from "../harness/app.ts";
import { runCommand, shimEnv, shimHome, type CommandRun } from "../harness/command-process.ts";
import type { FakePomade } from "../harness/fake-pomade.ts";
import type { Sandbox } from "../harness/sandbox.ts";
import { SESSIONS_GET_METHOD, isSessionsGetResult, type Session } from "../src/shared/sessions.ts";
import { expect, test } from "./fixtures.ts";

/** The seeded Claude Code session (`harness/fixtures/transcripts/claude-session.jsonl`). */
const CLAUDE = "5b0e8f52-3c1d-4a7e-9f21-6d8c0b4a7e13";
/** The seeded Codex session. */
const CODEX = "019a7c3e-5b2d-7f10-8c4e-1d2f3a4b5c6d";

test.use({
  pomadeSeed: {
    agentTabs: [
      { tabId: "tab-claude", projectId: "alpha", agentId: "claude", sessionId: CLAUDE, state: "idle" },
      { tabId: "tab-codex", projectId: "beta", agentId: "codex", sessionId: CODEX, state: "working" },
      { tabId: "tab-fresh", projectId: "alpha", agentId: "claude", sessionId: null, state: "idle" },
    ],
  },
});

/** The session as the backend answers it once its record is written (the first run adopts it) and its tab is bound. */
async function recorded(pomade: FakePomade, id: string): Promise<Session> {
  const read = async (): Promise<Session | null> => {
    const answer = await pomade.fake.callApi(SESSIONS_GET_METHOD, { id }).catch(() => null);
    return isSessionsGetResult(answer) && answer.session.record !== null && answer.session.tab !== null ? answer.session : null;
  };
  await expect.poll(async () => (await read()) !== null, { timeout: 10_000 }).toBe(true);
  const session = await read();
  if (session === null) throw new Error(`session ${id} went away`);
  return session;
}

/** Runs the built command as the shim does, in the terminal of `tabId` (`null`: outside Pomade's terminals). */
async function command(sandbox: Sandbox, appId: string, args: string[], tabId: string | null = "tab-claude", env: Record<string, string | undefined> = {}): Promise<CommandRun> {
  const terminal = tabId === null ? null : { tabId, projectId: "alpha" };
  return runCommand(BUILT_COMMAND, args, { ...shimEnv(sandbox, appId, await shimHome(sandbox), terminal), ...env });
}

test("show --json in an agent tab prints that tab's session, as sessions.get answers it", async ({ backend, pomade, sandbox, manifest }) => {
  const expected = await recorded(pomade, CLAUDE);
  const run = await command(sandbox, manifest.id, ["show", "--json"]);
  expect(run, backend.output()).toMatchObject({ code: 0, stderr: "" });
  const printed = JSON.parse(run.stdout) as Session;
  expect(printed.id).toBe(CLAUDE);
  expect(printed.tab).toEqual({ tabId: "tab-claude", projectId: "alpha" });
  expect(printed.record).toMatchObject({ id: CLAUDE, status: "done", agent: "claude" });
  expect(printed).toEqual({ ...expected, live: printed.live, liveSince: printed.liveSince });

  const other = await command(sandbox, manifest.id, ["show", "--json"], "tab-codex");
  expect(other.code).toBe(0);
  expect(JSON.parse(other.stdout)).toMatchObject({ id: CODEX, live: "working", tab: { tabId: "tab-codex", projectId: "beta" } });
});

test("show --session names any session, outside Pomade's terminals too, and prints text without --json", async ({ backend, pomade, sandbox, manifest }) => {
  await recorded(pomade, CODEX);
  const json = await command(sandbox, manifest.id, ["show", "--session", CODEX, "--json"], null);
  expect(json, backend.output()).toMatchObject({ code: 0, stderr: "" });
  expect(JSON.parse(json.stdout)).toMatchObject({ id: CODEX, summary: { provider: "codex" } });

  const text = await command(sandbox, manifest.id, ["show", `--session=${CODEX}`], null);
  expect(text).toMatchObject({ code: 0, stderr: "" });
  const lines = text.stdout.split("\n");
  expect(lines[0]).toBe("Unnamed session");
  expect(lines).toContain("status        Done");
  expect(text.stdout).toMatch(/^live {10}Working since \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/m);
  expect(lines).toContain(`id            ${CODEX}`);
  expect(text.stdout).not.toContain("\u001b");
});

test.describe("failures: one line on stderr and the exit status of each case", () => {
  test("a tab with no session: an agent tab not prompted yet, a plain terminal; and an unknown session id", async ({ backend, pomade, sandbox, manifest }) => {
    await recorded(pomade, CLAUDE);
    const fresh = await command(sandbox, manifest.id, ["show"], "tab-fresh");
    expect(fresh, backend.output()).toEqual({ code: 6, stdout: "", stderr: "pomade-agents: the agent in this tab has no session yet — it starts one with its first prompt. Or name a session with --session <id>.\n" });
    const plain = await command(sandbox, manifest.id, ["show", "--json"], "tab-plain-terminal");
    expect(plain).toEqual({ code: 6, stdout: "", stderr: "pomade-agents: this terminal's tab runs no agent — it is not an agent tab. Run it in an agent's tab, or name the session with --session <id>.\n" });
    const ghost = await command(sandbox, manifest.id, ["show", "--session", "ghost"]);
    expect(ghost).toEqual({ code: 7, stdout: "", stderr: 'pomade-agents: no session "ghost" — the app knows no transcript with this id.\n' });
  });

  test("not in a Pomade terminal, and usage", async ({ sandbox, manifest }) => {
    expect(await command(sandbox, manifest.id, ["show"], null)).toEqual({ code: 5, stdout: "", stderr: "pomade-agents: not in a Pomade terminal (POMADE_TAB_ID is not set) — name the session with --session <id>.\n" });
    const usage = await command(sandbox, manifest.id, ["set-status", "done"]);
    expect(usage).toEqual({ code: 2, stdout: "", stderr: 'pomade-agents: unknown command "set-status". Run "pomade-agents --help" for usage.\n' });
    const help = await command(sandbox, manifest.id, ["--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("show [--session <id>] [--json]");
  });

  test("the app's backend not answering", async ({ pomade, sandbox, manifest }) => {
    expect(pomade.backendCount()).toBe(0);
    const run = await command(sandbox, manifest.id, ["show"]);
    expect(run).toMatchObject({ code: 4, stdout: "" });
    expect(run.stderr).toMatch(/^pomade-agents: the Agents app's background part is not answering \(app-absent: .+\) — it runs while Pomade runs; Pomade restarts it, so try again in a moment\.\n$/);
  });

  test("Pomade closed: the line says where the record files are", async ({ pomade, sandbox, manifest }) => {
    await pomade.close();
    const run = await command(sandbox, manifest.id, ["show", "--json"]);
    expect(run).toEqual({
      code: 3,
      stdout: "",
      stderr: `pomade-agents: Pomade is not running — open Pomade and run it again. The session records are files in ${sandbox.workspace}/Apps/pomade-agents/sessions/ (the pomade-agents-sessions skill describes them).\n`,
    });
  });

  test("not started through Pomade's shim, and a key Pomade did not issue", async ({ pomade, sandbox, manifest }) => {
    expect(pomade.backendCount()).toBe(0);
    const bare = await command(sandbox, manifest.id, ["show"], "tab-claude", { POMADE_APP_ID: undefined });
    expect(bare.code).toBe(1);
    expect(bare.stderr).toMatch(/^pomade-agents: not started through Pomade's command folder \(.+\) — run it in a Pomade terminal, or with Pomade's commands on PATH\.\n$/);
    const wrongKey = await command(sandbox, manifest.id, ["show"], "tab-claude", { POMADE_APP_KEY_FILE: `${sandbox.home}/.zshrc` });
    expect(wrongKey).toEqual({ code: 1, stdout: "", stderr: "pomade-agents: Pomade refused the command (unauthorized) — install the Agents app again, or update Pomade.\n" });
  });
});
