// A session row's menu (DESIGN §2.7 "Changing a status"): its sections, top to bottom. A section
// for the one session the menu was opened on shows only when the menu acts on that session alone;
// Set status acts on every checked session when the row is one of several checked.

import type { SessionStatus } from "pomade-kit/protocol";
import { SESSION_STATUSES } from "pomade-kit/protocol";

import type { MenuEntry } from "../core/Menu.tsx";
import type { Session } from "../../shared/sessions.ts";
import { StatusMark } from "./StatusGroup.tsx";
import { STATUS_LABELS, statusOf } from "./table-model.ts";

export interface RowMenuActions {
  setStatus: (ids: readonly string[], status: SessionStatus) => void;
}

/** The menu of `session`'s row, acting on `targets` (the row alone, or every checked row). */
export function rowMenuEntries(session: Session, targets: readonly string[], actions: RowMenuActions): MenuEntry[] {
  const many = targets.length > 1;
  const current = statusOf(session);
  const entries: MenuEntry[] = [{ kind: "head", label: many ? `Set status · ${targets.length} sessions` : "Set status" }];
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
