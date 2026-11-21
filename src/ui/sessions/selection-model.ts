// Which session is selected and what the two layouts show around it (DESIGN §2.7), as pure
// functions: the rows ↑ ↓ walk in the table and in the list, the step itself, the status tab the
// list opens, the list's rows, and what the table opens up to show the row it returns to.

import { SESSION_STATUSES, type SessionStatus } from "pomade-kit/protocol";

import type { Session } from "../../shared/sessions.ts";
import { isLong, shownRows, statusOf } from "./table-model.ts";

export type Groups = Record<SessionStatus, readonly Session[]>;

/** The ids of the rows the table shows, top to bottom: every group that is not collapsed, each
 *  long group cut to its latest rows unless it is expanded. */
export function tableOrder(groups: Groups, collapsed: ReadonlySet<SessionStatus>, expanded: ReadonlySet<SessionStatus>): string[] {
  const ids: string[] = [];
  for (const status of SESSION_STATUSES) {
    if (collapsed.has(status)) continue;
    for (const session of shownRows(status, groups[status], expanded.has(status))) ids.push(session.id);
  }
  return ids;
}

/** The session ↑ (`-1`) or ↓ (`1`) selects in `order`. From the selected row: its neighbour, staying
 *  put at either end. With no selected row in `order`: the neighbour of `from` (the row selected
 *  before the panel closed) when it is there, else the first row (↓) or the last (↑). `null` when
 *  `order` is empty. */
export function step(order: readonly string[], selected: string | null, direction: 1 | -1, from: string | null = null): string | null {
  if (order.length === 0) return null;
  const at = (index: number): string | null => order[Math.min(Math.max(index, 0), order.length - 1)] ?? null;
  const current = selected === null ? -1 : order.indexOf(selected);
  if (current >= 0) return at(current + direction);
  const before = from === null ? -1 : order.indexOf(from);
  if (before >= 0) return at(before + direction);
  return direction === 1 ? at(0) : at(order.length - 1);
}

/** A status tab the user opened while a session was selected. */
export interface PickedTab {
  status: SessionStatus;
  /** The session selected then, and its status then. */
  session: string;
  sessionStatus: SessionStatus;
}

/** The list's open status tab: the selected session's status, unless the user opened another tab
 *  while that session was selected with that status. Selecting another session, or the session's
 *  status changing, opens the session's status again. */
export function openTab(selected: Session, picked: PickedTab | null): SessionStatus {
  const status = statusOf(selected);
  if (picked !== null && picked.session === selected.id && picked.sessionStatus === status) return picked.status;
  return status;
}

export interface ListRows {
  rows: readonly Session[];
  /** The tab holds more than the latest rows: "Show all N" or "Show the latest 10 only" shows under them. */
  long: boolean;
  /** Every row shows: expanded by the user, or opened to show the selected session. */
  expanded: boolean;
}

/** The rows of one status tab in the list. A long tab shows its latest rows unless it is expanded or
 *  the selected session is further down: then every row shows. */
export function listRows(status: SessionStatus, sessions: readonly Session[], expanded: boolean, selected: string | null): ListRows {
  const long = isLong(status, sessions.length);
  const cut = shownRows(status, sessions, expanded);
  const hidden = selected !== null && cut.length < sessions.length && !cut.some((s) => s.id === selected) && sessions.some((s) => s.id === selected);
  return hidden ? { rows: sessions, long, expanded: true } : { rows: cut, long, expanded: expanded || !long };
}

/** What the table opens so the row `id` shows: its group uncollapsed, and expanded when the row is
 *  past the latest rows. Unchanged sets come back as they were, so nothing re-renders for nothing. */
export function revealInTable(
  groups: Groups,
  id: string,
  collapsed: ReadonlySet<SessionStatus>,
  expanded: ReadonlySet<SessionStatus>,
): { collapsed: ReadonlySet<SessionStatus>; expanded: ReadonlySet<SessionStatus> } {
  const status = SESSION_STATUSES.find((s) => groups[s].some((session) => session.id === id));
  if (status === undefined) return { collapsed, expanded };
  let nextCollapsed = collapsed;
  if (collapsed.has(status)) {
    const set = new Set(collapsed);
    set.delete(status);
    nextCollapsed = set;
  }
  let nextExpanded = expanded;
  if (!expanded.has(status) && !shownRows(status, groups[status], false).some((s) => s.id === id)) nextExpanded = new Set([...expanded, status]);
  return { collapsed: nextCollapsed, expanded: nextExpanded };
}
