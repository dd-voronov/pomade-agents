import { HostError } from "pomade-kit/sdk";
import { describe, expect, it } from "vitest";

import type { Session } from "../../shared/sessions.ts";
import { testSession, testSummary } from "../../shared/test-sessions.ts";
import type { LiveEntry } from "./live-state.ts";
import { openSession, type OpenHost, type OpenSources } from "./open.ts";

const WS = "/ws";

function setup(session: Session, options: { entries?: LiveEntry[]; agents?: Record<string, { orphan: boolean }>; host?: Partial<OpenHost>; workspace?: string | null } = {}) {
  const calls: unknown[][] = [];
  let current = session;
  const host: OpenHost = {
    focus: (tabId) => {
      calls.push(["focus", tabId]);
      return Promise.resolve();
    },
    resume: (params) => {
      calls.push(["resume", params]);
      return Promise.resolve({ tabId: "new-tab" });
    },
    openAttached: (params) => {
      calls.push(["openAttached", params]);
      return Promise.resolve();
    },
    ...options.host,
  };
  const agents = options.agents ?? { claude: { orphan: false } };
  const workspace = options.workspace === undefined ? WS : options.workspace;
  const sources: OpenSources = {
    sessions: {
      get: (id) => (id === current.id ? current : undefined),
      changeStatus: (ids, status) => {
        calls.push(["changeStatus", ids, status]);
        if (current.record !== null) current = { ...current, record: { ...current.record, status } };
        return Promise.resolve([current]);
      },
    },
    live: { entries: () => options.entries ?? [] },
    roster: { agent: (id) => (agents[id] === undefined ? undefined : ({ orphan: agents[id].orphan } as never)) },
    workspace,
    workspaceReal: workspace,
    realPath: (p) => Promise.resolve(p),
    log: (line) => calls.push(["log", line]),
  };
  return { calls, open: (id = session.id) => openSession(id, host, sources) };
}

const done = (patch: Partial<Session> = {}): Session =>
  testSession({
    id: "s1",
    summary: testSummary({ id: "s1", cwd: `${WS}/Projects/alpha/sub` }),
    record: { id: "s1", provider: "claude-code", agent: "claude", status: "done" },
    attribution: { projects: ["alpha"], by: "folder", sharedFolder: false },
    ...patch,
  });

const run = (patch: Partial<LiveEntry> = {}): LiveEntry => ({
  source: "run",
  key: "job\0r1",
  sessionId: "s1",
  agent: "claude",
  cwd: `${WS}/Projects/alpha`,
  projectId: "alpha",
  state: "working",
  job: "Nightly",
  terminal: "run:job:r1",
  since: "2026-11-21T10:00:00.000Z",
  ...patch,
});

describe("Open / Resume", () => {
  it("resumes a session without a tab in its project and start folder, and sets a Done one Active", async () => {
    const { calls, open } = setup(done());
    const result = await open();
    expect(calls).toEqual([
      ["resume", { agentId: "claude", sessionId: "s1", projectId: "alpha", cwd: "Projects/alpha/sub" }],
      ["changeStatus", ["s1"], "active"],
    ]);
    expect(result).toMatchObject({ opened: "resumed", tabId: "new-tab", session: { record: { status: "active" } } });
  });

  it("leaves an Active session's status alone, and resumes in the Workspace project at the workspace's root", async () => {
    const { calls, open } = setup(
      done({
        summary: testSummary({ id: "s1", cwd: WS }),
        record: { id: "s1", provider: "claude-code", agent: "claude", status: "active" },
        attribution: { projects: [], by: "workspace", sharedFolder: false },
      }),
    );
    await open();
    expect(calls).toEqual([["resume", { agentId: "claude", sessionId: "s1", projectId: "__workspace__", cwd: "" }]]);
  });

  it("resumes without a folder when none is recorded, and without a status change when there is no record", async () => {
    const { calls, open } = setup(done({ summary: testSummary({ id: "s1", cwd: null }), record: null }));
    await open();
    expect(calls).toEqual([["resume", { agentId: "claude", sessionId: "s1", projectId: "alpha" }]]);
  });

  it("focuses the tab bound to the session: no second tab, no status change", async () => {
    const { calls, open } = setup(done({ tab: { tabId: "t7", projectId: "beta" }, live: "idle" }));
    expect(await open()).toMatchObject({ opened: "tab", tabId: "t7" });
    expect(calls).toEqual([["focus", "t7"]]);
  });

  it("focuses the tab bound to a session with no messages yet (a fresh /clear)", async () => {
    const { calls, open } = setup(done({ tab: { tabId: "t7", projectId: "alpha" }, hidden: "empty" }));
    expect(await open()).toMatchObject({ opened: "tab" });
    expect(calls).toEqual([["focus", "t7"]]);
  });

  it("resumes when the bound tab closed meanwhile", async () => {
    const { calls, open } = setup(done({ tab: { tabId: "t7", projectId: "beta" } }), {
      host: { focus: () => Promise.reject(new HostError("not-found", "No agent tab")) },
    });
    expect(await open()).toMatchObject({ opened: "resumed" });
    expect(calls.map((c) => c[0])).toEqual(["resume", "changeStatus"]);
  });

  it("opens a Runner run's terminal instead of a second agent on the transcript", async () => {
    const { calls, open } = setup(done({ live: "working" }), { entries: [run()] });
    expect(await open()).toMatchObject({ opened: "run", tabId: null });
    expect(calls).toEqual([["openAttached", { session: { app: "pomade-runner", session: "run:job:r1" }, title: "Nightly", projectId: "alpha" }]]);
  });

  it.each<[string, Parameters<typeof setup>, string, string]>([
    ["a session no transcript is known of", [done()], "not-found", "Its transcript is gone."],
    ["an agent not in the roster", [done(), { agents: {} }], "not-found", "Its agent “claude” is not in the roster."],
    ["an orphan agent", [done(), { agents: { claude: { orphan: true } } }], "not-found", "Its agent “claude” is not in the roster."],
    ["a start folder outside the workspace", [done({ summary: testSummary({ id: "s1", cwd: "/elsewhere/x" }) })], "outside-workspace", "It started outside the workspace, in /elsewhere/x; Pomade resumes sessions only inside it."],
    ["a start folder beside the workspace", [done({ summary: testSummary({ id: "s1", cwd: "/ws-other" }) })], "outside-workspace", "It started outside the workspace, in /ws-other; Pomade resumes sessions only inside it."],
    ["a session with no messages", [done({ hidden: "empty" })], "not-found", "It holds no messages, so there is nothing to resume."],
    ["no workspace", [done(), { workspace: null }], "not-ready", "No workspace is open in Pomade."],
    ["a run whose terminal is not known", [done(), { entries: [run({ terminal: null })] }], "not-ready", "It runs unattended in Runner job “Nightly”, and Runner did not say which terminal it runs in."],
    [
      "Pomade's refusal",
      [done(), { host: { resume: () => Promise.reject(new HostError("not-found", "No session in Projects/alpha/sub")) } }],
      "not-found",
      "Pomade did not find it in its agent's store — No session in Projects/alpha/sub",
    ],
  ])("refuses %s and changes nothing", async (what, args, code, text) => {
    const { calls, open } = setup(...args);
    const failed = await open(what === "a session no transcript is known of" ? "gone" : "s1").catch((err: unknown) => err);
    expect(failed).toBeInstanceOf(HostError);
    expect(failed).toMatchObject({ code, message: text });
    expect(calls.filter((c) => c[0] === "changeStatus")).toEqual([]);
  });

  it("still answers the resume when the status cannot be set, and logs it", async () => {
    const calls: string[] = [];
    const result = await openSession("s1", { focus: () => Promise.resolve(), resume: () => Promise.resolve({ tabId: "t" }), openAttached: () => Promise.resolve() }, {
      sessions: { get: () => done(), changeStatus: () => Promise.reject(new Error("EACCES")) },
      live: { entries: () => [] },
      roster: { agent: () => ({ orphan: false }) as never },
      workspace: WS,
      workspaceReal: WS,
      realPath: (p) => Promise.resolve(p),
      log: (line) => calls.push(line),
    });
    expect(result.opened).toBe("resumed");
    expect(calls).toEqual(["sessions: resumed s1 but could not set it Active: EACCES"]);
  });
});
