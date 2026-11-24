import { describe, expect, it } from "vitest";

import { countsByAgent, noCounts, rosterWindows, weekTotal } from "./agent-counts-model.ts";

const local = (y: number, m: number, d: number, h = 0, min = 0): Date => new Date(y, m - 1, d, h, min);

describe("the Roster's windows", () => {
  it("this week runs from Monday 00:00, local time", () => {
    // 2026-11-24 is a Tuesday.
    expect(rosterWindows(local(2026, 11, 24, 15, 30)).weekFrom).toBe(local(2026, 11, 23).toISOString());
    expect(rosterWindows(local(2026, 11, 23, 0, 0)).weekFrom).toBe(local(2026, 11, 23).toISOString());
    // A Sunday belongs to the week that started six days before.
    expect(rosterWindows(local(2026, 11, 29, 23, 59)).weekFrom).toBe(local(2026, 11, 23).toISOString());
    // Across a month's end.
    expect(rosterWindows(local(2026, 12, 2, 9)).weekFrom).toBe(local(2026, 11, 30).toISOString());
  });

  it("the per-project window starts at 00:00 local, 90 days back, and stays the same all day", () => {
    expect(rosterWindows(local(2026, 11, 24, 0, 1)).projectsFrom).toBe(local(2026, 8, 26).toISOString());
    expect(rosterWindows(local(2026, 11, 24, 23, 59))).toEqual(rosterWindows(local(2026, 11, 24, 0, 1)));
  });
});

describe("reading the counts", () => {
  const claude = { agent: "claude", lastActiveAt: "2026-11-24T10:00:00.000Z", week: { sessions: 3, costUsd: 2.5 }, projects: [] };
  const coder = { agent: "claude-coder", lastActiveAt: null, week: { sessions: 1, costUsd: null }, projects: [] };

  it("by agent, and zero for an agent with no work session", () => {
    const byAgent = countsByAgent({ epoch: "e", revision: 1, indexing: false, agents: [claude, coder] });
    expect(byAgent.get("claude")).toBe(claude);
    expect(byAgent.get("codex") ?? noCounts("codex")).toEqual({ agent: "codex", lastActiveAt: null, week: { sessions: 0, costUsd: null }, projects: [] });
  });

  it("this week across agents: the sessions summed, the known estimates summed", () => {
    expect(weekTotal([claude, coder])).toEqual({ sessions: 4, costUsd: 2.5 });
    expect(weekTotal([coder])).toEqual({ sessions: 1, costUsd: null });
    expect(weekTotal([])).toEqual({ sessions: 0, costUsd: null });
  });
});
