// Renaming a session and moving it to another project: `sessions.rename` and
// `sessions.moveToProject` through Pomade's broker. The session the backend answers is taken into
// the UI's copy at once, and a toast says what was done — a move with Undo, which puts the session
// back where it was — or, for a refused change, what was not done and why.

import { useCallback } from "react";
import type { HostClient } from "pomade-kit/sdk";

import { SESSIONS_MOVE_METHOD, SESSIONS_RENAME_METHOD, isSessionsUpdated, type MoveToProjectParams, type RenameParams, type Session } from "../../shared/sessions.ts";
import { failureText, type ChangeKind } from "./detail-model.ts";
import { moveBack, movedToText, renamedText, type MoveTarget } from "./edit-model.ts";
import type { Toasts } from "./useToast.ts";

const ANSWER_TIMEOUT_MS = 5000;

export interface SessionEdits {
  /** Name `session` (`null`: unnamed again). */
  rename: (session: Session, name: string | null) => void;
  /** Move `session` to `target`; `onMoved` gets the session as it is after the move, and again after an Undo. */
  moveTo: (session: Session, target: MoveTarget, onMoved: (session: Session) => void) => void;
}

export function useSessionEdits(host: HostClient, update: (sessions: readonly Session[]) => void, { show, close }: Pick<Toasts, "show" | "close">): SessionEdits {
  /** Call `method`; resolves to the changed session, or `null` once the toast said why it was refused. */
  const call = useCallback(
    async (method: string, params: RenameParams | MoveToProjectParams, kind: ChangeKind): Promise<Session | null> => {
      try {
        const answer = await host.apps.call(host.welcome.appId, method, params, { timeoutMs: ANSWER_TIMEOUT_MS });
        if (!isSessionsUpdated(answer)) throw new Error("the backend's answer was malformed");
        update(answer.sessions);
        return answer.sessions.find((s) => s.id === params.id) ?? null;
      } catch (err) {
        const failed = failureText(kind, err);
        show(failed.text, null, failed.reason);
        return null;
      }
    },
    [host, update, show],
  );

  const rename = useCallback<SessionEdits["rename"]>(
    (session, name) => {
      void call(SESSIONS_RENAME_METHOD, { id: session.id, name }, "rename").then((renamed) => {
        if (renamed !== null) show(renamedText(renamed, name), null);
      });
    },
    [call, show],
  );

  const moveTo = useCallback<SessionEdits["moveTo"]>(
    (session, target, onMoved) => {
      const back = moveBack(session.record);
      void call(SESSIONS_MOVE_METHOD, { id: session.id, project: target.id }, "move").then((moved) => {
        if (moved === null) return;
        onMoved(moved);
        const undo = (): void => {
          close();
          void call(SESSIONS_MOVE_METHOD, { id: session.id, project: back }, "move-back").then((restored) => {
            if (restored !== null) onMoved(restored);
          });
        };
        show(movedToText(target), undo);
      });
    },
    [call, close, show],
  );

  return { rename, moveTo };
}
