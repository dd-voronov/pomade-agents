import { describe, expect, it } from "vitest";
import type { SessionStatus } from "pomade-kit/protocol";

import type { Session } from "../../shared/sessions.ts";
import { testSession, testSummary } from "../../shared/test-sessions.ts";
import {
  COLUMN_WIDTH,
  NAME_MIN_WIDTH,
  ROW_PADDING,
  byActivity,
  chipsOf,
  columnTemplate,
  columnsFor,
  contextLevel,
  contextMeter,
  costSum,
  formatAgo,
  formatHeaderSum,
  formatMoney,
  formatStamp,
  forkTooltip,
  groupByStatus,
  inScope,
  isListed,
  isLong,
  liveTitle,
  projectLabel,
  rowName,
  shownRows,
  sinceStamp,
  statusOf,
  totalCost,
  unknownReason,
} from "./table-model.ts";

const session = (id: string, opts: { status?: SessionStatus | null; projects?: string[]; at?: string | null; cost?: number | null } = {}): Session => {
  const base = testSession({ id });
  return {
    ...base,
    summary: testSummary({ id, lastActiveAt: opts.at === undefined ? base.summary.lastActiveAt : opts.at, costUsd: opts.cost ?? null }),
    record: opts.status === null ? null : { id, provider: "claude-code", agent: "claude", status: opts.status ?? "active" },
    attribution: { projects: opts.projects ?? [], by: "folder", sharedFolder: (opts.projects ?? []).length > 1 },
  };
};

describe("scope", () => {
  it("a project's tab holds its sessions, shared-folder ones in each project; the Workspace's holds every session", () => {
    const alpha = session("a", { projects: ["alpha"] });
    const shared = session("s", { projects: ["alpha", "twin"] });
    const bucket = session("w", { projects: [] });
    expect([alpha, shared, bucket].filter((s) => inScope(s, "alpha")).map((s) => s.id)).toEqual(["a", "s"]);
    expect([alpha, shared, bucket].filter((s) => inScope(s, "twin")).map((s) => s.id)).toEqual(["s"]);
    expect([alpha, shared, bucket].filter((s) => inScope(s, "beta"))).toEqual([]);
    expect([alpha, shared, bucket].filter((s) => inScope(s, "__workspace__")).map((s) => s.id)).toEqual(["a", "s", "w"]);
  });

  it("lists a hidden session only while the hidden ones are shown, and only in its scope", () => {
    const hidden = { ...session("h", { projects: ["alpha"] }), hidden: "empty" as const };
    const shown = session("a", { projects: ["alpha"] });
    expect([hidden, shown].filter((s) => isListed(s, "alpha", false)).map((s) => s.id)).toEqual(["a"]);
    expect([hidden, shown].filter((s) => isListed(s, "alpha", true)).map((s) => s.id)).toEqual(["h", "a"]);
    expect(isListed(hidden, "beta", true)).toBe(false);
  });
});

describe("status groups and order", () => {
  it("a session without a record is Done", () => {
    expect(statusOf(session("x", { status: null }))).toBe("done");
    expect(statusOf(session("x", { status: "on-hold" }))).toBe("on-hold");
  });

  it("groups the scope's sessions by status, newest activity first, no time last, ties by id", () => {
    const rows = [
      session("old", { at: "2026-11-01T10:00:00.000Z" }),
      session("none", { at: null }),
      session("bad", { at: "not a time" }),
      session("new", { at: "2026-11-17T10:00:00.000Z" }),
      session("b-tie", { at: "2026-11-10T10:00:00.000Z" }),
      session("a-tie", { at: "2026-11-10T10:00:00.000Z" }),
      session("held", { status: "on-hold" }),
      session("adopting", { status: null }),
      session("skipped", { status: "done-skip" }),
      session("elsewhere", { projects: ["beta"] }),
    ];
    const groups = groupByStatus(
      rows.map((s) => ({ ...s, attribution: { ...s.attribution, projects: s.id === "elsewhere" ? ["beta"] : ["alpha"] } })),
      "alpha",
    );
    expect(groups.active.map((s) => s.id)).toEqual(["new", "a-tie", "b-tie", "old", "bad", "none"]);
    expect(groups["on-hold"].map((s) => s.id)).toEqual(["held"]);
    expect(groups.done.map((s) => s.id)).toEqual(["adopting"]);
    expect(groups["done-skip"].map((s) => s.id)).toEqual(["skipped"]);
    expect(byActivity(rows[0]!, rows[0]!)).toBe(0);
  });
});

describe("sums", () => {
  it("adds the known estimates; none known is null", () => {
    expect(costSum([session("a", { cost: 1.5 }), session("b", { cost: null }), session("c", { cost: 0.25 })])).toBe(1.75);
    expect(costSum([session("a", { cost: null })])).toBeNull();
    expect(costSum([])).toBeNull();
    expect(costSum([session("a", { cost: 0 })])).toBe(0);
  });

  it("the header leaves Done–skip/Failed out", () => {
    const groups = groupByStatus(
      [
        session("a", { status: "active", cost: 1 }),
        session("h", { status: "on-hold", cost: 2 }),
        session("d", { status: "done", cost: 4 }),
        session("s", { status: "done-skip", cost: 100 }),
      ],
      "__workspace__",
    );
    expect(totalCost(groups)).toBe(7);
    expect(totalCost(groupByStatus([session("s", { status: "done-skip", cost: 100 })], "__workspace__"))).toBeNull();
  });

  it("reads as money and as the header's summary", () => {
    expect(formatMoney(0)).toBe("~$0.00");
    expect(formatMoney(0.004)).toBe("~$0.00");
    expect(formatMoney(2.345)).toBe("~$2.35");
    expect(formatMoney(1234.5)).toBe("~$1,234.50");
    expect(formatHeaderSum(1, 0.5)).toBe("1 session · ~$0.50 est.");
    expect(formatHeaderSum(3, 12)).toBe("3 sessions · ~$12.00 est.");
    expect(formatHeaderSum(2, null)).toBe("2 sessions");
    expect(formatHeaderSum(0, null)).toBe("0 sessions");
  });
});

describe("the latest-10 rule", () => {
  const rows = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

  it("cuts Done and Done–skip/Failed holding more than 12 to the latest 10, unless expanded", () => {
    expect(shownRows("done", rows(15), false)).toEqual(rows(10));
    expect(shownRows("done", rows(15), true)).toEqual(rows(15));
    expect(shownRows("done-skip", rows(13), false)).toHaveLength(10);
    expect(shownRows("done", rows(12), false)).toHaveLength(12);
    expect(shownRows("active", rows(40), false)).toHaveLength(40);
    expect(shownRows("on-hold", rows(40), false)).toHaveLength(40);
    expect([isLong("done", 12), isLong("done", 13), isLong("active", 13)]).toEqual([false, true, false]);
  });
});

describe("columns by width", () => {
  const full = ROW_PADDING + COLUMN_WIDTH.agent + COLUMN_WIDTH.model + COLUMN_WIDTH.context + COLUMN_WIDTH.cost + COLUMN_WIDTH.last + COLUMN_WIDTH.actions + NAME_MIN_WIDTH;
  const shown = (width: number, workspace = false): string[] =>
    Object.entries(columnsFor(width, workspace))
      .filter(([, on]) => on)
      .map(([column]) => column)
      .sort();

  it("keeps every column while the name keeps its minimum", () => {
    expect(shown(full)).toEqual(["agent", "context", "cost", "effort", "model"]);
    expect(shown(full + COLUMN_WIDTH.project, true)).toEqual(["agent", "context", "cost", "effort", "model", "project"]);
  });

  it("drops effort → model → ~$ est. → context → agent as the tab narrows; name, last active and the actions stay", () => {
    const noEffort = full - (COLUMN_WIDTH.model - COLUMN_WIDTH.modelOnly);
    expect(shown(full - 1)).toEqual(["agent", "context", "cost", "model"]);
    expect(shown(noEffort)).toEqual(["agent", "context", "cost", "model"]);
    expect(shown(noEffort - 1)).toEqual(["agent", "context", "cost"]);
    expect(shown(noEffort - COLUMN_WIDTH.modelOnly - 1)).toEqual(["agent", "context"]);
    expect(shown(noEffort - COLUMN_WIDTH.modelOnly - COLUMN_WIDTH.cost - 1)).toEqual(["agent"]);
    expect(shown(noEffort - COLUMN_WIDTH.modelOnly - COLUMN_WIDTH.cost - COLUMN_WIDTH.context - 1)).toEqual([]);
    expect(shown(0)).toEqual([]);
  });

  it("the Workspace's Project column stays and narrows the others' room", () => {
    expect(shown(full, true)).toEqual(["agent", "context", "cost", "project"]);
    expect(shown(0, true)).toEqual(["project"]);
  });

  it("builds the row's grid: the name takes the rest", () => {
    expect(columnTemplate(columnsFor(10_000, true))).toBe("minmax(0, 1fr) 132px 108px 204px 82px 74px 84px 32px");
    expect(columnTemplate(columnsFor(full - 1, false))).toBe("minmax(0, 1fr) 108px 140px 82px 74px 84px 32px");
    expect(columnTemplate(columnsFor(0, false))).toBe("minmax(0, 1fr) 84px 32px");
  });
});

describe("context", () => {
  it("is amber from 75 % and red from 90 %", () => {
    expect([contextLevel(0), contextLevel(74.9), contextLevel(75), contextLevel(89.9), contextLevel(90), contextLevel(130)]).toEqual([
      "normal",
      "normal",
      "high",
      "high",
      "full",
      "full",
    ]);
  });

  it("reads in whole percent, the bar capped at 100", () => {
    expect(contextMeter({ used: 920_000, window: 1_000_000 })).toEqual({ percent: 92, level: "full", fill: 92 });
    expect(contextMeter({ used: 746, window: 1000 })).toEqual({ percent: 75, level: "high", fill: 75 });
    expect(contextMeter({ used: 1_200, window: 1_000 })).toEqual({ percent: 120, level: "full", fill: 100 });
    expect(contextMeter({ used: 0, window: 1_000 })).toEqual({ percent: 0, level: "normal", fill: 0 });
  });
});

describe("relative time", () => {
  // Local times: the formats follow the viewer's clock.
  const now = new Date(2026, 10, 17, 11, 40);
  const at = (y: number, mo: number, d: number, h: number, mi: number, s = 0): string => new Date(y, mo, d, h, mi, s).toISOString();

  it("reads last active from now to another year", () => {
    expect(formatAgo(at(2026, 10, 17, 11, 39, 30), now)).toBe("now");
    expect(formatAgo(at(2026, 10, 17, 11, 45), now)).toBe("now");
    expect(formatAgo(at(2026, 10, 17, 11, 35), now)).toBe("5m");
    expect(formatAgo(at(2026, 10, 17, 10, 41), now)).toBe("59m");
    expect(formatAgo(at(2026, 10, 17, 8, 10), now)).toBe("3h");
    expect(formatAgo(at(2026, 10, 16, 23, 50), now)).toBe("yesterday");
    expect(formatAgo(at(2026, 10, 13, 9, 0), now)).toBe("4d");
    expect(formatAgo(at(2026, 10, 10, 9, 0), now)).toBe("Nov 10");
    expect(formatAgo(at(2025, 11, 30, 9, 0), now)).toBe("Dec 2025");
    expect(formatAgo(null, now)).toBe("—");
    expect(formatAgo("garbage", now)).toBe("—");
  });

  it("gives the full time for the tooltip", () => {
    expect(formatStamp(at(2026, 10, 17, 9, 5), now)).toBe("Today, 09:05");
    expect(formatStamp(at(2026, 10, 16, 18, 40), now)).toBe("Yesterday, 18:40");
    expect(formatStamp(at(2026, 10, 3, 9, 5), now)).toBe("Nov 3, 09:05");
    expect(formatStamp(at(2025, 10, 3, 9, 5), now)).toBe("Nov 3, 2025, 09:05");
    expect(formatStamp(null, now)).toBe("No time recorded");
  });

  it("says since when, today's date left out", () => {
    expect(sinceStamp(at(2026, 10, 17, 9, 5), now)).toBe("09:05");
    expect(sinceStamp(at(2026, 10, 16, 18, 40), now)).toBe("yesterday, 18:40");
    expect(sinceStamp(at(2026, 10, 3, 9, 5), now)).toBe("Nov 3, 09:05");
  });

  it("gives the live mark's tooltip, and none for Closed", () => {
    const since = at(2026, 10, 17, 9, 5);
    expect(liveTitle(testSession({ live: "working", liveSince: since }), now)).toBe("Working since 09:05");
    expect(liveTitle(testSession({ live: "needs-you", liveSince: since }), now)).toBe("Needs you since 09:05");
    expect(liveTitle(testSession({ live: "idle", liveSince: since }), now)).toBe("Idle since 09:05");
    expect(liveTitle(testSession({ live: "idle", liveSince: null }), now)).toBe("Idle");
    expect(liveTitle(testSession({ live: "closed", liveSince: since }), now)).toBeNull();
  });
});

describe("a row's texts", () => {
  it("names a session by its name, else its first message, else a placeholder", () => {
    const named = testSession({ id: "n", record: { id: "n", provider: "claude-code", agent: "claude", status: "active", name: "G4 tickets" } });
    expect(rowName(named)).toEqual({ text: "G4 tickets", unnamed: false });
    const unnamed = testSession({ id: "u", summary: testSummary({ id: "u", firstMessage: { text: "  Plan the\n  sessions table ", at: null } }) });
    expect(rowName(unnamed)).toEqual({ text: "Plan the sessions table", unnamed: true });
    expect(rowName(testSession({ id: "e" }))).toEqual({ text: "No message yet", unnamed: true });
    expect(rowName(testSession({ id: "r", record: null }))).toEqual({ text: "No message yet", unnamed: true });
  });

  it("names the projects, the Workspace bucket as Workspace", () => {
    const names = new Map([["alpha", "Alpha"], ["twin", "Alpha twin"]]);
    expect(projectLabel(session("a", { projects: ["alpha"] }), names)).toBe("Alpha");
    expect(projectLabel(session("s", { projects: ["alpha", "twin"] }), names)).toBe("Alpha, Alpha twin");
    expect(projectLabel(session("w", { projects: [] }), names)).toBe("Workspace");
    expect(projectLabel(session("g", { projects: ["gone"] }), names)).toBe("gone");
  });

  it("chips: an unattended run, shared folder, outside Pomade", () => {
    const names = new Map([["alpha", "Alpha"], ["twin", "Twin"]]);
    expect(chipsOf(session("plain", { projects: ["alpha"] }), names)).toEqual([]);
    const all = session("all", { projects: ["alpha", "twin"] });
    const record = { id: "all", provider: "claude-code" as const, agent: "claude", status: "active" as const, startedByRunner: { job: "nightly" }, outsidePomade: true as const };
    expect(chipsOf({ ...all, record }, names)).toEqual([
      { kind: "runner", text: "nightly", tooltip: "Started by Runner job nightly, unattended" },
      { kind: "shared-folder", text: "shared folder", tooltip: "Its start folder is the root of Alpha and Twin" },
      { kind: "outside-pomade", text: "outside Pomade", tooltip: "Started outside Pomade: no tab, no live state" },
    ]);
    expect(chipsOf({ ...all, record, hidden: "empty" }, names).map((chip) => chip.text)).toEqual(["hidden — no messages", "nightly", "shared folder", "outside Pomade"]);
  });
});

describe("fork mark and unknown values", () => {
  it("names the parent a fork came from", () => {
    const parent = testSession({ id: "p", record: { id: "p", provider: "claude-code", agent: "claude", status: "done", name: "G4 tickets" } });
    const fork = testSession({ id: "f", record: { id: "f", provider: "claude-code", agent: "claude", status: "active", forkedFrom: "p" } });
    const byId = new Map([["p", parent]]);
    expect(forkTooltip(fork, byId)).toBe("Forked from “G4 tickets”");
    expect(forkTooltip(fork, new Map())).toBe("Forked from another session");
    expect(forkTooltip(parent, byId)).toBeNull();
  });

  it("says why a context or cost is unknown", () => {
    expect(unknownReason(testSession({ id: "a", summary: testSummary({ model: "mystery-9" }) }))).toBe("mystery-9 is not in the price table");
    expect(unknownReason(testSession({ id: "b" }))).toBe("No answer from the agent yet");
  });
});
