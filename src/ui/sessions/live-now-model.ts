// What the Live now panel shows of the backend's rows (DESIGN §2.8): one group per project — the
// active project first with a "current" tag, then the projects in Projects panel order, the
// Workspace last — and in each, Needs you → Working → Idle, then the most recent. Unattended runs
// are rows like the tabs (always Working) and count in "N running"; they never need you.

import { WORKSPACE_PROJECT_ID, type ProjectRef } from "pomade-kit/protocol";

import type { LiveRow, LiveRowState } from "../../shared/live-now.ts";
import { liveRowKey, needsYouCount } from "../../shared/live-now.ts";
import { LIVE_LABELS } from "../core/live.ts";
import { sinceStamp } from "./table-model.ts";

export interface LiveGroup {
  project: string;
  name: string;
  /** The active project's group. */
  current: boolean;
  rows: LiveRow[];
}

const URGENCY: Record<LiveRowState, number> = { "needs-you": 0, working: 1, idle: 2 };

/** Needs you → Working → Idle, then the latest `since` first; ties by tab or run. */
export function byUrgency(a: LiveRow, b: LiveRow): number {
  const [ka, kb] = [liveRowKey(a), liveRowKey(b)];
  return URGENCY[a.state] - URGENCY[b.state] || Date.parse(b.since) - Date.parse(a.since) || (ka < kb ? -1 : ka > kb ? 1 : 0);
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

/** What a group header's click opens to switch to its project: its first agent tab, else its first
 *  run that has a terminal to open; `null` when it has neither. */
export function groupTarget(group: LiveGroup): LiveRow | null {
  return group.rows.find((row) => row.kind === "tab") ?? group.rows.find((row) => row.kind === "run" && row.terminal !== null) ?? null;
}

/** A row's first line: a run's job name; a tab's session's name; unnamed, its first message in grey; no session or no message yet, the agent's name. */
export function rowTitle(row: LiveRow): { text: string; unnamed: boolean } {
  if (row.kind === "run") return { text: row.name, unnamed: false };
  if (row.name !== null) return { text: row.name, unnamed: false };
  if (row.firstMessage !== null) return { text: row.firstMessage, unnamed: true };
  return { text: row.agentName, unnamed: false };
}

/** A row's tooltip: its state since when, as the rows and the detail panel say it, and what its
 *  click does — "Working since 09:05 — switches project and focuses the tab". */
export function rowTooltip(row: LiveRow, now: Date): string {
  const click =
    row.kind === "tab" ? "switches project and focuses the tab" : row.terminal === null ? "Runner did not say which terminal it runs in" : "opens the run’s terminal tab";
  return `${LIVE_LABELS[row.state]} since ${sinceStamp(row.since, now)} — ${click}`;
}
