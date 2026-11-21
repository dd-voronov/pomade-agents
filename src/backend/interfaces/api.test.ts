import { describe, expect, it } from "vitest";

import { testSession, testSummary } from "../../shared/test-sessions.ts";
import { createApi, type ApiSources } from "./api.ts";

const ANSWER = { text: "Done.\n\n- one\n- two", at: "2026-11-17T10:04:00.000Z" };
const LISTED = [
  testSession({ id: "a", summary: testSummary({ id: "a", cwd: "/w/repo", branch: "main", lastAnswer: ANSWER }) }),
  testSession({ id: "b", summary: testSummary({ id: "b", cwd: "/w/repo", startedAt: "2026-11-17T09:00:00.000Z" }) }),
];

function api() {
  const calls: unknown[][] = [];
  const sessions: ApiSources["sessions"] = {
    answer: (since) => {
      calls.push(["answer", since]);
      return { epoch: "e", revision: 0, full: true, sessions: [], removed: [], indexing: false, recordsOff: null };
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
  const info = { version: "0", startedAt: "", workspace: null, dataDir: null, stateDir: "/s" };
  return { handlers: createApi({ info, sessions, live, realPath: (p) => Promise.resolve(p) }), calls };
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
    await handlers["sessions.list"]?.({ since: { epoch: "e", revision: 3 } }, ctx);
    await handlers["sessions.list"]?.({ since: { epoch: "e", revision: -1 } }, ctx);
    expect(calls).toEqual([
      ["changeStatus", ["a", "b"], "on-hold", "why"],
      ["changeStatus", ["a"], "done", undefined],
      ["changeStatus", ["a"], "done", null],
      ["rename", "a", null],
      ["moveToProject", "a", "__workspace__"],
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
