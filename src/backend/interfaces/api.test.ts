import { describe, expect, it } from "vitest";

import { testSession, testSummary } from "../../shared/test-sessions.ts";
import { createApi, type ApiSources } from "./api.ts";

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
    list: () => [testSession({ id: "a", summary: testSummary({ id: "a", cwd: "/w/repo", branch: "main" }) })],
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
    expect(await handlers["sessions.forRepo"]?.({ folder: "/w" }, ctx)).toMatchObject({ sessions: [{ id: "a", cwd: "/w/repo" }] });
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
});
