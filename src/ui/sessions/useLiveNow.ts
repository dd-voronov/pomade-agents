// The Live now rows, kept current: asked through Pomade's broker (`apps.call` to the app's own
// `liveNow.list`), then again whenever the backend's `liveNow.changed` says a newer revision is
// out. While the backend does not answer, the panel asks again every second.

import { useEffect, useState } from "react";
import type { HostClient } from "pomade-kit/sdk";

import { LIVE_NOW_CHANGED_EVENT, LIVE_NOW_LIST_METHOD, isLiveNowAnswer, isLiveNowChanged, type LiveNowAnswer } from "../../shared/live-now.ts";

const ANSWER_TIMEOUT_MS = 5000;
const RETRY_MS = 1000;

/** `null` until the first answer. */
export function useLiveNow(host: HostClient): LiveNowAnswer | null {
  const [answer, setAnswer] = useState<LiveNowAnswer | null>(null);

  useEffect(() => {
    let cancelled = false;
    let held: LiveNowAnswer | null = null;
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
        const next = await host.apps.call(host.welcome.appId, LIVE_NOW_LIST_METHOD, {}, { timeoutMs: ANSWER_TIMEOUT_MS });
        if (cancelled) return;
        if (!isLiveNowAnswer(next)) throw new Error("malformed answer");
        held = next;
        setAnswer(next);
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

    const subscription = host.events.subscribe(`${host.welcome.appId}:${LIVE_NOW_CHANGED_EVENT}`, (payload) => {
      if (!isLiveNowChanged(payload)) return;
      if (held === null || held.epoch !== payload.epoch || held.revision < payload.revision) void ask();
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

  return answer;
}
