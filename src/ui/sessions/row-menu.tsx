// A session row's menu (ARCHITECTURE §2.7): Open / Resume, Rename and Move to project for the one session
// it was opened on, then Set status. Those three show only when the menu acts on that
// session alone; Set status acts on every checked session when the row is one of several checked.
// Also the Move to project menu itself, which the detail panel's button opens.

import type { SessionStatus } from "pomade-kit/protocol";
import { SESSION_STATUSES } from "pomade-kit/protocol";

import { MoveIcon, PencilIcon } from "../core/icons.tsx";
import type { MenuEntry } from "../core/Menu.tsx";
import type { Session } from "../../shared/sessions.ts";
import { currentTarget, type MoveTarget } from "./edit-model.ts";
import { OPEN_LABELS, openKind } from "./open-model.ts";
import { OpenGlyph } from "./OpenGlyph.tsx";
import { StatusMark } from "./StatusGroup.tsx";
import { STATUS_LABELS, statusOf } from "./table-model.ts";

export interface RowMenuActions {
  /** Open the session's tab, or resume it. */
  open: (session: Session) => void;
  setStatus: (ids: readonly string[], status: SessionStatus) => void;
  /** Select the session and rename it in the detail panel. */
  rename: (id: string) => void;
  /** Select the session and open Move to project under the detail panel's button. */
  move: (id: string) => void;
}

/** The menu of `session`'s row, acting on `targets` (the row alone, or every checked row). */
export function rowMenuEntries(session: Session, targets: readonly string[], actions: RowMenuActions): MenuEntry[] {
  const many = targets.length > 1;
  const current = statusOf(session);
  const entries: MenuEntry[] = [];
  if (!many) {
    const kind = openKind(session);
    entries.push(
      { kind: "item", id: "open", label: OPEN_LABELS[kind], glyph: <OpenGlyph kind={kind} size={14} />, run: () => actions.open(session) },
      { kind: "item", id: "rename", label: "Rename", glyph: <PencilIcon size={14} />, trail: "F2", run: () => actions.rename(session.id) },
      { kind: "item", id: "move", label: "Move to project…", glyph: <MoveIcon size={14} />, run: () => actions.move(session.id) },
      { kind: "separator" },
    );
  }
  entries.push({ kind: "head", label: many ? `Set status · ${targets.length} sessions` : "Set status" });
  for (const status of SESSION_STATUSES) {
    entries.push({
      kind: "item",
      id: `status-${status}`,
      label: STATUS_LABELS[status],
      glyph: <StatusMark status={status} />,
      ...(many ? {} : { checked: status === current }),
      run: () => actions.setStatus(targets, status),
    });
  }
  return entries;
}

/** Move to project for `session`: every place in `targets`, the one it shows in now checked (picking
 *  it changes nothing). */
export function moveMenuEntries(session: Session, targets: readonly MoveTarget[], moveTo: (target: MoveTarget) => void): MenuEntry[] {
  const current = currentTarget(session);
  return [
    { kind: "head", label: "Move to project" },
    ...targets.map(
      (target): MenuEntry => ({
        kind: "item",
        id: `move-${target.id}`,
        label: target.name,
        checked: target.id === current,
        run: () => {
          if (target.id !== current) moveTo(target);
        },
      }),
    ),
  ];
}
