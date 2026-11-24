import { HostError } from "pomade-kit/sdk";
import { describe, expect, it } from "vitest";

import type { AgentProfile, RosterEntry } from "../../shared/roster.ts";
import { testSession, testSummary } from "../../shared/test-sessions.ts";
import { createApi, type ApiSources } from "./api.ts";

const ANSWER = { text: "Done.\n\n- one\n- two", at: "2026-11-17T10:04:00.000Z" };
const LISTED = [
  testSession({ id: "a", summary: testSummary({ id: "a", cwd: "/w/repo", branch: "main", lastAnswer: ANSWER }) }),
  testSession({ id: "b", summary: testSummary({ id: "b", cwd: "/w/repo", startedAt: "2026-11-17T09:00:00.000Z" }) }),
];

const PROFILE: AgentProfile = {
  id: "claude",
  provider: "claude",
  kind: "builtin",
  configDir: "~/.claude",
  command: "claude",
  tags: [],
  hidden: false,
  modes: { normal: { enabled: true }, "full-autonomy": { enabled: true } },
};
const AGENTS: Record<string, { profile: AgentProfile; orphan: boolean }> = {
  claude: { profile: PROFILE, orphan: false },
  codex: { profile: { ...PROFILE, id: "codex", provider: "codex", configDir: "~/.codex", command: "codex" }, orphan: false },
  locked: { profile: { ...PROFILE, id: "locked", kind: "folder", command: "locked", modes: { normal: { enabled: true }, "full-autonomy": { enabled: false } } }, orphan: false },
  quiet: { profile: { ...PROFILE, id: "quiet", kind: "folder", command: "quiet", hidden: true }, orphan: false },
  gone: { profile: { ...PROFILE, id: "gone", kind: "folder", command: "gone" }, orphan: true },
};
/** Agent tabs: one bound to a listed session, one not prompted yet, one bound to a session with no transcript known. */
const TABS: Record<string, { sessionId: string | null }> = { bound: { sessionId: "a" }, fresh: { sessionId: null }, early: { sessionId: "ghost" } };
const LISTED_AGENTS = ["claude", "codex", "locked"];
const VISIBLE: Record<string, string[]> = { alpha: ["*"], beta: ["codex", "quiet", "ghost"], gamma: [] };

function api(entries: string[] = [], profilesOff: string | null = null) {
  const calls: unknown[][] = [];
  const sessions: ApiSources["sessions"] = {
    answer: (since) => {
      calls.push(["answer", since]);
      return { epoch: "e", revision: 0, full: true, sessions: LISTED, removed: [], indexing: false, recordsOff: null };
    },
    changeStatus: (ids, status, note) => {
      calls.push(["changeStatus", ids, status, note]);
      return Promise.resolve(ids.map((id) => testSession({ id })));
    },
    rename: (id, name) => {
      calls.push(["rename", id, name]);
      return Promise.resolve(testSession({ id }));
    },
    moveToProject: (id, project) => {
      calls.push(["moveToProject", id, project]);
      return Promise.resolve(testSession({ id }));
    },
    list: () => LISTED,
    get: (id) => LISTED.find((s) => s.id === id),
  };
  const live = { entries: () => [] };
  const info = { version: "0", startedAt: "", workspace: null, workspaceReal: null, dataDir: null, stateDir: "/s" };
  const roster: ApiSources["roster"] = {
    answer: () => ({ epoch: "r", revision: 1, agents: entries.map((id) => ({ id, name: id }) as RosterEntry), profilesOff }),
    list: () => LISTED_AGENTS.map((id) => ({ id, name: id, command: id, provider: AGENTS[id]?.profile.provider ?? "claude" })),
    agent: (id) => AGENTS[id],
    updateProfile: (id, edit) => {
      calls.push(["updateProfile", id, edit]);
      const agent = AGENTS[id];
      return agent === undefined ? Promise.reject(new HostError("not-found", `No agent ${id}`)) : Promise.resolve({ ...agent.profile, ...(edit.role === undefined || edit.role === null ? {} : { role: edit.role }), tags: edit.tags ?? agent.profile.tags });
    },
    permissions: () => Promise.reject(new HostError("not-found", "not called")),
    memory: () => Promise.reject(new HostError("not-found", "not called")),
    modelConfig: () => Promise.reject(new HostError("not-found", "not called")),
    setModel: (id, change) => {
      calls.push(["setModel", id, change]);
      return AGENTS[id] === undefined
        ? Promise.reject(new HostError("not-found", `No agent ${id}`))
        : Promise.resolve({ provider: "claude", file: "/s.json", exists: true, problem: null, model: change.model ?? null, effort: change.effort ?? null, writable: true });
    },
  };
  const projects: ApiSources["projects"] = {
    projects: () => Promise.resolve(Object.keys(VISIBLE)),
    visibleAgents: (id) => {
      const visible = VISIBLE[id];
      return visible === undefined ? Promise.reject(new HostError("not-found", `No project ${id}`)) : Promise.resolve(visible);
    },
  };
  const tabs: ApiSources["tabs"] = { ofTab: (tabId) => TABS[tabId] ?? null };
  return { handlers: createApi({ info, sessions, live, tabs, liveNow: { answer: () => ({ epoch: "l", revision: 0, rows: [] }) }, realPath: (p) => Promise.resolve(p), roster, projects, open: (id) => {
    calls.push(["open", id]);
    return Promise.resolve({ opened: "resumed", tabId: "t1", session: testSession({ id }) });
  }, skills: { read: () => Promise.reject(new Error("not called")), setFolders: () => Promise.reject(new Error("not called")), link: (agent, name, target) => {
    calls.push(["link", agent, name, target]);
    return Promise.resolve({ ok: false, reason: "stub" });
  }, unlink: (agent, name) => {
    calls.push(["unlink", agent, name]);
    return Promise.resolve({ ok: false, reason: "stub" });
  } } }), calls };
}

const call = (method: string, params: unknown): unknown => {
  const { handlers } = api();
  const handler = handlers[method];
  if (!handler) throw new Error(`no ${method}`);
  return handler(params as never, { from: "pomade-agents" });
};

describe("the API's params", () => {
  it("passes well-formed changes on and answers the changed sessions", async () => {
    const { handlers, calls } = api();
    const ctx = { from: "pomade-agents" };
    expect(await handlers["sessions.setStatus"]?.({ ids: ["a", "b", "a"], status: "on-hold", note: "why" }, ctx)).toMatchObject({ sessions: [{ id: "a" }, { id: "b" }] });
    await handlers["sessions.setStatus"]?.({ ids: ["a"], status: "done" }, ctx);
    await handlers["sessions.setStatus"]?.({ ids: ["a"], status: "done", note: null }, ctx);
    expect(await handlers["sessions.rename"]?.({ id: "a", name: null }, ctx)).toMatchObject({ sessions: [{ id: "a" }] });
    await handlers["sessions.moveToProject"]?.({ id: "a", project: "__workspace__" }, ctx);
    expect(await handlers["sessions.open"]?.({ id: "a" }, ctx)).toMatchObject({ opened: "resumed", tabId: "t1", session: { id: "a" } });
    await handlers["sessions.list"]?.({ since: { epoch: "e", revision: 3 } }, ctx);
    await handlers["sessions.list"]?.({ since: { epoch: "e", revision: -1 } }, ctx);
    expect(calls).toEqual([
      ["changeStatus", ["a", "b"], "on-hold", "why"],
      ["changeStatus", ["a"], "done", undefined],
      ["changeStatus", ["a"], "done", null],
      ["rename", "a", null],
      ["moveToProject", "a", "__workspace__"],
      ["open", "a"],
      ["answer", { epoch: "e", revision: 3 }],
      ["answer", undefined],
    ]);
  });

  it.each<[string, unknown]>([
    ["sessions.setStatus", null],
    ["sessions.setStatus", { ids: [], status: "done" }],
    ["sessions.setStatus", { ids: ["a", 1], status: "done" }],
    ["sessions.setStatus", { ids: ["a"], status: "finished" }],
    ["sessions.setStatus", { ids: ["a"], status: "done", note: "two\nlines" }],
    ["sessions.setStatus", { ids: ["a"], status: "done", note: "x".repeat(501) }],
    ["sessions.rename", { id: "a" }],
    ["sessions.open", { id: "" }],
    ["sessions.open", null],
    ["sessions.rename", { id: "", name: "x" }],
    ["sessions.rename", { id: "a", name: "x".repeat(201) }],
    ["sessions.moveToProject", { id: "a" }],
    ["sessions.moveToProject", { id: "a", project: "" }],
  ])("refuses %s with %j as invalid-params", (method, params) => {
    expect(() => call(method, params)).toThrow(expect.objectContaining({ code: "invalid-params" }));
  });

  it("answers git's questions for a well-formed folder and branch", async () => {
    const ctx = { from: "pomade" };
    const { handlers } = api();
    expect(await handlers["sessions.forRepo"]?.({ folder: "/w" }, ctx)).toMatchObject({ sessions: [{ id: "a", cwd: "/w/repo" }, { id: "b" }] });
    expect(await handlers["sessions.forRepo"]?.({ folder: "/w", branch: "other" }, ctx)).toEqual({ sessions: [] });
    expect(await handlers["sessions.liveIn"]?.({ folder: "/w" }, ctx)).toEqual({ live: false, sessions: [] });
  });

  it.each<[string, unknown]>([
    ["sessions.forRepo", null],
    ["sessions.forRepo", {}],
    ["sessions.forRepo", { folder: "relative/path" }],
    ["sessions.forRepo", { folder: "/w", branch: "" }],
    ["sessions.forRepo", { folder: "/w", branch: 3 }],
    ["sessions.liveIn", { folder: 1 }],
    ["sessions.liveIn", { folder: "/w\nx" }],
  ])("refuses %s with %j as invalid-params", async (method, params) => {
    await expect(Promise.resolve().then(() => call(method, params))).rejects.toMatchObject({ code: "invalid-params" });
  });

  it("answers a session, its last answer, and the sessions started in a folder in a window", async () => {
    const ctx = { from: "pomade-runner" };
    const { handlers } = api();
    expect(await handlers["sessions.get"]?.({ id: "a" }, ctx)).toEqual({ session: LISTED[0] });
    expect(await handlers["sessions.lastMessage"]?.({ id: "a" }, ctx)).toEqual({ message: ANSWER });
    expect(await handlers["sessions.lastMessage"]?.({ id: "b" }, ctx)).toEqual({ message: null });
    const window = { cwd: "/w/repo", startedFrom: "2026-11-17T09:00:00.000Z", startedTo: "2026-11-17T10:00:00Z" };
    expect(await handlers["sessions.find"]?.(window, ctx)).toEqual({
      sessions: [
        { id: "b", provider: "claude-code", agent: "claude", cwd: "/w/repo", startedAt: "2026-11-17T09:00:00.000Z", lastActiveAt: "2026-11-17T10:05:00.000Z" },
        { id: "a", provider: "claude-code", agent: "claude", cwd: "/w/repo", startedAt: "2026-11-17T10:00:00.000Z", lastActiveAt: "2026-11-17T10:05:00.000Z" },
      ],
    });
    expect(await handlers["sessions.find"]?.({ ...window, agent: "codex" }, ctx)).toEqual({ sessions: [] });
  });

  it("answers the session an agent tab is bound to; none for an agent tab without one, or a tab that is no agent's", async () => {
    const ctx = { from: "pomade-agents" };
    const { handlers } = api();
    expect(await handlers["sessions.ofTab"]?.({ tabId: "bound" }, ctx)).toEqual({ agentTab: true, session: LISTED[0] });
    expect(await handlers["sessions.ofTab"]?.({ tabId: "fresh" }, ctx)).toEqual({ agentTab: true, session: null });
    expect(await handlers["sessions.ofTab"]?.({ tabId: "early" }, ctx)).toEqual({ agentTab: true, session: null });
    expect(await handlers["sessions.ofTab"]?.({ tabId: "plain-terminal" }, ctx)).toEqual({ agentTab: false, session: null });
  });

  it("answers the agent counts over every session, with the sessions' epoch and revision", async () => {
    const { handlers } = api();
    const answer = await handlers["sessions.agentCounts"]?.({ weekFrom: "2026-11-16T00:00:00.000Z", projectsFrom: "2026-08-18T00:00:00Z" }, { from: "pomade-agents" });
    expect(answer).toEqual({
      epoch: "e",
      revision: 0,
      indexing: false,
      agents: [{ agent: "claude", lastActiveAt: "2026-11-17T10:05:00.000Z", week: { sessions: 2, costUsd: null }, projects: [{ project: "__workspace__", sessions: 2, lastAt: "2026-11-17T10:05:00.000Z" }] }],
    });
  });

  it.each([null, {}, { weekFrom: "2026-11-16T00:00:00Z" }, { weekFrom: "monday", projectsFrom: "2026-08-18T00:00:00Z" }, { weekFrom: 1, projectsFrom: 2 }])(
    "refuses sessions.agentCounts with %j as invalid-params",
    async (params) => {
      await expect(Promise.resolve().then(() => call("sessions.agentCounts", params))).rejects.toMatchObject({ code: "invalid-params" });
    },
  );

  it.each([null, {}, { tabId: "" }, { tabId: 3 }])("refuses sessions.ofTab with %j as invalid-params", async (params) => {
    await expect(Promise.resolve().then(() => call("sessions.ofTab", params))).rejects.toMatchObject({ code: "invalid-params" });
  });

  it.each(["sessions.get", "sessions.lastMessage"])("answers %s for an unknown session as not-found", async (method) => {
    await expect(Promise.resolve().then(() => call(method, { id: "ghost" }))).rejects.toMatchObject({ code: "not-found" });
  });

  const FIND = { cwd: "/w", startedFrom: "2026-11-17T09:00:00Z", startedTo: "2026-11-17T10:00:00Z" };
  it.each<[string, unknown]>([
    ["sessions.get", {}],
    ["sessions.get", { id: "" }],
    ["sessions.lastMessage", null],
    ["sessions.find", { ...FIND, cwd: "w" }],
    ["sessions.find", { ...FIND, cwd: undefined }],
    ["sessions.find", { ...FIND, startedFrom: "yesterday" }],
    ["sessions.find", { ...FIND, startedFrom: "2026-11-17" }],
    ["sessions.find", { ...FIND, startedTo: "2026-13-45T99:00:00Z" }],
    ["sessions.find", { ...FIND, startedFrom: FIND.startedTo, startedTo: FIND.startedFrom }],
    ["sessions.find", { ...FIND, agent: "" }],
    ["sessions.find", { ...FIND, agent: 1 }],
  ])("refuses %s with %j as invalid-params", async (method, params) => {
    await expect(Promise.resolve().then(() => call(method, params))).rejects.toMatchObject({ code: "invalid-params" });
  });
});

describe("the roster API", () => {
  const ctx = { from: "pomade-runner" };
  const spec = async (params: unknown): Promise<unknown> => api().handlers["roster.launchSpec"]?.(params as never, ctx);

  it("answers a launch spec per mode, new, with a session id, resuming, with a prompt", async () => {
    expect(await spec({ agent: "claude", mode: "normal" })).toEqual({ command: "claude", args: [], line: "claude", sessionId: null, exit: "/exit" });
    expect(await spec({ agent: "claude", mode: "full-autonomy", resume: "abc-1" })).toEqual({
      command: "claude",
      args: ["--dangerously-skip-permissions", "--resume", "abc-1"],
      line: "claude --dangerously-skip-permissions --resume abc-1",
      sessionId: "abc-1",
      exit: "/exit",
    });
    const id = "0b9c5d4e-1f2a-4b3c-8d4e-5f6a7b8c9d0e";
    expect(await spec({ agent: "claude", mode: "normal", sessionId: id, prompt: "it's $HOME" })).toMatchObject({
      args: ["--session-id", id, "it's $HOME"],
      line: `claude --session-id ${id} 'it'\\''s $HOME'`,
      sessionId: id,
    });
    expect(await spec({ agent: "codex", mode: "full-autonomy", resume: "019a", prompt: "-v please" })).toMatchObject({
      args: ["--dangerously-bypass-approvals-and-sandbox", "resume", "019a", "--", "-v please"],
      sessionId: "019a",
    });
    expect(await spec({ agent: "codex", mode: "normal", sessionId: id })).toMatchObject({ args: [], sessionId: null });
    expect(await spec({ agent: "quiet", mode: "normal" })).toMatchObject({ command: "quiet" });
  });

  it.each<[string, unknown]>([
    ["no params", null],
    ["no agent", { mode: "normal" }],
    ["no mode", { agent: "claude" }],
    ["an unknown mode", { agent: "claude", mode: "turbo" }],
    ["a disabled mode", { agent: "locked", mode: "full-autonomy" }],
    ["resume and sessionId", { agent: "claude", mode: "normal", resume: "a", sessionId: "0b9c5d4e-1f2a-4b3c-8d4e-5f6a7b8c9d0e" }],
    ["a sessionId that is not a UUID", { agent: "claude", mode: "normal", sessionId: "abc" }],
    ["a resume id with a space", { agent: "claude", mode: "normal", resume: "a b" }],
    ["an empty prompt", { agent: "claude", mode: "normal", prompt: "  " }],
    ["a prompt with a NUL", { agent: "claude", mode: "normal", prompt: "a\0b" }],
    ["a prompt too long", { agent: "claude", mode: "normal", prompt: "x".repeat(16385) }],
  ])("refuses a launch spec with %s as invalid-params", async (_, params) => {
    await expect(Promise.resolve().then(() => spec(params))).rejects.toMatchObject({ code: "invalid-params" });
  });

  it.each(["ghost", "gone"])("refuses a launch spec for %s, not in the roster, as not-found", async (agent) => {
    await expect(Promise.resolve().then(() => spec({ agent, mode: "normal" }))).rejects.toMatchObject({ code: "not-found" });
  });

  it("takes a role and tags edit to the roster, trimmed, and answers the profile as written", async () => {
    const { handlers, calls } = api();
    const update = (params: unknown): unknown => handlers["roster.updateProfile"]?.(params as never, ctx);
    expect(await update({ agent: "claude", role: "  Reviews code.  ", tags: [" a ", "b"] })).toEqual({ profile: { ...PROFILE, role: "Reviews code.", tags: ["a", "b"] } });
    expect(calls.at(-1)).toEqual(["updateProfile", "claude", { role: "Reviews code.", tags: ["a", "b"] }]);
    expect(await update({ agent: "claude", role: null })).toMatchObject({ profile: { id: "claude" } });
    expect(calls.at(-1)).toEqual(["updateProfile", "claude", { role: null }]);
    await expect(Promise.resolve().then(() => update({ agent: "ghost", tags: [] }))).rejects.toMatchObject({ code: "not-found" });
  });

  it.each<[string, unknown]>([
    ["no agent", { role: "x" }],
    ["nothing to change", { agent: "claude" }],
    ["a role of two lines", { agent: "claude", role: "a\nb" }],
    ["a blank role", { agent: "claude", role: "   " }],
    ["a role that is not text", { agent: "claude", role: 3 }],
    ["tags that are not a list", { agent: "claude", tags: "a" }],
    ["a tag too long", { agent: "claude", tags: ["x".repeat(25)] }],
    ["a repeated tag", { agent: "claude", tags: ["a", " a"] }],
    ["a blank tag", { agent: "claude", tags: [""] }],
  ])("refuses a profile edit with %s as invalid-params", async (_, params) => {
    await expect(Promise.resolve().then(() => api().handlers["roster.updateProfile"]?.(params as never, ctx))).rejects.toMatchObject({ code: "invalid-params" });
  });

  it("takes a mode switch to the roster with the profile edit", async () => {
    const { handlers, calls } = api();
    await handlers["roster.updateProfile"]?.({ agent: "claude", modes: { "full-autonomy": false } }, ctx);
    expect(calls.at(-1)).toEqual(["updateProfile", "claude", { modes: { "full-autonomy": false } }]);
  });

  it.each<[string, unknown]>([
    ["Normal switched off", { agent: "claude", modes: { normal: false } }],
    ["an unknown mode", { agent: "claude", modes: { yolo: true } }],
    ["a mode that is not on or off", { agent: "claude", modes: { "full-autonomy": "no" } }],
    ["no mode", { agent: "claude", modes: {} }],
  ])("refuses a modes edit with %s as invalid-params", async (_, params) => {
    await expect(Promise.resolve().then(() => api().handlers["roster.updateProfile"]?.(params as never, ctx))).rejects.toMatchObject({ code: "invalid-params" });
  });

  it("takes a model and effort change to the roster; null removes a key", async () => {
    const { handlers, calls } = api();
    const set = (params: unknown): unknown => handlers["roster.setModel"]?.(params as never, ctx);
    expect(await set({ agent: "claude", effort: "high" })).toMatchObject({ effort: "high" });
    expect(calls.at(-1)).toEqual(["setModel", "claude", { effort: "high" }]);
    await set({ agent: "claude", model: "claude-opus-4-8[1m]", effort: null });
    expect(calls.at(-1)).toEqual(["setModel", "claude", { model: "claude-opus-4-8[1m]", effort: null }]);
    await set({ agent: "claude", model: null });
    expect(calls.at(-1)).toEqual(["setModel", "claude", { model: null }]);
    await expect(Promise.resolve().then(() => set({ agent: "ghost", model: "opus" }))).rejects.toMatchObject({ code: "not-found" });
  });

  it.each<[string, unknown]>([
    ["no agent", { model: "opus" }],
    ["nothing to change", { agent: "claude" }],
    ["an unknown effort", { agent: "claude", effort: "max!" }],
    ["a model of two lines", { agent: "claude", model: "opus\nx" }],
    ["a model with a space", { agent: "claude", model: "opus x" }],
    ["a blank model", { agent: "claude", model: "" }],
    ["a model too long", { agent: "claude", model: "o".repeat(129) }],
  ])("refuses a model change with %s as invalid-params", async (_, params) => {
    await expect(Promise.resolve().then(() => api().handlers["roster.setModel"]?.(params as never, ctx))).rejects.toMatchObject({ code: "invalid-params" });
  });

  it("answers the connection: a project's offered agents, an agent's projects", async () => {
    const { handlers } = api();
    const agentsFor = (project: string): unknown => handlers["roster.agentsFor"]?.({ project }, ctx);
    const projectsFor = (agent: string): unknown => handlers["roster.projectsFor"]?.({ agent }, ctx);
    expect(await agentsFor("alpha")).toEqual({ agents: LISTED_AGENTS });
    expect(await agentsFor("beta")).toEqual({ agents: ["codex"] });
    expect(await agentsFor("gamma")).toEqual({ agents: [] });
    expect(await agentsFor("__workspace__")).toEqual({ agents: LISTED_AGENTS });
    await expect(Promise.resolve().then(() => agentsFor("nowhere"))).rejects.toMatchObject({ code: "not-found" });
    expect(await projectsFor("claude")).toEqual({ projects: ["alpha"] });
    expect(await projectsFor("codex")).toEqual({ projects: ["alpha", "beta"] });
    expect(await projectsFor("quiet")).toEqual({ projects: [] });
    await expect(Promise.resolve().then(() => projectsFor("ghost"))).rejects.toMatchObject({ code: "not-found" });
    await expect(Promise.resolve().then(() => handlers["roster.agentsFor"]?.({ project: "" }, ctx))).rejects.toMatchObject({ code: "invalid-params" });
    await expect(Promise.resolve().then(() => handlers["roster.projectsFor"]?.({}, ctx))).rejects.toMatchObject({ code: "invalid-params" });
  });

  it("answers every agent's connected projects at once: a hidden agent by the project setting, an orphan left out", async () => {
    const { handlers } = api(["claude", "codex", "locked", "quiet", "gone"]);
    expect(await handlers["roster.connections"]?.({}, ctx)).toEqual({
      connections: [
        { agent: "claude", projects: ["alpha"] },
        { agent: "codex", projects: ["alpha", "beta"] },
        { agent: "locked", projects: ["alpha"] },
        { agent: "quiet", projects: ["alpha", "beta"] },
      ],
    });
  });

  it("answers no connected project to any agent while no workspace is open", async () => {
    const { handlers } = api(["claude", "codex"], "No workspace is open.");
    expect(await handlers["roster.connections"]?.({}, ctx)).toEqual({ connections: [{ agent: "claude", projects: [] }, { agent: "codex", projects: [] }] });
  });
});

describe("the skills links API", () => {
  const ctx = { from: "pomade-agents" };
  it("passes a link and an unlink on to the catalog", async () => {
    const { handlers, calls } = api();
    await handlers["skills.link"]?.({ agent: "claude-pm", name: "grill-me", target: "Agents/_shared/skills/grill-me" }, ctx);
    expect(calls.at(-1)).toEqual(["link", "claude-pm", "grill-me", "Agents/_shared/skills/grill-me"]);
    await handlers["skills.unlink"]?.({ agent: "claude-pm", name: "grill-me" }, ctx);
    expect(calls.at(-1)).toEqual(["unlink", "claude-pm", "grill-me"]);
  });

  it.each<[string, string, unknown]>([
    ["skills.link", "no agent", { name: "x", target: "y" }],
    ["skills.link", "no name", { agent: "a", target: "y" }],
    ["skills.link", "no target", { agent: "a", name: "x" }],
    ["skills.link", "a target that is not text", { agent: "a", name: "x", target: 3 }],
    ["skills.unlink", "no name", { agent: "a" }],
    ["skills.unlink", "params that are not an object", "a"],
  ])("refuses %s with %s as invalid-params", async (method, _, params) => {
    await expect(Promise.resolve().then(() => api().handlers[method]?.(params as never, ctx))).rejects.toMatchObject({ code: "invalid-params" });
  });
});
