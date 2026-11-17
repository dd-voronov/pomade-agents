// The session summaries, kept current in the UI: the first answer is asked through Pomade's broker
// (`apps.call` to the app's own `sessions.summaries`), then the backend's `sessions.changed` notice
// says when to ask for the changes since the last answer. While the backend does not answer, the
// UI asks again every second; a restarted backend (another epoch) answers whole.

import { useEffect, useState } from "react";
import type { HostClient } from "pomade-kit/sdk";

import {
  SESSIONS_CHANGED_EVENT,
  SESSIONS_SUMMARIES_METHOD,
  isSessionsAnswer,
  isSessionsChanged,
  type SessionsSummariesParams,
} from "../../shared/sessions.ts";
import { applyAnswer, isBehind, type SummariesCopy } from "./summaries.ts";

const ANSWER_TIMEOUT_MS = 5000;
const RETRY_MS = 1000;

export function useSessionSummaries(host: HostClient): SummariesCopy | null {
  const [copy, setCopy] = useState<SummariesCopy | null>(null);

  useEffect(() => {
    let cancelled = false;
    let current: SummariesCopy | null = null;
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
        const params: SessionsSummariesParams = current === null ? {} : { since: current.since };
        const answer = await host.apps.call(host.welcome.appId, SESSIONS_SUMMARIES_METHOD, params, { timeoutMs: ANSWER_TIMEOUT_MS });
        if (cancelled) return;
        if (!isSessionsAnswer(answer)) throw new Error("malformed answer");
        current = applyAnswer(current, answer);
        setCopy(current);
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
      if (isSessionsChanged(payload) && isBehind(current, payload)) void ask();
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

  return copy;
}
