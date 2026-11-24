// The first run of a new agent (DESIGN §3.6), as pure functions: whether an agent still **Needs
// login**, and the setup prompt the user pastes after `/login`.
//
// Needs login is read from session data alone: a Claude Code folder agent with no session of any
// status in its store has never been prompted, and a fresh config folder is logged out (the
// `/login` step is Claude Code's own). Its first session clears it — the counts are asked again on
// `sessions.changed`, so no reload is needed. While the first walk of the stores runs the answer is
// partial, and no agent is said to need login.

import type { RosterEntry } from "../../shared/roster.ts";

/** What Needs login reads of the agents' sessions: `useAgentCounts`' view. */
export interface SessionFacts {
  indexing: boolean;
  withSessions: ReadonlySet<string>;
}

/** The chip's text, on the card and the agent's page. */
export const NEEDS_LOGIN_LABEL = "Needs login";

/** True for a Claude Code folder agent the roster answers for that has no session yet; `false` until the counts are in. */
export function needsLogin(entry: RosterEntry, sessions: SessionFacts | null): boolean {
  if (sessions === null || sessions.indexing) return false;
  if (entry.profile === null || entry.provider !== "claude" || entry.kind !== "folder" || entry.orphan) return false;
  return !sessions.withSessions.has(entry.id);
}

/** The prompt that has the `creating-claude-agent` skill write the agent's identity. */
export function setupPrompt(name: string, role: string | undefined, tags: readonly string[]): string {
  const parts = [role === undefined || role.trim() === "" ? null : `role “${role.trim()}”`, tags.length === 0 ? null : `tags ${tags.join(", ")}`].filter((p) => p !== null);
  return `Use the creating-claude-agent skill to set up ${name}${parts.length === 0 ? "" : `: ${parts.join(", ")}`}.`;
}

/** The setup prompt for an agent on the roster, from its profile. */
export function setupPromptOf(entry: RosterEntry): string {
  return setupPrompt(entry.id, entry.profile?.role, entry.profile?.tags ?? []);
}
