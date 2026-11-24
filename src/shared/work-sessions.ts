// Work sessions (DESIGN §2.9, docs/CONTRACTS.md "Agent counts"): the one rule that decides which
// sessions count, and the read the Roster's frames show from it — per agent, its last activity,
// its work sessions and ~$ within a week the caller names, and per project its work sessions within
// a window the caller names and its last session's time.
//
// Every count and sum the app shows is over work sessions, through `isWorkSession`: the backend
// sets `Session.work` from it, and the UI, the command and other apps read that field. A window
// ("this week", "the last 90 days") is the caller's, never part of the rule.
//
// The shapes are type aliases, so they are JSON values to the broker as they are.

import { WORKSPACE_PROJECT_ID } from "pomade-kit/protocol";

import type { Session, SessionsSince } from "./sessions.ts";

/** The per-agent counts over work sessions; answers `AgentCountsAnswer`. */
export const SESSIONS_AGENT_COUNTS_METHOD = "sessions.agentCounts";

/** What the rule reads of a session. */
export type WorkSessionFacts = Pick<Session, "summary" | "record">;

/** True for a work session: every session is one unless its status is Done–skip/Failed. A
 *  session without a record yet counts. */
export function isWorkSession(session: WorkSessionFacts): boolean {
  return session.record?.status !== "done-skip";
}

export type AgentCountsParams = {
  /** The week's start, ISO 8601: `week` counts the work sessions active from then on. */
  weekFrom: string;
  /** The per-project window's start, ISO 8601: `ProjectCounts.sessions` counts the work sessions active from then on. */
  projectsFrom: string;
};

/** One project an agent has work sessions in. */
export type ProjectCounts = {
  /** The stable project id; `"__workspace__"` for the Workspace bucket. */
  project: string;
  /** The agent's work sessions in the project active within the window (`projectsFrom` on). */
  sessions: number;
  /** The last activity of the agent's latest work session in the project, ever (ISO 8601); `null` when none records a time. */
  lastAt: string | null;
};

/** One agent's counts. */
export type AgentCounts = {
  /** Roster id. */
  agent: string;
  /** The last activity of its latest work session (ISO 8601); `null` when none records a time. */
  lastActiveAt: string | null;
  /** Its work sessions active within the week (`weekFrom` on), and the sum of their known ~$
   *  estimates — `null` when none of them has one. */
  week: { sessions: number; costUsd: number | null };
  /** Every project it has a work session in, ever — most sessions within the window first, then
   *  the latest last session. A session showing in several projects (a shared folder) counts in each. */
  projects: ProjectCounts[];
};

export type AgentCountsAnswer = {
  /** The sessions' `epoch` and `revision` the counts are of: a `sessions.changed` notice past them
   *  means the counts may have changed — ask again. */
  epoch: string;
  revision: number;
  /** True while the first walk of the stores is still running: the counts are partial. */
  indexing: boolean;
  /** Every agent with a work session, by roster id. An agent missing here has none: zero, no time. */
  agents: AgentCounts[];
  /** Every agent with at least one session of any status, Skip/Failed included, by roster id: one
   *  missing here has never run a session (Needs login, DESIGN §3.6). */
  withSessions: string[];
};

/** When a session was last active, in ms: its last record, else its start; `null` with neither. */
function activeAt(session: Session): number | null {
  const at = session.summary.lastActiveAt ?? session.summary.startedAt;
  if (at === null) return null;
  const time = Date.parse(at);
  return Number.isNaN(time) ? null : time;
}

type Tally = { sessions: number; lastAt: number | null };

const later = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : Math.max(a, b));
const iso = (time: number | null): string | null => (time === null ? null : new Date(time).toISOString());

/** The counts of `AgentCountsAnswer.agents` over `sessions`, within the windows `params` names. */
export function agentCounts(sessions: Iterable<Session>, params: AgentCountsParams): AgentCounts[] {
  const weekFrom = Date.parse(params.weekFrom);
  const projectsFrom = Date.parse(params.projectsFrom);
  type Agent = { lastAt: number | null; week: { sessions: number; costUsd: number | null }; projects: Map<string, Tally> };
  const agents = new Map<string, Agent>();
  for (const session of sessions) {
    if (!session.work) continue;
    const at = activeAt(session);
    const id = session.summary.agent;
    let agent = agents.get(id);
    if (agent === undefined) {
      agent = { lastAt: null, week: { sessions: 0, costUsd: null }, projects: new Map() };
      agents.set(id, agent);
    }
    agent.lastAt = later(agent.lastAt, at);
    if (at !== null && at >= weekFrom) {
      agent.week.sessions += 1;
      const cost = session.summary.costUsd;
      if (cost !== null) agent.week.costUsd = (agent.week.costUsd ?? 0) + cost;
    }
    const projects = session.attribution.projects.length === 0 ? [WORKSPACE_PROJECT_ID] : session.attribution.projects;
    for (const project of projects) {
      const tally = agent.projects.get(project) ?? { sessions: 0, lastAt: null };
      if (at !== null && at >= projectsFrom) tally.sessions += 1;
      tally.lastAt = later(tally.lastAt, at);
      agent.projects.set(project, tally);
    }
  }
  return [...agents].map(([agent, { lastAt, week, projects }]) => ({
    agent,
    lastActiveAt: iso(lastAt),
    week,
    projects: [...projects]
      .sort(([, a], [, b]) => b.sessions - a.sessions || (b.lastAt ?? -Infinity) - (a.lastAt ?? -Infinity))
      .map(([project, { sessions: count, lastAt: last }]) => ({ project, sessions: count, lastAt: iso(last) })),
  }));
}

/** The roster ids with at least one session, of any status, in id order. */
export function agentsWithSessions(sessions: Iterable<Session>): string[] {
  const ids = new Set<string>();
  for (const session of sessions) ids.add(session.summary.agent);
  return [...ids].sort();
}

// ── Checks for values that crossed the broker ───────────────────────────────

type Shape = Record<string, unknown>;

const isObject = (v: unknown): v is Shape => typeof v === "object" && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isTimeOrNull = (v: unknown): boolean => v === null || (typeof v === "string" && !Number.isNaN(Date.parse(v)));

function isProjectCounts(v: unknown): v is ProjectCounts {
  return isObject(v) && typeof v.project === "string" && v.project !== "" && isCount(v.sessions) && isTimeOrNull(v.lastAt);
}

function isAgentCounts(v: unknown): v is AgentCounts {
  if (!isObject(v) || !isObject(v.week)) return false;
  const { costUsd } = v.week;
  return (
    typeof v.agent === "string" &&
    v.agent !== "" &&
    isTimeOrNull(v.lastActiveAt) &&
    isCount(v.week.sessions) &&
    (costUsd === null || (typeof costUsd === "number" && Number.isFinite(costUsd) && costUsd >= 0)) &&
    Array.isArray(v.projects) &&
    v.projects.every(isProjectCounts)
  );
}

/** True for a well-formed `sessions.agentCounts` answer. */
export function isAgentCountsAnswer(value: unknown): value is AgentCountsAnswer {
  return (
    isObject(value) &&
    typeof value.epoch === "string" &&
    isCount(value.revision) &&
    typeof value.indexing === "boolean" &&
    Array.isArray(value.agents) &&
    value.agents.every(isAgentCounts) &&
    Array.isArray(value.withSessions) &&
    value.withSessions.every((id) => typeof id === "string" && id !== "")
  );
}

/** The sessions' place an answer is of. */
export function countsSince(answer: AgentCountsAnswer): SessionsSince {
  return { epoch: answer.epoch, revision: answer.revision };
}
