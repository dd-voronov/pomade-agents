import { describe, expect, it } from "vitest";

import { ROLE_MAX, TAGS_MAX, TAG_MAX, isRoleLine, isRosterAgentsAnswer, isRosterConnectionsAnswer, isTagList, type RosterEntry } from "./roster.ts";

const entry: RosterEntry = { id: "claude", name: "Claude", profile: null, problem: null, orphan: false, configDir: null, model: "opus", effort: null, provider: "claude", kind: "builtin", hidden: false };
const answer = (agents: unknown[]): unknown => ({ epoch: "e", revision: 1, agents, profilesOff: null });

describe("roster.agents entries", () => {
  it("carry the provider, the kind and whether the agent is hidden", () => {
    expect(isRosterAgentsAnswer(answer([entry]))).toBe(true);
    for (const broken of [{ ...entry, provider: "gemini" }, { ...entry, kind: "other" }, { ...entry, hidden: "no" }, { ...entry, provider: undefined }]) {
      expect(isRosterAgentsAnswer(answer([broken]))).toBe(false);
    }
  });
});

describe("roster.connections answers", () => {
  it("are lists of an agent and its project ids", () => {
    expect(isRosterConnectionsAnswer({ connections: [{ agent: "claude", projects: ["a", "b"] }, { agent: "codex", projects: [] }] })).toBe(true);
    expect(isRosterConnectionsAnswer({ connections: [] })).toBe(true);
    for (const broken of [null, {}, { connections: [{ agent: "claude" }] }, { connections: [{ agent: 1, projects: [] }] }, { connections: [{ agent: "claude", projects: [1] }] }]) {
      expect(isRosterConnectionsAnswer(broken)).toBe(false);
    }
  });
});

describe("the role line and tag limits", () => {
  it("are 200 characters, 20 tags, 24 characters a tag", () => {
    expect([ROLE_MAX, TAGS_MAX, TAG_MAX]).toEqual([200, 20, 24]);
  });

  it("take a role line of 200 characters trimmed and refuse one more, a blank or a broken line", () => {
    expect(isRoleLine("r".repeat(200))).toBe(true);
    expect(isRoleLine(`  ${"r".repeat(200)}  `)).toBe(true);
    for (const role of ["r".repeat(201), "  ", "two\nlines", "nul\0", 3, null, undefined]) expect(isRoleLine(role)).toBe(false);
  });

  it("take 20 tags of 24 characters and refuse the 21st, a longer tag or a broken one", () => {
    const tags = (n: number): string[] => Array.from({ length: n }, (_, i) => `t${i}`);
    expect(isTagList(tags(20))).toBe(true);
    expect(isTagList([])).toBe(true);
    expect(isTagList(["x".repeat(24)])).toBe(true);
    for (const list of [tags(21), ["x".repeat(25)], [" "], ["a\nb"], [3], "tag", null]) expect(isTagList(list)).toBe(false);
  });
});
