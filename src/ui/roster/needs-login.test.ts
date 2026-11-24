import { describe, expect, it } from "vitest";

import type { AgentProfile, RosterEntry } from "../../shared/roster.ts";
import { needsLogin, setupPrompt, setupPromptOf, type SessionFacts } from "./needs-login.ts";

const profile = (over: Partial<AgentProfile> = {}): AgentProfile => ({
  id: "claude-tax",
  provider: "claude",
  kind: "folder",
  configDir: "Agents/claude-tax",
  command: "claude-tax",
  role: "Files the taxes.",
  tags: ["tax", "personal"],
  hidden: false,
  modes: { normal: { enabled: true } },
  ...over,
});
const entry = (over: Partial<RosterEntry> = {}): RosterEntry => {
  const p = over.profile === undefined ? profile() : over.profile;
  return { id: "claude-tax", name: "claude-tax", profile: p, problem: null, orphan: false, configDir: "/ws/Agents/claude-tax", model: null, effort: null, provider: p?.provider ?? "claude", kind: p?.kind ?? "folder", hidden: false, ...over };
};
const facts = (ids: string[], indexing = false): SessionFacts => ({ indexing, withSessions: new Set(ids) });

describe("Needs login", () => {
  it("holds for a Claude Code folder agent with no session, and clears with its first", () => {
    expect(needsLogin(entry(), facts(["claude"]))).toBe(true);
    expect(needsLogin(entry(), facts(["claude", "claude-tax"]))).toBe(false);
  });

  it("never holds before the counts are in, or while the stores are first walked", () => {
    expect(needsLogin(entry(), null)).toBe(false);
    expect(needsLogin(entry(), facts([], true))).toBe(false);
  });

  it("never holds for a built-in, a Codex agent, an orphan or an unreadable profile", () => {
    expect(needsLogin(entry({ id: "claude", profile: profile({ id: "claude", kind: "builtin", configDir: "~/.claude" }) }), facts([]))).toBe(false);
    expect(needsLogin(entry({ profile: profile({ provider: "codex" }) }), facts([]))).toBe(false);
    expect(needsLogin(entry({ orphan: true }), facts([]))).toBe(false);
    expect(needsLogin(entry({ profile: null, problem: "bad yaml" }), facts([]))).toBe(false);
  });
});

describe("the setup prompt", () => {
  it("names the agent, its role and its tags", () => {
    expect(setupPrompt("claude-tax", " Files the taxes. ", ["tax", "personal"])).toBe("Use the creating-claude-agent skill to set up claude-tax: role “Files the taxes.”, tags tax, personal.");
    expect(setupPromptOf(entry())).toBe("Use the creating-claude-agent skill to set up claude-tax: role “Files the taxes.”, tags tax, personal.");
  });

  it("leaves out what the agent lacks", () => {
    expect(setupPrompt("claude-tax", "Files the taxes.", [])).toBe("Use the creating-claude-agent skill to set up claude-tax: role “Files the taxes.”.");
    expect(setupPrompt("claude-tax", undefined, ["tax"])).toBe("Use the creating-claude-agent skill to set up claude-tax: tags tax.");
    expect(setupPrompt("claude-tax", "", [])).toBe("Use the creating-claude-agent skill to set up claude-tax.");
  });
});
