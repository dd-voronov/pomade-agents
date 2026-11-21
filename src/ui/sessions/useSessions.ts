// The sessions, kept current in the UI: the first answer is asked through Pomade's broker
// (`apps.call` to the app's own `sessions.list`), then the backend's `sessions.changed` notice
// says when to ask for the changes since the last answer. While the backend does not answer, the
// UI asks again every second; a restarted backend (another epoch) answers whole. A change the UI
// made itself is taken from the change method's answer at once (`update`).

import { useCallback, useEffect, useRef, useState } from "react";
import type { HostClient } from "pomade-kit/sdk";

import {
  SESSIONS_CHANGED_EVENT,
  SESSIONS_LIST_METHOD,
  isSessionsAnswer,
  isSessionsChanged,
  type Session,
  type SessionsListParams,
} from "../../shared/sessions.ts";
import { applyAnswer, applyUpdated, isBehind, type SessionsCopy } from "./sessions-copy.ts";

const ANSWER_TIMEOUT_MS = 5000;
const RETRY_MS = 1000;

export interface Sessions {
  /** `null` until the first answer. */
  copy: SessionsCopy | null;
  /** Take the sessions a change method answered. */
  update: (sessions: readonly Session[]) => void;
}

export function useSessions(host: HostClient): Sessions {
  const [copy, setCopy] = useState<SessionsCopy | null>(null);
  const current = useRef<SessionsCopy | null>(null);

  useEffect(() => {
    let cancelled = false;
    let asking = false;
    let again = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const ask = async (): Promise<void> => {
      if (asking) {
        again = true;
        return;
      }
      asking = true;
      clearTimeout(retry);
      try {
        const params: SessionsListParams = current.current === null ? {} : { since: current.current.since };
        const answer = await host.apps.call(host.welcome.appId, SESSIONS_LIST_METHOD, params, { timeoutMs: ANSWER_TIMEOUT_MS });
        if (cancelled) return;
        if (!isSessionsAnswer(answer)) throw new Error("malformed answer");
        current.current = applyAnswer(current.current, answer);
        setCopy(current.current);
      } catch {
        if (!cancelled) retry = setTimeout(() => void ask(), RETRY_MS);
      } finally {
        asking = false;
        if (again && !cancelled) {
          again = false;
          void ask();
        }
      }
    };

    const subscription = host.events.subscribe(`${host.welcome.appId}:${SESSIONS_CHANGED_EVENT}`, (payload) => {
      if (isSessionsChanged(payload) && isBehind(current.current, payload)) void ask();
    });
    // Asked once the subscription stands, so no change after the first answer goes unheard.
    void subscription.then(
      () => ask(),
      () => ask(),
    );
    return () => {
      cancelled = true;
      clearTimeout(retry);
      void subscription.then((s) => s.close()).catch(() => undefined);
    };
  }, [host]);

  const update = useCallback((sessions: readonly Session[]) => {
    if (current.current === null) return;
    current.current = applyUpdated(current.current, sessions);
    setCopy(current.current);
  }, []);

  return { copy, update };
}
