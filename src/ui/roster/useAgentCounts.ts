// Each agent's counts over work sessions (`sessions.agentCounts`, ARCHITECTURE §2.9), kept current in the
// UI: asked through Pomade's broker within the windows the caller names, then asked again whenever
// the backend's `sessions.changed` notice is past the answer's sessions — a status change, a move,
// a new session — and whenever the windows change. While the backend does not answer, the UI asks
// again every second.

import { useEffect, useRef, useState } from "react";
import type { HostClient } from "pomade-kit/sdk";

import { SESSIONS_CHANGED_EVENT, isSessionsChanged } from "../../shared/sessions.ts";
import { SESSIONS_AGENT_COUNTS_METHOD, countsSince, isAgentCountsAnswer, type AgentCounts, type AgentCountsAnswer, type AgentCountsParams } from "../../shared/work-sessions.ts";
import { isBehind } from "../sessions/sessions-copy.ts";
import { countsByAgent } from "./agent-counts-model.ts";

const ANSWER_TIMEOUT_MS = 5000;
const RETRY_MS = 1000;

export interface AgentCountsView {
  /** By roster id; an agent missing has no work session (`noCounts`). */
  byAgent: ReadonlyMap<string, AgentCounts>;
  /** The first walk of the stores is still running: the counts are partial. */
  indexing: boolean;
  /** Every agent with at least one session of any status (`AgentCountsAnswer.withSessions`). */
  withSessions: ReadonlySet<string>;
}

/** The counts within `windows` (`rosterWindows`); `null` until the first answer. */
export function useAgentCounts(host: HostClient, windows: AgentCountsParams): AgentCountsView | null {
  const [view, setView] = useState<AgentCountsView | null>(null);
  const current = useRef<AgentCountsAnswer | null>(null);
  const { weekFrom, projectsFrom } = windows;

  useEffect(() => {
    let cancelled = false;
    let asking = false;
    let again = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    current.current = null;

    const ask = async (): Promise<void> => {
      if (asking) {
        again = true;
        return;
      }
      asking = true;
      clearTimeout(retry);
      try {
        const params: AgentCountsParams = { weekFrom, projectsFrom };
        const answer = await host.apps.call(host.welcome.appId, SESSIONS_AGENT_COUNTS_METHOD, params, { timeoutMs: ANSWER_TIMEOUT_MS });
        if (cancelled) return;
        if (!isAgentCountsAnswer(answer)) throw new Error("malformed answer");
        current.current = answer;
        setView({ byAgent: countsByAgent(answer), indexing: answer.indexing, withSessions: new Set(answer.withSessions) });
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
      const answered = current.current === null ? null : { since: countsSince(current.current) };
      if (isSessionsChanged(payload) && isBehind(answered, payload)) void ask();
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
  }, [host, weekFrom, projectsFrom]);

  return view;
}
