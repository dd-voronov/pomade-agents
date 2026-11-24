import { describe, expect, it } from "vitest";

import type { RosterAgentsAnswer, RosterEntry } from "../../../shared/roster.ts";
import type { AgentCounts } from "../../../shared/work-sessions.ts";
import { agentCount, agentViews, chipsOf, lastActiveText, modelLabel, sections, viewOf, weekText } from "./roster-model.ts";

const profile = (id: string, extra: Partial<NonNullable<RosterEntry["profile"]>> = {}): NonNullable<RosterEntry["profile"]> => ({
  id,
  provider: "claude",
  kind: "folder",
  configDir: `Agents/${id}`,
  command: id,
  tags: ["a", "b"],
  hidden: false,
  modes: {},
  ...extra,
});
const entry = (id: string, extra: Partial<RosterEntry> = {}): RosterEntry => ({
  id,
  name: id,
  profile: profile(id),
  problem: null,
  orphan: false,
  configDir: `/w/Agents/${id}`,
  model: "claude-opus-4-8",
  effort: "high",
  provider: "claude",
  kind: "folder",
  hidden: false,
  ...extra,
});
const answer = (agents: RosterEntry[], profilesOff: string | null = null): RosterAgentsAnswer => ({ epoch: "e", revision: 1, agents, profilesOff });
const counts = (agent: string, week: AgentCounts["week"], lastActiveAt: string | null = null, projects: AgentCounts["projects"] = []): AgentCounts => ({ agent, lastActiveAt, week, projects });
const NO_NAMES = new Map<string, string>();

describe("the agents as the Roster reads them", () => {
  it("keeps the roster's order, reads counts and connections, and gives an agent with no work session zero", () => {
    const views = agentViews(
      answer([entry("claude", { kind: "builtin", name: "Claude", profile: profile("claude", { kind: "builtin", role: "General." }) }), entry("claude-libra")]),
      new Map([["claude", counts("claude", { sessions: 3, costUsd: 1.5 }, "2026-11-24T10:00:00.000Z", [{ project: "b", sessions: 4, lastAt: null }])]]),
      new Map([["claude", ["a", "b"]]]),
      new Map([["a", "Alpha"], ["b", "Beta"]]),
    );
    expect(views.map((v) => [v.id, v.name, v.builtin, v.role, v.week, v.lastActiveAt])).toEqual([
      ["claude", "Claude", true, "General.", { sessions: 3, costUsd: 1.5 }, "2026-11-24T10:00:00.000Z"],
      ["claude-libra", "claude-libra", false, null, { sessions: 0, costUsd: null }, null],
    ]);
    expect(views[0]?.connected).toEqual([
      { id: "b", name: "Beta", sessions: 4 },
      { id: "a", name: "Alpha", sessions: 0 },
    ]);
    expect(views[1]?.connected).toEqual([]);
    expect(views[0]?.providerLabel).toBe("Claude Code");
  });

  it("marks an agent read-only without a workspace, with an unusable file, or as an orphan", () => {
    const flags = (a: RosterAgentsAnswer): boolean[] => agentViews(a, new Map(), new Map(), NO_NAMES).map((v) => v.readOnly);
    expect(flags(answer([entry("a")]))).toEqual([false]);
    expect(flags(answer([entry("a")], "No workspace is open."))).toEqual([true]);
    expect(flags(answer([entry("a", { profile: null, problem: "line 3: not YAML" })]))).toEqual([true]);
    expect(flags(answer([entry("a", { orphan: true })]))).toEqual([true]);
  });

  it("has no role or tags for an agent whose file cannot be used", () => {
    const [view] = agentViews(answer([entry("a", { profile: null, problem: "x", configDir: null })]), new Map(), new Map(), NO_NAMES);
    expect(view).toMatchObject({ role: null, tags: [], configDir: null, problem: "x" });
  });
});

describe("the hidden section", () => {
  it("holds the hidden agents; an orphan and an unusable file stay in place, hidden or not", () => {
    const views = agentViews(
      answer([entry("a"), entry("b", { hidden: true }), entry("c", { hidden: true, orphan: true }), entry("d", { hidden: true, profile: null, problem: "x" }), entry("e")]),
      new Map(),
      new Map(),
      NO_NAMES,
    );
    const { shown, hidden } = sections(views);
    expect(shown.map((v) => v.id)).toEqual(["a", "c", "d", "e"]);
    expect(hidden.map((v) => v.id)).toEqual(["b"]);
  });
});

describe("how values read", () => {
  it("labels a Claude model the way the card shows it", () => {
    expect(modelLabel("claude-opus-4-8")).toBe("opus-4.8");
    expect(modelLabel("claude-sonnet-5")).toBe("sonnet-5");
    expect(modelLabel("opus")).toBe("opus");
    expect(modelLabel("gpt-5.2-codex")).toBe("gpt-5.2-codex");
    expect(modelLabel("claude-haiku-4-5-20251001")).toBe("haiku-4.5-20251001");
  });

  it("writes the count, the week and Last active", () => {
    expect(agentCount(1)).toBe("1 agent");
    expect(agentCount(7)).toBe("7 agents");
    expect(weekText({ sessions: 1, costUsd: null })).toBe("1 session");
    expect(weekText({ sessions: 11, costUsd: 9.85 })).toBe("11 sessions · ~$9.85");
    expect(weekText({ sessions: 0, costUsd: null })).toBe("0 sessions");
    expect(lastActiveText(null, new Date())).toBe("never");
    expect(lastActiveText("2026-11-24T10:00:00.000Z", new Date("2026-11-24T10:05:00.000Z"))).toBe("5m");
  });

  it("remembers the view; anything stored but the two names reads as cards", () => {
    expect(viewOf("list")).toBe("list");
    expect(viewOf("cards")).toBe("cards");
    expect(viewOf(null)).toBe("cards");
    expect(viewOf("grid")).toBe("cards");
  });

  it("marks the built-ins, the orphans, the unusable files and the hidden", () => {
    const [claude, orphan, broken, hidden] = agentViews(
      answer([entry("claude", { kind: "builtin" }), entry("b", { orphan: true }), entry("c", { profile: null, problem: "bad" }), entry("d", { hidden: true })]),
      new Map(),
      new Map(),
      NO_NAMES,
    );
    expect(chipsOf(claude!).map((c) => c.id)).toEqual(["built-in"]);
    expect(chipsOf(orphan!).map((c) => c.id)).toEqual(["orphan"]);
    expect(chipsOf(broken!)).toEqual([{ id: "unreadable", label: "agent.yaml can't be read", tone: "warn", title: "bad" }]);
    expect(chipsOf(hidden!).map((c) => c.id)).toEqual(["hidden"]);
  });
});
