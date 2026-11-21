// Setting a session's status and note from the detail panel: `sessions.setStatus` through Pomade's
// broker, one call at a time in the order they were made. The sessions it answers are taken into
// the UI's copy at once; nothing changes before the answer, so a refused change leaves every row
// as it was and the panel says why.

import { useCallback, useRef, useState } from "react";
import type { SessionStatus } from "pomade-kit/protocol";
import type { HostClient } from "pomade-kit/sdk";

import { SESSIONS_SET_STATUS_METHOD, isSessionsUpdated, type Session, type SetStatusParams } from "../../shared/sessions.ts";
import { failureText, type ChangeKind } from "./detail-model.ts";

const ANSWER_TIMEOUT_MS = 5000;

export interface Failure {
  session: string;
  kind: ChangeKind;
  text: string;
}

export interface StatusChange {
  /** Set `status` on `session`; `note` as `sessions.setStatus` takes it (omitted keeps the note).
   *  Resolves `true` once the change is in, `false` when it was refused. */
  change: (session: string, kind: ChangeKind, status: SessionStatus, note?: string | null) => Promise<boolean>;
  /** The last refused change, until a change of that session goes through or it is dismissed. */
  failure: Failure | null;
  dismiss: () => void;
}

export function useStatusChange(host: HostClient, update: (sessions: readonly Session[]) => void): StatusChange {
  const [failure, setFailure] = useState<Failure | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const change = useCallback(
    (session: string, kind: ChangeKind, status: SessionStatus, note?: string | null): Promise<boolean> => {
      const params: SetStatusParams = note === undefined ? { ids: [session], status } : { ids: [session], status, note };
      const run = async (): Promise<boolean> => {
        try {
          const answer = await host.apps.call(host.welcome.appId, SESSIONS_SET_STATUS_METHOD, params, { timeoutMs: ANSWER_TIMEOUT_MS });
          if (!isSessionsUpdated(answer)) throw new Error("the backend's answer was malformed");
          update(answer.sessions);
          setFailure((f) => (f?.session === session ? null : f));
          return true;
        } catch (err) {
          setFailure({ session, kind, text: failureText(kind, err) });
          return false;
        }
      };
      const next = queue.current.then(run);
      queue.current = next;
      return next;
    },
    [host, update],
  );

  const dismiss = useCallback(() => setFailure(null), []);
  return { change, failure, dismiss };
}
