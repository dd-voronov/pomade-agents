// The Roster's windows and its reading of `sessions.agentCounts` (DESIGN §3.3–3.4): "this week" is
// the local calendar week from Monday 00:00; the per-project window is the last 90 days, from the
// start of the local day 90 days back. Both stay the same all day, so a frame that renews `now`
// asks again only when a day turns.

import type { AgentCounts, AgentCountsAnswer, AgentCountsParams } from "../../shared/work-sessions.ts";

/** The per-project window's length in days. */
export const PROJECT_WINDOW_DAYS = 90;

/** The Roster's windows at `now`, in local time. */
export function rosterWindows(now: Date): AgentCountsParams {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sinceMonday = (today.getDay() + 6) % 7;
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - sinceMonday);
  const projectsFrom = new Date(today.getFullYear(), today.getMonth(), today.getDate() - PROJECT_WINDOW_DAYS);
  return { weekFrom: monday.toISOString(), projectsFrom: projectsFrom.toISOString() };
}

/** An agent with no work session: zero, no times. */
export function noCounts(agent: string): AgentCounts {
  return { agent, lastActiveAt: null, week: { sessions: 0, costUsd: null }, projects: [] };
}

/** The answer's counts by roster id. */
export function countsByAgent(answer: AgentCountsAnswer): ReadonlyMap<string, AgentCounts> {
  return new Map(answer.agents.map((counts) => [counts.agent, counts]));
}

/** This week's work sessions and ~$ across agents: the Roster header's. `costUsd` is `null` when no
 *  session in the week has an estimate. */
export function weekTotal(agents: Iterable<AgentCounts>): AgentCounts["week"] {
  let sessions = 0;
  let costUsd: number | null = null;
  for (const { week } of agents) {
    sessions += week.sessions;
    if (week.costUsd !== null) costUsd = (costUsd ?? 0) + week.costUsd;
  }
  return { sessions, costUsd };
}
