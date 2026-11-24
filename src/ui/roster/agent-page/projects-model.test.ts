import type { ProjectInfo } from "pomade-kit/protocol";
import { describe, expect, it } from "vitest";

import type { ProjectCounts } from "../../../shared/work-sessions.ts";
import { projectsView, withAgent, withoutAgent } from "./projects-model.ts";

const project = (id: string, group: { id: string; path: string[] } | null = null): ProjectInfo => ({
  id,
  kind: "project",
  name: id.toUpperCase(),
  root: `Projects/${id}`,
  groupId: group?.id ?? null,
  groupPath: group?.path ?? [],
});

const FAMILY = { id: "family", path: ["Family"] };
const CLIENTS = { id: "clients", path: ["Work", "Clients"] };
/** In the Projects panel's order: Family, Work / Clients, then the ungrouped. */
const PROJECTS = [project("a", FAMILY), project("b", FAMILY), project("c", FAMILY), project("d", CLIENTS), project("e", CLIENTS), project("f"), project("g"), project("h"), project("i")];

const count = (id: string, sessions: number, lastAt: string | null = "2026-11-01T00:00:00.000Z"): ProjectCounts => ({ project: id, sessions, lastAt });
const visible = (entries: Record<string, string[]>): ReadonlyMap<string, readonly string[]> => new Map(Object.entries(entries));
const ids = (rows: readonly { id: string }[]): string[] => rows.map((r) => r.id);

describe("which projects are connected", () => {
  it("connects the projects whose list names the agent and the ones that offer every agent, and marks the latter", () => {
    const view = projectsView({ projects: PROJECTS, counts: [], agent: "me", visible: visible({ a: ["me"], b: ["other"], c: ["*"], d: [], e: ["other", "me"] }) });
    expect(view.connectedCount).toBe(3);
    expect(view.connected.flatMap((g) => g.rows).map((r) => [r.id, r.everyAgent])).toEqual([
      ["a", false],
      ["c", true],
      ["e", false],
    ]);
  });

  it("does not count a project whose list could not be read as connected", () => {
    const view = projectsView({ projects: PROJECTS, counts: [], agent: "me", visible: visible({ a: ["me"] }) });
    expect(view.connectedCount).toBe(1);
  });

  it("leaves the Workspace's bucket and projects Pomade no longer lists out", () => {
    const view = projectsView({ projects: [project("a")], counts: [count("__workspace__", 9), count("gone", 4), count("a", 2)], agent: "me", visible: visible({ a: [] }) });
    expect(ids(view.used)).toEqual(["a"]);
    expect(view.neverCount).toBe(0);
  });
});

describe("Connected", () => {
  it("is grouped as the sidebar is, nested groups by their path, the ungrouped last, empty groups left out", () => {
    const view = projectsView({ projects: PROJECTS, counts: [], agent: "me", visible: visible({ a: ["me"], e: ["me"], g: ["me"], h: ["me"] }) });
    expect(view.connected.map((g) => [g.label, ids(g.rows)])).toEqual([
      ["Family", ["a"]],
      ["Work / Clients", ["e"]],
      ["Ungrouped", ["g", "h"]],
    ]);
  });

  it("orders a group by sessions in the window, the panel's order for equal counts and for none", () => {
    const view = projectsView({
      projects: PROJECTS,
      counts: [count("a", 1), count("b", 7), count("c", 7, "2026-01-01T00:00:00.000Z")],
      agent: "me",
      visible: visible({ a: ["me"], b: ["me"], c: ["me"], d: ["me"], e: ["me"] }),
    });
    expect(view.connected.map((g) => ids(g.rows))).toEqual([["b", "c", "a"], ["d", "e"]]);
  });
});

describe("Not connected", () => {
  const view = projectsView({
    projects: PROJECTS,
    counts: [count("d", 2, "2026-11-02T00:00:00.000Z"), count("f", 9), count("e", 2, "2026-11-20T00:00:00.000Z"), count("g", 0, "2026-05-01T00:00:00.000Z")],
    agent: "me",
    visible: visible({ a: ["me"] }),
  });

  it("puts first the projects the agent has sessions in: the most sessions, then the latest session", () => {
    expect(ids(view.used)).toEqual(["f", "e", "d", "g"]);
    expect(view.used.map((r) => r.sessions)).toEqual([9, 2, 2, 0]);
    expect(view.used.at(-1)?.lastAt).toBe("2026-05-01T00:00:00.000Z");
  });

  it("keeps the never-used ones under the sidebar's groups, and folds them only when there are more than five", () => {
    expect(view.neverCount).toBe(4);
    expect(view.never.map((g) => [g.label, ids(g.rows)])).toEqual([
      ["Family", ["b", "c"]],
      ["Ungrouped", ["h", "i"]],
    ]);
    expect(view.foldable).toBe(false);
    const many = projectsView({ projects: PROJECTS, counts: [], agent: "me", visible: visible({ a: ["me"] }) });
    expect(many.neverCount).toBe(8);
    expect(many.foldable).toBe(true);
    const five = projectsView({ projects: PROJECTS.slice(0, 6), counts: [], agent: "me", visible: visible({ a: ["me"] }) });
    expect([five.neverCount, five.foldable]).toEqual([5, false]);
  });

  it("gives a never-used project no count and no time", () => {
    expect(view.never[0]?.rows[0]).toMatchObject({ sessions: null, lastAt: null });
  });
});

describe("the visible agents after a change", () => {
  it("adds the agent at the end, or at the place it had; never twice, never into an every-agent list", () => {
    expect(withAgent(["a", "b"], "me")).toEqual(["a", "b", "me"]);
    expect(withAgent(["a", "b"], "me", 1)).toEqual(["a", "me", "b"]);
    expect(withAgent(["a"], "me", 9)).toEqual(["a", "me"]);
    expect(withAgent(["a", "me"], "me")).toEqual(["a", "me"]);
    expect(withAgent(["*"], "me")).toEqual(["*"]);
    expect(withAgent([], "me")).toEqual(["me"]);
  });

  it("takes the agent away and keeps the others in order", () => {
    expect(withoutAgent(["a", "me", "b"], "me")).toEqual(["a", "b"]);
    expect(withoutAgent(["me"], "me")).toEqual([]);
    expect(withoutAgent(["a"], "me")).toEqual(["a"]);
  });
});
