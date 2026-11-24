import { describe, expect, it } from "vitest";

import { isRosterAgentsAnswer, isRosterConnectionsAnswer, type RosterEntry } from "./roster.ts";

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
