// Dragging rows onto a status (DESIGN §2.7 "Changing a status"): a row — or, when it is checked,
// every checked row — dragged onto a group header (the table) or a status tab (the list) is set to
// that status. Only the tab's own rows drop there; anything else dragged over is refused.

import { useRef, useState, type DragEvent } from "react";
import type { SessionStatus } from "pomade-kit/protocol";

import { targetsOf, type Checked } from "./check-model.ts";

/** What a drop target (a group header, a status tab) hands its drag events to. */
export interface StatusDrop {
  /** The status a drag is over, for its highlight. */
  over: SessionStatus | null;
  onDragOver: (status: SessionStatus, event: DragEvent<HTMLElement>) => void;
  onDragLeave: (status: SessionStatus, event: DragEvent<HTMLElement>) => void;
  onDrop: (status: SessionStatus, event: DragEvent<HTMLElement>) => void;
}

/** What a row hands its drag events to. */
export interface RowDrag {
  onDragStart: (id: string, event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}

export function useStatusDrag(checked: Checked, onDrop: (ids: readonly string[], status: SessionStatus) => void): { row: RowDrag; drop: StatusDrop } {
  const dragged = useRef<readonly string[] | null>(null);
  const [over, setOver] = useState<SessionStatus | null>(null);

  const row: RowDrag = {
    onDragStart: (id, event) => {
      const ids = targetsOf(id, checked);
      dragged.current = ids;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", ids.join("\n"));
    },
    onDragEnd: () => {
      dragged.current = null;
      setOver(null);
    },
  };

  const drop: StatusDrop = {
    over,
    onDragOver: (status, event) => {
      if (dragged.current === null) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (over !== status) setOver(status);
    },
    onDragLeave: (status, event) => {
      const into = event.relatedTarget;
      if (into instanceof Node && event.currentTarget.contains(into)) return;
      setOver((o) => (o === status ? null : o));
    },
    onDrop: (status, event) => {
      const ids = dragged.current;
      if (ids === null) return;
      event.preventDefault();
      dragged.current = null;
      setOver(null);
      onDrop(ids, status);
    },
  };

  return { row, drop };
}
