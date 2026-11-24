// The roster as the agent's frame holds it: asked through Pomade's broker (`apps.call` to the app's
// own `roster.agents`), then again whenever the backend's `roster.changed` says a newer revision is
// out. While the backend does not answer, it asks again every second. A profile the frame saved
// itself is taken from the save's answer at once (`patchProfile`).

import { useCallback, useEffect, useRef, useState } from "react";
import type { HostClient } from "pomade-kit/sdk";

import { ROSTER_AGENTS_METHOD, ROSTER_CHANGED_EVENT, isRosterAgentsAnswer, isRosterChanged, type AgentProfile, type RosterAgentsAnswer } from "../../../shared/roster.ts";

const ANSWER_TIMEOUT_MS = 5000;
const RETRY_MS = 1000;

export interface RosterAnswer {
  /** `null` until the first answer. */
  answer: RosterAgentsAnswer | null;
  /** Take a profile the backend has just written. */
  patchProfile: (profile: AgentProfile) => void;
}

export function useRosterAnswer(host: HostClient): RosterAnswer {
  const [answer, setAnswer] = useState<RosterAgentsAnswer | null>(null);
  const held = useRef<RosterAgentsAnswer | null>(null);

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
        const next = await host.apps.call(host.welcome.appId, ROSTER_AGENTS_METHOD, {}, { timeoutMs: ANSWER_TIMEOUT_MS });
        if (cancelled) return;
        if (!isRosterAgentsAnswer(next)) throw new Error("malformed answer");
        held.current = next;
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

    const subscription = host.events.subscribe(`${host.welcome.appId}:${ROSTER_CHANGED_EVENT}`, (payload) => {
      if (!isRosterChanged(payload)) return;
      const current = held.current;
      if (current === null || current.epoch !== payload.epoch || current.revision < payload.revision) void ask();
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

  const patchProfile = useCallback((profile: AgentProfile) => {
    const current = held.current;
    if (current === null) return;
    const next = { ...current, agents: current.agents.map((entry) => (entry.id === profile.id ? { ...entry, profile, problem: null } : entry)) };
    held.current = next;
    setAnswer(next);
  }, []);

  return { answer, patchProfile };
}
