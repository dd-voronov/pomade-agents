import type { ProjectRef } from "pomade-kit/protocol";
import { describe, expect, it } from "vitest";

import type { LiveRunRow, LiveTabRow } from "../../shared/live-now.ts";
import { groupRows, groupTarget, headerCount, rowTitle, rowTooltip } from "./live-now-model.ts";

const row = (tabId: string, patch: Partial<LiveTabRow> = {}): LiveTabRow => ({
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

const run = (id: string, patch: Partial<LiveRunRow> = {}): LiveRunRow => ({
  kind: "run",
  job: "nightly",
  run: id,
  name: "Nightly review",
  project: "alpha",
  sessionId: null,
  agent: "claude",
  agentName: "Claude Code",
  state: "working",
  since: "2026-11-24T10:00:00.000Z",
  terminal: `run:nightly:${id}`,
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
    expect(groupRows(rows, "alpha", PROJECTS)[0]?.rows.map((r) => (r.kind === "tab" ? r.tabId : r.run))).toEqual(["needs", "working-new", "working-old", "idle-new", "idle-old"]);
  });

  it("places a run among the Working rows by its start", () => {
    const rows = [row("idle"), run("r-new", { since: "2026-11-24T10:03:00.000Z" }), row("needs", { state: "needs-you" }), row("working", { state: "working", since: "2026-11-24T10:02:00.000Z" })];
    expect(groupRows(rows, "alpha", PROJECTS)[0]?.rows.map((r) => (r.kind === "tab" ? r.tabId : r.run))).toEqual(["needs", "r-new", "working", "idle"]);
  });

  it("switches to a group's project through its first tab, else its first run with a terminal, else nothing", () => {
    const [mixed] = groupRows([run("r1"), row("idle")], "alpha", PROJECTS);
    expect(mixed && groupTarget(mixed)).toMatchObject({ kind: "tab", tabId: "idle" });
    const [runs] = groupRows([run("r1", { terminal: null }), run("r2", { since: "2026-11-24T09:00:00.000Z" })], "alpha", PROJECTS);
    expect(runs && groupTarget(runs)).toMatchObject({ kind: "run", run: "r2" });
    const [none] = groupRows([run("r1", { terminal: null })], "alpha", PROJECTS);
    expect(none && groupTarget(none)).toBeNull();
  });
});

describe("Live now's texts", () => {
  it("counts what runs and what needs you", () => {
    expect(headerCount([])).toBe("");
    expect(headerCount([row("a"), row("b", { state: "working" })])).toBe("2 running");
    expect(headerCount([row("a", { state: "needs-you" }), row("b")])).toBe("2 running · 1 needs you");
    expect(headerCount([row("a", { state: "needs-you" }), row("b", { state: "needs-you" }), row("c")])).toBe("3 running · 2 need you");
    expect(headerCount([run("r1"), row("a", { state: "needs-you" })])).toBe("2 running · 1 needs you");
  });

  it("names a row by its session's name, else its first message in grey, else the agent", () => {
    expect(rowTitle(row("a", { sessionId: "s", name: "G4 tickets", firstMessage: "hi" }))).toEqual({ text: "G4 tickets", unnamed: false });
    expect(rowTitle(row("a", { sessionId: "s", firstMessage: "why does it flicker" }))).toEqual({ text: "why does it flicker", unnamed: true });
    expect(rowTitle(row("a"))).toEqual({ text: "Claude Code", unnamed: false });
    expect(rowTitle(run("r1", { sessionId: "s" }))).toEqual({ text: "Nightly review", unnamed: false });
  });
});

describe("a row's tooltip", () => {
  const local = (d: number, h: number, m: number): string => new Date(2026, 10, d, h, m).toISOString();
  const now = new Date(2026, 10, 24, 12, 0);

  it("says since when as the rows and the detail panel do, then what the click does", () => {
    expect(rowTooltip(row("t", { state: "working", since: local(24, 9, 5) }), now)).toBe("Working since 09:05 — switches project and focuses the tab");
    expect(rowTooltip(row("t", { state: "needs-you", since: local(23, 18, 40) }), now)).toBe("Needs you since yesterday, 18:40 — switches project and focuses the tab");
    expect(rowTooltip(run("r", { since: local(3, 9, 5) }), now)).toBe("Working since Nov 3, 09:05 — opens the run’s terminal tab");
    expect(rowTooltip(run("r", { terminal: null, since: local(3, 9, 5) }), now)).toBe("Working since Nov 3, 09:05 — Runner did not say which terminal it runs in");
  });
});
