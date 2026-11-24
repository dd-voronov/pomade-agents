// What the Live now panel shows of the backend's rows (DESIGN §2.8): one group per project — the
// active project first with a "current" tag, then the projects in Projects panel order, the
// Workspace last — and in each, Needs you → Working → Idle, then the most recent.

import { WORKSPACE_PROJECT_ID, type ProjectRef } from "pomade-kit/protocol";

import type { LiveRow, LiveRowState } from "../../shared/live-now.ts";
import { needsYouCount } from "../../shared/live-now.ts";

export interface LiveGroup {
  project: string;
  name: string;
  /** The active project's group. */
  current: boolean;
  rows: LiveRow[];
}

const URGENCY: Record<LiveRowState, number> = { "needs-you": 0, working: 1, idle: 2 };

/** Needs you → Working → Idle, then the latest `since` first; ties by tab. */
export function byUrgency(a: LiveRow, b: LiveRow): number {
  return URGENCY[a.state] - URGENCY[b.state] || Date.parse(b.since) - Date.parse(a.since) || (a.tabId < b.tabId ? -1 : a.tabId > b.tabId ? 1 : 0);
}

/** A project's name: Pomade's, "Workspace" for the Workspace, else its id. */
export function projectName(id: string, projects: ReadonlyMap<string, ProjectRef>): string {
  if (id === WORKSPACE_PROJECT_ID) return "Workspace";
  return projects.get(id)?.name ?? id;
}

/** The rows by project, in the panel's order; `projects` is Pomade's list, in Projects panel order. */
export function groupRows(rows: readonly LiveRow[], active: string, projects: ReadonlyMap<string, ProjectRef>): LiveGroup[] {
  const byProject = new Map<string, LiveRow[]>();
  for (const row of rows) byProject.set(row.project, [...(byProject.get(row.project) ?? []), row]);
  const order = [...projects.keys()];
  const rank = (id: string): number => {
    if (id === active) return -1;
    if (id === WORKSPACE_PROJECT_ID) return order.length + 1;
    const at = order.indexOf(id);
    return at === -1 ? order.length : at;
  };
  return [...byProject]
    .sort(([a], [b]) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0))
    .map(([project, list]) => ({ project, name: projectName(project, projects), current: project === active, rows: [...list].sort(byUrgency) }));
}

/** The header's count: "3 running · 1 needs you"; empty with nothing running. */
export function headerCount(rows: readonly LiveRow[]): string {
  if (rows.length === 0) return "";
  const needs = needsYouCount(rows);
  return needs === 0 ? `${rows.length} running` : `${rows.length} running · ${needs} ${needs === 1 ? "needs" : "need"} you`;
}

/** A row's first line: the session's name; unnamed, its first message in grey; no session or no message yet, the agent's name. */
export function rowTitle(row: LiveRow): { text: string; unnamed: boolean } {
  if (row.name !== null) return { text: row.name, unnamed: false };
  if (row.firstMessage !== null) return { text: row.firstMessage, unnamed: true };
  return { text: row.agentName, unnamed: false };
}
