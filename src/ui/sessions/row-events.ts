// What a session row (the table's and the list's) hands its pointer events to.

import type { MouseEvent } from "react";

import type { MenuAnchor } from "../core/Menu.tsx";
import type { RowDrag } from "./useStatusDrag.ts";

export interface RowEvents extends RowDrag {
  /** A click on the row: selects it; with Cmd it checks it, with Shift it checks a range; a double-click opens or resumes it. */
  onClick: (id: string, event: MouseEvent<HTMLElement>) => void;
  /** A click on the row's checkbox: checks it; with Shift, a range. */
  onCheck: (id: string, event: MouseEvent<HTMLElement>) => void;
  /** Right-click, or the row's ⋯: its menu. */
  onMenu: (id: string, anchor: MenuAnchor) => void;
  /** The row's Open / Resume button: back into the session. */
  onOpen: (id: string) => void;
}

/** A row's state as far as checking and its menu go. */
export interface RowMarks {
  checked: boolean;
  /** The row's menu is open. */
  menu: boolean;
}

/** True for the second click of a double-click, with no modifier (those check rows). The browser
 *  counts it across the table turning into the list under the pointer at the first click, so the
 *  row under it may not be the one the first click selected. */
export function isDoubleClick(event: MouseEvent<HTMLElement>): boolean {
  return event.detail === 2 && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
}
