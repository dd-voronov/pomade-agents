import { describe, expect, it } from "vitest";

import type { ProjectRef } from "pomade-kit/protocol";

import type { AgentProfile, RosterEntry } from "../../../shared/roster.ts";
import { cannotStart, launchModes, launchTargets, refusedText } from "./commands-model.ts";

const PROFILE: AgentProfile = { id: "a", provider: "claude", kind: "folder", configDir: "Agents/a", command: "a", tags: [], hidden: false, modes: { normal: { enabled: true }, "full-autonomy": { enabled: true } } };
const entry = (patch: Partial<RosterEntry> = {}): RosterEntry => ({
  id: "a",
  name: "a",
  profile: PROFILE,
  problem: null,
  orphan: false,
  configDir: "/w/Agents/a",
  model: null,
  effort: null,
  provider: "claude",
  kind: "folder",
  hidden: false,
  ...patch,
});
const project = (id: string): ProjectRef => ({ id, name: id.toUpperCase(), root: `Projects/${id}` }) as ProjectRef;

describe("launchModes", () => {
  it("offers the enabled modes in the roster's order, with the provider's names", () => {
    expect(launchModes(entry())).toEqual([
      { id: "normal", name: "Normal" },
      { id: "full-autonomy", name: "Full autonomy" },
    ]);
    expect(launchModes(entry({ profile: { ...PROFILE, modes: { normal: { enabled: true }, "full-autonomy": { enabled: false } } } }))).toEqual([{ id: "normal", name: "Normal" }]);
    expect(launchModes(entry({ profile: { ...PROFILE, modes: {} } }))).toEqual([{ id: "normal", name: "Normal" }]);
  });

  it("offers both for an agent with no usable profile: first sight enables both", () => {
    expect(launchModes(entry({ profile: null, problem: "bad" })).map((m) => m.id)).toEqual(["normal", "full-autonomy"]);
  });
});

describe("launchTargets", () => {
  it("puts the connected projects first, the rest after, each in the panel's order", () => {
    const projects = new Map(["p1", "p2", "p3", "p4"].map((id) => [id, project(id)]));
    const { connected, others } = launchTargets(["p3", "p1", "gone"], projects);
    expect(connected.map((p) => p.id)).toEqual(["p1", "p3"]);
    expect(others.map((p) => p.id)).toEqual(["p2", "p4"]);
  });
});

describe("cannotStart", () => {
  it("says why for no workspace, an orphan and a hidden agent; nothing otherwise", () => {
    expect(cannotStart(entry(), null)).toBeNull();
    expect(cannotStart(entry(), "No workspace")).toBe("No workspace is open");
    expect(cannotStart(entry({ orphan: true }), null)).toContain("gone");
    expect(cannotStart(entry({ hidden: true }), null)).toContain("Hidden");
  });
});

describe("refusedText", () => {
  it("names the cause by the error's code, else says something went wrong", () => {
    expect(refusedText("The session was not started.", "not-found")).toBe("The session was not started. Pomade does not know the agent, or its command is not found.");
    expect(refusedText("x", "weird")).toBe("x Something went wrong.");
    expect(refusedText("x", null)).toBe("x Something went wrong.");
  });
});
