// The Roster's "Connected to" field (DESIGN §3.3): the projects whose "+" menu offers an agent,
// ordered by the agent's work sessions in them over the last 90 days, and how many of them a field
// of a given width names.

import type { ProjectCounts } from "../../../shared/work-sessions.ts";

/** The most project names a card names. */
export const CARD_NAMES = 3;
/** The most a list row names; one fits unless the column is wide. */
export const ROW_NAMES = 2;

/** One connected project, as the field names it. */
export type ConnectedProject = {
  id: string;
  name: string;
  /** The agent's work sessions in the project within the window; 0 for none. */
  sessions: number;
};

/** `connected` (project ids, in the Projects panel's order) ranked: the projects the agent has work
 *  sessions in within the window first, most first; the rest follow in the panel's order. A project
 *  the agent has sessions in but is not connected to does not count. A project whose name is not
 *  known yet is named by its id. */
export function rankConnected(connected: readonly string[], counts: readonly ProjectCounts[], names: ReadonlyMap<string, string>): ConnectedProject[] {
  const sessions = new Map(counts.map((c) => [c.project, c.sessions]));
  return connected
    .map((id, index) => ({ id, name: names.get(id) ?? id, sessions: sessions.get(id) ?? 0, index }))
    .sort((a, b) => b.sessions - a.sessions || a.index - b.index)
    .map(({ id, name, sessions: n }) => ({ id, name, sessions: n }));
}

/** The widths, in px, `fitCount` decides by. */
export type FitWidths = {
  /** What is never dropped: the total and the brackets. */
  fixed: number;
  /** Each candidate name as it would stand — its swatch, its (cut) name, and the ", " before it when it is not the first. */
  items: readonly number[];
  /** The ", …" that says more are connected than named. */
  more: number;
  /** The width the field has. */
  available: number;
  /** How many projects are connected. */
  total: number;
};

/** How many of the candidate names fit: at least one (cut with "…" when even that is too wide), at
 *  most `items.length`; the "…" counts whenever it stands, i.e. while some connected project is
 *  not named. */
export function fitCount({ fixed, items, more, available, total }: FitWidths): number {
  if (items.length === 0) return 0;
  let used = fixed;
  let fits = 1;
  for (const [index, width] of items.entries()) {
    used += width;
    if (used + (total > index + 1 ? more : 0) > available) break;
    fits = index + 1;
  }
  return fits;
}

/** The widest a name stands in the field, in px. */
export const NAME_MAX_WIDTH = 128;

/** `name` cut to stand in `width` px, ending in "…" right after its last letter; `name` itself when
 *  it fits. `measure` gives a text's width. At least the "…" stays, even when it does not fit. */
export function cutName(name: string, width: number, measure: (text: string) => number): string {
  if (measure(name) <= width) return name;
  let low = 0;
  let high = name.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (measure(`${name.slice(0, mid).trimEnd()}…`) <= width) low = mid;
    else high = mid - 1;
  }
  return `${name.slice(0, low).trimEnd()}…`;
}

const WORK_SESSION = (n: number): string => `${n} work session${n === 1 ? "" : "s"}`;

/** The field's tooltip: every connected project, with its work sessions in the window. */
export function connectedTitle(ranked: readonly ConnectedProject[], agentName: string): string {
  const open = `Open ${agentName}'s Projects tab`;
  if (ranked.length === 0) return `Connected to no project. ${open}`;
  const lines = ranked.map((p) => (p.sessions > 0 ? `${p.name} — ${WORK_SESSION(p.sessions)}` : p.name));
  return `Connected to ${ranked.length}, by work sessions in the last 90 days:\n${lines.join("\n")}\n\n${open}`;
}

/** The total as the field writes it: `All 12` when every project of the workspace offers the agent. */
export function connectedTotal(connected: number, projects: number): string {
  return projects > 0 && connected === projects ? `All ${connected}` : String(connected);
}

/** A project's swatch, one of `PROJECT_TINTS`, by a stable hash of its id: Pomade gives a project no colour. */
export const PROJECT_TINTS = ["red", "amber", "green", "teal", "blue", "purple"] as const;
export function projectTint(id: string): (typeof PROJECT_TINTS)[number] {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PROJECT_TINTS[hash % PROJECT_TINTS.length] as (typeof PROJECT_TINTS)[number];
}
