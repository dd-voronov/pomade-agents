import { describe, expect, it } from "vitest";

import type { RosterEntry } from "../../shared/roster.ts";
import { stateChips } from "./state-chips.ts";

function entry(over: Partial<RosterEntry> = {}): RosterEntry {
  return { id: "claude-a", name: "claude-a", profile: null, problem: null, orphan: false, configDir: null, model: null, effort: null, provider: "claude", kind: "folder", hidden: false, ...over };
}

describe("stateChips", () => {
  it("has none for a plain folder agent", () => {
    expect(stateChips(entry())).toEqual([]);
  });

  it("names a built-in, an orphan, an unreadable profile and a hidden agent", () => {
    expect(stateChips(entry({ kind: "builtin", hidden: true })).map((c) => c.id)).toEqual(["built-in", "hidden"]);
    expect(stateChips(entry({ orphan: true })).map((c) => [c.id, c.tone])).toEqual([["orphan", "warn"]]);
    expect(stateChips(entry({ problem: "line 3 is wrong" }))).toEqual([{ id: "unreadable", label: "agent.yaml can’t be read", tone: "warn", title: "line 3 is wrong" }]);
  });

  it("marks an agent hidden by an unusable agent.yaml as it marks a usable one", () => {
    expect(stateChips(entry({ problem: "bad", hidden: true })).map((c) => c.id)).toEqual(["unreadable", "hidden"]);
  });
});
