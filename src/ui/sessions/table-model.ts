// What the Sessions table shows, as pure functions of the sessions (DESIGN §2.7): which sessions
// are in the tab's scope, their status groups in order, the ~$ sums, the latest-10 rule, the
// columns that fit the width, and how each value reads.

import { SESSION_STATUSES, WORKSPACE_PROJECT_ID, type SessionStatus } from "pomade-kit/protocol";

import { contextPercent, type Session } from "../../shared/sessions.ts";
import { LIVE_LABELS } from "../core/live.ts";

export const STATUS_LABELS: Record<SessionStatus, string> = {
  active: "Active",
  "on-hold": "On hold",
  done: "Done",
  "done-skip": "Done–skip/Failed",
};

/** The statuses where room is short — the list's status tabs and the detail panel's status buttons;
 *  each carries its full label as a tooltip. */
export const STATUS_SHORT_LABELS: Record<SessionStatus, string> = {
  active: "Active",
  "on-hold": "On hold",
  done: "Done",
  "done-skip": "Skip/Failed",
};

/** The one line an empty group shows. */
export const EMPTY_GROUP_TEXT: Record<SessionStatus, string> = {
  active: "Nothing active. New sessions start here.",
  "on-hold": "Nothing on hold.",
  done: "Nothing done yet.",
  "done-skip": "Nothing skipped or failed.",
};

// ── Scope, status, order ────────────────────────────────────────────────────

/** True when a session shows in the tab of `scopeId`: the Workspace's tab shows every session, a
 *  project's tab the sessions attributed to it (a shared-folder session shows in each of its projects). */
export function inScope(session: Session, scopeId: string): boolean {
  return scopeId === WORKSPACE_PROJECT_ID || session.attribution.projects.includes(scopeId);
}

/** A session's status; one without a record yet (the first run still adopting it) is Done. */
export function statusOf(session: Session): SessionStatus {
  return session.record?.status ?? "done";
}

const activityTime = (session: Session): number => {
  const at = session.summary.lastActiveAt;
  const time = at === null ? NaN : Date.parse(at);
  return Number.isNaN(time) ? -Infinity : time;
};

/** Newest activity first; a session with no recorded time last; ties by id, so the order is stable. */
export function byActivity(a: Session, b: Session): number {
  const ta = activityTime(a);
  const tb = activityTime(b);
  if (ta !== tb) return tb > ta ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The scope's sessions in their four status groups, each newest activity first. */
export function groupByStatus(sessions: Iterable<Session>, scopeId: string): Record<SessionStatus, Session[]> {
  const groups = Object.fromEntries(SESSION_STATUSES.map((status) => [status, [] as Session[]])) as Record<SessionStatus, Session[]>;
  for (const session of sessions) if (inScope(session, scopeId)) groups[statusOf(session)].push(session);
  for (const status of SESSION_STATUSES) groups[status].sort(byActivity);
  return groups;
}

// ── Sums ────────────────────────────────────────────────────────────────────

/** The sum of the known ~$ estimates; `null` when no session in the set has one. */
export function costSum(sessions: readonly Session[]): number | null {
  let sum: number | null = null;
  for (const session of sessions) if (session.summary.costUsd !== null) sum = (sum ?? 0) + session.summary.costUsd;
  return sum;
}

/** The work sessions of a set (`Session.work`, DESIGN §2.9): what every count and sum takes. */
export function workSessions(sessions: readonly Session[]): Session[] {
  return sessions.filter((session) => session.work);
}

/** The sum of the known ~$ estimates of a set's work sessions; `null` when none has one. */
export function workCost(sessions: readonly Session[]): number | null {
  return costSum(workSessions(sessions));
}

// ── The latest-10 rule ──────────────────────────────────────────────────────

/** How many rows a long Done or Done–skip/Failed group shows until "Show all". */
export const LATEST_SHOWN = 10;
/** A group holding more than this many rows is cut to the latest `LATEST_SHOWN`. */
export const CUT_ABOVE = 12;

/** Whether a group with `count` rows is long enough to be cut to the latest rows. */
export function isLong(status: SessionStatus, count: number): boolean {
  return (status === "done" || status === "done-skip") && count > CUT_ABOVE;
}

/** The rows a group shows: the latest `LATEST_SHOWN` of a long group unless it is expanded. */
export function shownRows<T>(status: SessionStatus, rows: readonly T[], expanded: boolean): readonly T[] {
  return isLong(status, rows.length) && !expanded ? rows.slice(0, LATEST_SHOWN) : rows;
}

// ── Columns ─────────────────────────────────────────────────────────────────

/** The columns that can leave as the table narrows, in the order they leave. */
export const DROP_ORDER = ["effort", "model", "cost", "context", "agent"] as const;
export type DroppableColumn = (typeof DROP_ORDER)[number];

/** Which columns a table shows. The name, last active and the row's actions always show; the project in the Workspace's tab. */
export type Columns = { project: boolean } & Record<DroppableColumn, boolean>;

/** Column widths in px, cell padding included. */
export const COLUMN_WIDTH = {
  project: 132,
  agent: 108,
  /** The model with its effort; `modelOnly` when the effort has left. */
  model: 204,
  modelOnly: 140,
  context: 82,
  cost: 74,
  last: 84,
  /** The row's hover actions: Open / Resume and ⋯. */
  actions: 56,
} as const;

/** The name column never gets narrower than this (its cell padding included). */
export const NAME_MIN_WIDTH = 240;
/** The row's own padding, both sides. */
export const ROW_PADDING = 16;

function fixedWidth(columns: Columns): number {
  let width = ROW_PADDING + COLUMN_WIDTH.last + COLUMN_WIDTH.actions;
  if (columns.project) width += COLUMN_WIDTH.project;
  if (columns.agent) width += COLUMN_WIDTH.agent;
  if (columns.model) width += columns.effort ? COLUMN_WIDTH.model : COLUMN_WIDTH.modelOnly;
  if (columns.context) width += COLUMN_WIDTH.context;
  if (columns.cost) width += COLUMN_WIDTH.cost;
  return width;
}

/** The columns that fit `width` px while the name keeps `NAME_MIN_WIDTH`; they leave in `DROP_ORDER`. */
export function columnsFor(width: number, workspace: boolean): Columns {
  const columns: Columns = { project: workspace, effort: true, model: true, cost: true, context: true, agent: true };
  for (const column of DROP_ORDER) {
    if (fixedWidth(columns) + NAME_MIN_WIDTH <= width) break;
    columns[column] = false;
  }
  if (!columns.model) columns.effort = false;
  return columns;
}

/** The CSS grid template of a row: the name takes what the other columns leave. */
export function columnTemplate(columns: Columns): string {
  const px = (n: number): string => `${n}px`;
  const tracks = [`minmax(0, 1fr)`];
  if (columns.project) tracks.push(px(COLUMN_WIDTH.project));
  if (columns.agent) tracks.push(px(COLUMN_WIDTH.agent));
  if (columns.model) tracks.push(px(columns.effort ? COLUMN_WIDTH.model : COLUMN_WIDTH.modelOnly));
  if (columns.context) tracks.push(px(COLUMN_WIDTH.context));
  if (columns.cost) tracks.push(px(COLUMN_WIDTH.cost));
  tracks.push(px(COLUMN_WIDTH.last), px(COLUMN_WIDTH.actions));
  return tracks.join(" ");
}

// ── How values read ─────────────────────────────────────────────────────────

const MONEY = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "~$1,234.50". */
export function formatMoney(usd: number): string {
  return `~$${MONEY.format(usd)}`;
}

/** True when the tab lists the session: it is in the scope, and not hidden unless the hidden ones are shown. */
export function isListed(session: Session, scopeId: string, showHidden: boolean): boolean {
  return inScope(session, scopeId) && (showHidden || session.hidden === null);
}

/** The header's summary of the work sessions: "3 work sessions · ~$4.20 est."; the sum is left out when no cost is known. */
export function formatHeaderSum(count: number, cost: number | null): string {
  const sessions = count === 1 ? "1 work session" : `${count} work sessions`;
  return cost === null ? sessions : `${sessions} · ${formatMoney(cost)} est.`;
}

export type ContextLevel = "normal" | "high" | "full";

/** Amber from 75 %, red from 90 %. */
export function contextLevel(percent: number): ContextLevel {
  return percent >= 90 ? "full" : percent >= 75 ? "high" : "normal";
}

/** The context meter: whole percent, its level, and the bar's fill (capped at 100). */
export function contextMeter(context: { used: number; window: number }): { percent: number; level: ContextLevel; fill: number } {
  const percent = Math.round(contextPercent(context));
  return { percent, level: contextLevel(percent), fill: Math.min(percent, 100) };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MINUTE = 60_000;
const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const daysBetween = (from: Date, to: Date): number => Math.round((startOfDay(to) - startOfDay(from)) / 86_400_000);
const pad2 = (n: number): string => String(n).padStart(2, "0");

const parse = (iso: string | null): Date | null => {
  if (iso === null) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Last active, relative to `now` in local time: "now", "5m", "3h" (today), "yesterday", "4d"
 *  (within a week), "Nov 3" (this year), "Nov 2025" (another year); "—" with no time. */
export function formatAgo(iso: string | null, now: Date): string {
  const at = parse(iso);
  if (at === null) return "—";
  const minutes = Math.floor((now.getTime() - at.getTime()) / MINUTE);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const days = daysBetween(at, now);
  if (days === 0) return `${Math.floor(minutes / 60)}h`;
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d`;
  if (at.getFullYear() === now.getFullYear()) return `${MONTHS[at.getMonth()]} ${at.getDate()}`;
  return `${MONTHS[at.getMonth()]} ${at.getFullYear()}`;
}

/** The full time, for the tooltip: "Today, 09:05", "Yesterday, 18:40", "Nov 3, 09:05", "Nov 3, 2025, 09:05". */
export function formatStamp(iso: string | null, now: Date): string {
  const at = parse(iso);
  if (at === null) return "No time recorded";
  const time = `${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
  const days = daysBetween(at, now);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  const year = at.getFullYear() === now.getFullYear() ? "" : `, ${at.getFullYear()}`;
  return `${MONTHS[at.getMonth()]} ${at.getDate()}${year}, ${time}`;
}

/** A time after "since": "09:05" today, "yesterday, 18:40", "Nov 3, 09:05". */
export function sinceStamp(iso: string | null, now: Date): string {
  return formatStamp(iso, now).replace(/^Today, /, "").replace(/^Yesterday\b/, "yesterday");
}

/** The live mark's tooltip, "Working since 09:05"; `null` for a Closed session, which shows no mark. */
export function liveTitle(session: Session, now: Date): string | null {
  if (session.live === "closed") return null;
  const label = LIVE_LABELS[session.live];
  return session.liveSince === null ? label : `${label} since ${sinceStamp(session.liveSince, now)}`;
}

// ── A row's texts ───────────────────────────────────────────────────────────

/** The row's name: the session's name, or — unnamed — its first message, shown in grey. */
export function rowName(session: Session): { text: string; unnamed: boolean } {
  const name = session.record?.name;
  if (name !== undefined) return { text: name, unnamed: false };
  const first = session.summary.firstMessage?.text.replace(/\s+/g, " ").trim();
  return { text: first || "No message yet", unnamed: true };
}

/** The projects a session shows in, by name, for the Workspace's Project column; "Workspace" for the
 *  Workspace bucket. A project missing from `names` shows by its id. */
export function projectLabel(session: Session, names: ReadonlyMap<string, string>): string {
  const projects = session.attribution.projects;
  if (projects.length === 0) return "Workspace";
  return projects.map((id) => names.get(id) ?? id).join(", ");
}

export type Chip = { kind: "hidden" | "runner" | "shared-folder" | "outside-pomade"; text: string; tooltip: string };

/** The row's chips: why it is hidden ("hidden — no messages"), an unattended run (⏱ + job),
 *  "shared folder", "outside Pomade". */
export function chipsOf(session: Session, names: ReadonlyMap<string, string>): Chip[] {
  const chips: Chip[] = [];
  if (session.hidden === "empty") chips.push({ kind: "hidden", text: "hidden — no messages", tooltip: "Hidden from the tab: no message from you and no answer yet. It shows once it has one." });
  const job = session.record?.startedByRunner?.job;
  if (job !== undefined) chips.push({ kind: "runner", text: job, tooltip: `Started by Runner job ${job}, unattended` });
  if (session.attribution.sharedFolder) {
    const projects = session.attribution.projects.map((id) => names.get(id) ?? id).join(" and ");
    chips.push({ kind: "shared-folder", text: "shared folder", tooltip: `Its start folder is the root of ${projects}` });
  }
  if (session.record?.outsidePomade) chips.push({ kind: "outside-pomade", text: "outside Pomade", tooltip: "Started outside Pomade: no tab, no live state" });
  return chips;
}

/** The fork mark's tooltip, naming the parent session when it is known; `null` for a session that is no fork. */
export function forkTooltip(session: Session, byId: ReadonlyMap<string, Session>): string | null {
  const parentId = session.record?.forkedFrom;
  if (parentId === undefined) return null;
  const parent = byId.get(parentId);
  return parent === undefined ? "Forked from another session" : `Forked from “${rowName(parent).text}”`;
}

/** Why a context or cost shows "—". */
export function unknownReason(session: Session): string {
  return session.summary.model === null ? "No answer from the agent yet" : `${session.summary.model} is not in the price table`;
}
