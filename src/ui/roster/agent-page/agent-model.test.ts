import { describe, expect, it } from "vitest";

import type { AgentProfile, RosterEntry } from "../../../shared/roster.ts";
import { chipsOf, claudeMdOf, isBuiltin, isEditable, modelText, openPathOf, profileFileOf, providerOf } from "./agent-model.ts";

const PROFILE: AgentProfile = { id: "claude-libra", provider: "claude", kind: "folder", configDir: "Agents/claude-libra", command: "claude-libra", tags: [], hidden: false, modes: {} };
const entry = (over: Partial<RosterEntry> = {}): RosterEntry => ({
  id: "claude-libra",
  name: "claude-libra",
  profile: PROFILE,
  problem: null,
  orphan: false,
  configDir: "/ws/Agents/claude-libra",
  model: "opus",
  effort: "high",
  ...over,
});

describe("provider", () => {
  it("is the profile's; for an agent with no usable profile the built-in's own, else Claude Code", () => {
    expect(providerOf(entry())).toBe("claude");
    expect(providerOf(entry({ id: "codex", profile: { ...PROFILE, id: "codex", provider: "codex", kind: "builtin" } }))).toBe("codex");
    expect(providerOf(entry({ id: "codex", profile: null }))).toBe("codex");
    expect(providerOf(entry({ profile: null }))).toBe("claude");
  });

  it("tells a built-in by its profile, or by its id without one", () => {
    expect(isBuiltin(entry())).toBe(false);
    expect(isBuiltin(entry({ id: "claude", profile: null }))).toBe(true);
    expect(isBuiltin(entry({ profile: { ...PROFILE, kind: "builtin" } }))).toBe(true);
    expect(isBuiltin(entry({ profile: null }))).toBe(false);
  });
});

describe("state chips", () => {
  it("has none for a plain folder agent", () => {
    expect(chipsOf(entry())).toEqual([]);
  });

  it("names a built-in, an orphan, an unreadable profile and a hidden agent", () => {
    expect(chipsOf(entry({ profile: { ...PROFILE, kind: "builtin", hidden: true } })).map((c) => c.key)).toEqual(["builtin", "hidden"]);
    expect(chipsOf(entry({ orphan: true })).map((c) => [c.key, c.tone])).toEqual([["orphan", "warn"]]);
    expect(chipsOf(entry({ profile: null, problem: "line 3 is wrong" }))).toEqual([{ key: "problem", label: "agent.yaml can’t be read", tone: "warn", title: "line 3 is wrong" }]);
  });
});

describe("editing and the model line", () => {
  it("edits only a usable profile of an agent that is not an orphan", () => {
    expect(isEditable(entry())).toBe(true);
    expect(isEditable(entry({ profile: null }))).toBe(false);
    expect(isEditable(entry({ orphan: true }))).toBe(false);
  });

  it("shows the effort only with a model", () => {
    expect(modelText(entry())).toEqual({ model: "opus", effort: "high" });
    expect(modelText(entry({ model: null, effort: "high" }))).toEqual({ model: null, effort: null });
  });
});

describe("paths", () => {
  const roots = { workspace: "/ws", workspaceReal: "/private/ws" };

  it("opens a file inside the workspace by its workspace-relative path, as Pomade names the workspace or resolved", () => {
    expect(openPathOf("/ws/Agents/a/CLAUDE.md", roots)).toBe("Agents/a/CLAUDE.md");
    expect(openPathOf("/private/ws/Agents/a/CLAUDE.md", roots)).toBe("Agents/a/CLAUDE.md");
  });

  it("opens any other file by its absolute path", () => {
    expect(openPathOf("/Users/x/.claude/settings.json", roots)).toBe("/Users/x/.claude/settings.json");
    expect(openPathOf("/wsx/a", roots)).toBe("/wsx/a");
    expect(openPathOf("/ws/a", { workspace: null, workspaceReal: null })).toBe("/ws/a");
  });

  it("finds the profile file and CLAUDE.md", () => {
    expect(profileFileOf("/ws/Apps/pomade-agents", "claude-libra")).toBe("/ws/Apps/pomade-agents/agents/claude-libra/agent.yaml");
    expect(profileFileOf(null, "claude-libra")).toBeNull();
    expect(claudeMdOf(entry())).toBe("/ws/Agents/claude-libra/CLAUDE.md");
    expect(claudeMdOf(entry({ id: "codex", profile: { ...PROFILE, provider: "codex" }, configDir: "/h/.codex" }))).toBeNull();
    expect(claudeMdOf(entry({ configDir: null }))).toBeNull();
  });
});
