// Setting sessions' status and note: `sessions.setStatus` through Pomade's broker, one call at a
// time in the order they were made. The sessions it answers are taken into the UI's copy at once;
// nothing changes before the answer, so a refused change leaves every row as it was and says why.

import { useCallback, useRef, useState } from "react";
import type { SessionStatus } from "pomade-kit/protocol";
import type { HostClient } from "pomade-kit/sdk";

import { SESSIONS_SET_STATUS_METHOD, isSessionsUpdated, type Session, type SetStatusParams } from "../../shared/sessions.ts";
import { failureText, type ChangeKind, type FailureText } from "./detail-model.ts";

const ANSWER_TIMEOUT_MS = 5000;

export interface Failure extends FailureText {
  /** The sessions the refused change was for. */
  sessions: readonly string[];
  kind: ChangeKind;
}

/** Set `status` on every session of `ids`; `note` as `sessions.setStatus` takes it (omitted keeps
 *  the notes). Resolves `null` once the change is in, its failure when it was refused. */
export type Change = (ids: readonly string[], kind: ChangeKind, status: SessionStatus, note?: string | null) => Promise<Failure | null>;

export interface StatusChange {
  change: Change;
  /** The last refused change, until a change of one of its sessions goes through or it is dismissed. */
  failure: Failure | null;
  dismiss: () => void;
}

export function useStatusChange(host: HostClient, update: (sessions: readonly Session[]) => void): StatusChange {
  const [failure, setFailure] = useState<Failure | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const change = useCallback<Change>(
    (ids, kind, status, note) => {
      const params: SetStatusParams = note === undefined ? { ids: [...ids], status } : { ids: [...ids], status, note };
      const run = async (): Promise<Failure | null> => {
        try {
          const answer = await host.apps.call(host.welcome.appId, SESSIONS_SET_STATUS_METHOD, params, { timeoutMs: ANSWER_TIMEOUT_MS });
          if (!isSessionsUpdated(answer)) throw new Error("the backend's answer was malformed");
          update(answer.sessions);
          setFailure((f) => (f !== null && f.sessions.some((id) => ids.includes(id)) ? null : f));
          return null;
        } catch (err) {
          const failed: Failure = { sessions: [...ids], kind, ...failureText(kind, err) };
          setFailure(failed);
          return failed;
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
