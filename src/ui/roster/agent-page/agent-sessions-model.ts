// The sessions the agent's Sessions tab lists: this agent's, in every project, newest activity first,
// optionally of one project, cut to the latest `SESSIONS_SHOWN`. Hidden sessions (`Session.hidden`)
// are left out, as in the Sessions tab.

import type { Session } from "../../../shared/sessions.ts";
import { NO_FILTERS, filterMenu, projectsOf, type Criteria, type FilterMenu } from "../../sessions/search-model.ts";
import { byActivity } from "../../sessions/table-model.ts";

/** How many rows the tab lists. */
export const SESSIONS_SHOWN = 50;

export interface AgentSessions {
  /** The latest of the agent's sessions (of `project`, when one is chosen). */
  rows: Session[];
  /** How many sessions the agent has (of `project`, when one is chosen). */
  total: number;
  /** The Project filter's menu: the projects the agent has sessions in, with counts. */
  projects: FilterMenu;
}

const everything: Criteria = { pattern: null, filters: NO_FILTERS, folder: () => ({ key: "none", label: "" }) };

export function agentSessions(sessions: Iterable<Session>, agent: string, project: string | null, names: ReadonlyMap<string, string>): AgentSessions {
  const mine = [...sessions].filter((s) => s.summary.agent === agent && s.hidden === null).sort(byActivity);
  const chosen = mine.filter((s) => project === null || projectsOf(s).includes(project));
  return {
    rows: chosen.slice(0, SESSIONS_SHOWN),
    total: chosen.length,
    projects: filterMenu("project", mine, everything, names),
  };
}
