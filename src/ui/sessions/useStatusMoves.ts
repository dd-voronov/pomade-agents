// Changing sessions' status from anywhere in the tab — the detail panel, the bulk bar, the row
// menu, a drag — and the toast each change shows: the session by name (or "N sessions") and the
// status, with Undo for `TOAST_MS` (`useToast.ts`). Undo sets each session's earlier status back; the backend holds
// `session.statusChanged` for 5 s after a session's last change, and a status back where it was
// when that window ends publishes nothing (CONTRACTS "Published events"), so the toast leaves
// before that window can close. A refused change made outside the panel says why in the toast.

import { useCallback, useRef } from "react";
import type { SessionStatus } from "pomade-kit/protocol";

import type { Session } from "../../shared/sessions.ts";
import { changing, movedText, undoCalls } from "./check-model.ts";
import { statusOf } from "./table-model.ts";
import type { Change } from "./useStatusChange.ts";
import type { Toasts } from "./useToast.ts";

/** Where a change is made: the panel says a refused change itself; anywhere else the toast does. */
export type MoveFrom = "panel" | "elsewhere";

export interface StatusMoves {
  /** Set `status` on the sessions of `ids` that have another one, in one call. Resolves `true` when
   *  the change is in or there was nothing to change. */
  move: (ids: readonly string[], status: SessionStatus, from: MoveFrom) => Promise<boolean>;
}

export function useStatusMoves(
  change: Change,
  dismissFailure: () => void,
  byId: ReadonlyMap<string, Session> | undefined,
  { show, close }: Pick<Toasts, "show" | "close">,
): StatusMoves {
  const sessions = useRef(byId);
  sessions.current = byId;

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
        close();
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
    [change, close, refused, show],
  );

  return { move };
}
