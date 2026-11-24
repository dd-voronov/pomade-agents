import type { ProjectRef } from "pomade-kit/protocol";
import { describe, expect, it } from "vitest";

import type { LiveRow } from "../../shared/live-now.ts";
import { groupRows, headerCount, rowTitle } from "./live-now-model.ts";

const row = (tabId: string, patch: Partial<LiveRow> = {}): LiveRow => ({
  kind: "tab",
  tabId,
  project: "alpha",
  sessionId: null,
  agent: "claude",
  agentName: "Claude Code",
  state: "idle",
  since: "2026-11-24T10:00:00.000Z",
  name: null,
  firstMessage: null,
  ...patch,
});

const project = (id: string, name: string): [string, ProjectRef] => [id, { id, kind: "project", name, root: `Projects/${id}` }];
const PROJECTS = new Map([project("alpha", "Alpha"), project("beta", "Beta"), project("gamma", "Gamma")]);

describe("Live now's groups", () => {
  it("puts the active project first and marks it current, then Projects panel order, the Workspace last", () => {
    const rows = [row("w", { project: "__workspace__" }), row("a"), row("g", { project: "gamma" }), row("b", { project: "beta" }), row("x", { project: "gone" })];
    const groups = groupRows(rows, "gamma", PROJECTS);
    expect(groups.map((g) => [g.project, g.name, g.current])).toEqual([
      ["gamma", "Gamma", true],
      ["alpha", "Alpha", false],
      ["beta", "Beta", false],
      ["gone", "gone", false],
      ["__workspace__", "Workspace", false],
    ]);
    expect(groupRows(rows, "__workspace__", PROJECTS)[0]).toMatchObject({ project: "__workspace__", current: true });
  });

  it("orders a project's rows Needs you → Working → Idle, then the most recent first", () => {
    const rows = [
      row("idle-new", { since: "2026-11-24T10:05:00.000Z" }),
      row("working-old", { state: "working", since: "2026-11-24T09:00:00.000Z" }),
      row("needs", { state: "needs-you", since: "2026-11-24T08:00:00.000Z" }),
      row("working-new", { state: "working", since: "2026-11-24T10:01:00.000Z" }),
      row("idle-old"),
    ];
    expect(groupRows(rows, "alpha", PROJECTS)[0]?.rows.map((r) => r.tabId)).toEqual(["needs", "working-new", "working-old", "idle-new", "idle-old"]);
  });
});

describe("Live now's texts", () => {
  it("counts what runs and what needs you", () => {
    expect(headerCount([])).toBe("");
    expect(headerCount([row("a"), row("b", { state: "working" })])).toBe("2 running");
    expect(headerCount([row("a", { state: "needs-you" }), row("b")])).toBe("2 running · 1 needs you");
    expect(headerCount([row("a", { state: "needs-you" }), row("b", { state: "needs-you" }), row("c")])).toBe("3 running · 2 need you");
  });

  it("names a row by its session's name, else its first message in grey, else the agent", () => {
    expect(rowTitle(row("a", { sessionId: "s", name: "G4 tickets", firstMessage: "hi" }))).toEqual({ text: "G4 tickets", unnamed: false });
    expect(rowTitle(row("a", { sessionId: "s", firstMessage: "why does it flicker" }))).toEqual({ text: "why does it flicker", unnamed: true });
    expect(rowTitle(row("a"))).toEqual({ text: "Claude Code", unnamed: false });
  });
});
