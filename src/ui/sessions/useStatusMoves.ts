// Changing sessions' status from anywhere in the tab — the detail panel, the bulk bar, the row
// menu, a drag — and the toast each change shows: the session by name (or "N sessions") and the
// status, with Undo for `TOAST_MS`. Undo sets each session's earlier status back; the backend holds
// `session.statusChanged` for 5 s after a session's last change, and a status back where it was
// when that window ends publishes nothing (CONTRACTS "Published events"), so the toast leaves
// before that window can close. A refused change made outside the panel says why in the toast.

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionStatus } from "pomade-kit/protocol";

import type { Session } from "../../shared/sessions.ts";
import { changing, movedText, undoCalls } from "./check-model.ts";
import { statusOf } from "./table-model.ts";
import type { Change } from "./useStatusChange.ts";

/** How long a toast shows. Shorter than the backend's 5 s window, so an Undo always lands inside it. */
export const TOAST_MS = 4000;

export interface Toast {
  /** Tells one toast from the next, so a new one restarts its time. */
  key: number;
  text: string;
  /** Sets the statuses back; `null` for a toast that only says something. */
  undo: (() => void) | null;
  /** Hover text: the backend's own words for a refused change. */
  title?: string;
}

/** Where a change is made: the panel says a refused change itself; anywhere else the toast does. */
export type MoveFrom = "panel" | "elsewhere";

export interface StatusMoves {
  /** Set `status` on the sessions of `ids` that have another one, in one call. Resolves `true` when
   *  the change is in or there was nothing to change. */
  move: (ids: readonly string[], status: SessionStatus, from: MoveFrom) => Promise<boolean>;
  toast: Toast | null;
  closeToast: () => void;
}

export function useStatusMoves(change: Change, dismissFailure: () => void, byId: ReadonlyMap<string, Session> | undefined): StatusMoves {
  const [toast, setToast] = useState<Toast | null>(null);
  const keys = useRef(0);
  const sessions = useRef(byId);
  sessions.current = byId;

  const show = useCallback((text: string, undo: (() => void) | null, title?: string) => {
    keys.current += 1;
    setToast(title === undefined ? { key: keys.current, text, undo } : { key: keys.current, text, undo, title });
  }, []);
  const closeToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => setToast((t) => (t?.key === toast.key ? null : t)), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const refused = useCallback(
    (text: string, reason: string) => {
      dismissFailure();
      show(text, null, reason);
    },
    [dismissFailure, show],
  );

  const move = useCallback(
    async (ids: readonly string[], status: SessionStatus, from: MoveFrom): Promise<boolean> => {
      const moved = changing(ids, status, sessions.current ?? new Map());
      if (moved.length === 0) return true;
      const earlier = new Map(moved.map((s) => [s.id, statusOf(s)] as const));
      const failed = await change(moved.map((s) => s.id), "status", status);
      if (failed !== null) {
        if (from === "elsewhere") refused(failed.text, failed.reason);
        return false;
      }
      const undo = (): void => {
        setToast(null);
        void (async () => {
          for (const call of undoCalls(earlier)) {
            const back = await change(call.ids, "undo", call.status);
            if (back !== null) {
              refused(back.text, back.reason);
              return;
            }
          }
        })();
      };
      show(movedText(moved, status), undo);
      return true;
    },
    [change, refused, show],
  );

  return { move, toast, closeToast };
}
