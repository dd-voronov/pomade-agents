// Checking several sessions and changing their status at once (ARCHITECTURE §2.7 "Selecting several",
// "Changing a status"), as pure functions: a toggle, a Shift range, Shift+↑↓, the header
// checkbox's state, which sessions a row's menu or a drag acts on, what the toast says, and how an
// Undo sets the earlier statuses back.

import type { SessionStatus } from "pomade-kit/protocol";

import type { Session } from "../../shared/sessions.ts";
import { STATUS_LABELS, rowName, statusOf } from "./table-model.ts";

/** The checked sessions' ids, in the order they were checked. */
export type Checked = ReadonlySet<string>;

export const NONE_CHECKED: Checked = new Set();

/** `checked` with `id` checked when it was not, unchecked when it was. */
export function toggled(checked: Checked, id: string): Checked {
  const next = new Set(checked);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** `checked` with every row of `order` from `anchor` to `id`, both included, checked as well. Without
 *  the anchor in `order`, just `id`. */
export function withRange(checked: Checked, order: readonly string[], anchor: string | null, id: string): Checked {
  const to = order.indexOf(id);
  const from = anchor === null ? -1 : order.indexOf(anchor);
  const ids = to < 0 ? [id] : from < 0 ? [id] : order.slice(Math.min(from, to), Math.max(from, to) + 1);
  return new Set([...checked, ...ids]);
}

/** `checked` with every row of `order`. */
export function withAll(checked: Checked, order: readonly string[]): Checked {
  return new Set([...checked, ...order]);
}

/** Shift+↑ (`-1`) or Shift+↓ (`1`) from the row `at`: that row and the next one in `direction` are
 *  checked and the next one is where the keys go on from. From no row (or one `order` does not
 *  hold): the first row (↓) or the last (↑), checked. `null` when `order` is empty. */
export function extended(checked: Checked, order: readonly string[], at: string | null, direction: 1 | -1): { checked: Checked; at: string } | null {
  if (order.length === 0) return null;
  const index = at === null ? -1 : order.indexOf(at);
  if (index < 0) {
    const first = (direction === 1 ? order[0] : order[order.length - 1]) as string;
    return { checked: new Set([...checked, first]), at: first };
  }
  const next = order[Math.min(Math.max(index + direction, 0), order.length - 1)] as string;
  return { checked: new Set([...checked, order[index] as string, next]), at: next };
}

/** The header checkbox: unchecked while nothing is checked, checked while every row shown is,
 *  mixed otherwise. */
export function headerState(checked: Checked, order: readonly string[]): "false" | "true" | "mixed" {
  if (checked.size === 0) return "false";
  return order.length > 0 && order.every((id) => checked.has(id)) ? "true" : "mixed";
}

/** The header checkbox's click: clears the checks while every row shown is checked, else checks every row shown. */
export function headerClick(checked: Checked, order: readonly string[]): Checked {
  return headerState(checked, order) === "true" ? NONE_CHECKED : withAll(checked, order);
}

/** The sessions a row's menu or a drag of the row acts on: every checked one when the row is checked
 *  along with others, else the row alone. */
export function targetsOf(id: string, checked: Checked): string[] {
  return checked.has(id) && checked.size > 1 ? [...checked] : [id];
}

/** `checked` without the ids `known` does not hold — sessions gone or out of the tab's scope. The same
 *  set when nothing left, so nothing re-renders for nothing. */
export function pruned(checked: Checked, known: (id: string) => boolean): Checked {
  for (const id of checked) if (!known(id)) return new Set([...checked].filter(known));
  return checked;
}

// ── Changing statuses ──────────────────────────────────────────────────────

/** The longest name the toast quotes before cutting it with "…". */
export const TOAST_NAME_MAX = 44;

/** A name as the toast quotes it: cut to `TOAST_NAME_MAX` with "…". */
export function cutForToast(text: string): string {
  return text.length > TOAST_NAME_MAX ? `${text.slice(0, TOAST_NAME_MAX - 1)}…` : text;
}

/** A session's name as the toast quotes it: as its row shows it, cut to `TOAST_NAME_MAX`. */
export function toastName(session: Session): string {
  return cutForToast(rowName(session).text);
}

/** What the toast says after `moved` were set to `status`: the session by name, or how many. */
export function movedText(moved: readonly Session[], status: SessionStatus): string {
  const first = moved[0];
  const who = moved.length === 1 && first !== undefined ? `“${toastName(first)}”` : `${moved.length} sessions`;
  return `${who} → ${STATUS_LABELS[status]}`;
}

/** The sessions setting `status` changes: those of `ids` that are known and have another status. */
export function changing(ids: readonly string[], status: SessionStatus, byId: ReadonlyMap<string, Session>): Session[] {
  const out: Session[] = [];
  for (const id of ids) {
    const session = byId.get(id);
    if (session !== undefined && statusOf(session) !== status) out.push(session);
  }
  return out;
}

/** The calls an Undo makes: the moved sessions grouped by the status each had before, one
 *  `sessions.setStatus` per earlier status, in the statuses' order of first appearance. */
export function undoCalls(earlier: ReadonlyMap<string, SessionStatus>): { status: SessionStatus; ids: string[] }[] {
  const groups = new Map<SessionStatus, string[]>();
  for (const [id, status] of earlier) {
    const ids = groups.get(status);
    if (ids === undefined) groups.set(status, [id]);
    else ids.push(id);
  }
  return [...groups].map(([status, ids]) => ({ status, ids }));
}
