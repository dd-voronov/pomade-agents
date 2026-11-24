// The roster in the UI, shared by the Roster list and the agent's page: every agent
// (`roster.agents`) and the projects each is connected to (`roster.connections`), asked through
// Pomade's broker and asked again whenever the roster changes (`roster.changed`) or a project's
// place, name, agents or presence does (`project.updated`, `project.created`, `project.renamed`,
// `project.removed`). While the backend does not answer, the UI asks again every second. A profile
// the frame saved itself is taken from the save's answer at once (`patchProfile`).

import { useCallback, useEffect, useRef, useState } from "react";
import type { HostClient } from "pomade-kit/sdk";

import {
  ROSTER_AGENTS_METHOD,
  ROSTER_CHANGED_EVENT,
  ROSTER_CONNECTIONS_METHOD,
  isRosterAgentsAnswer,
  isRosterConnectionsAnswer,
  type AgentProfile,
  type RosterAgentsAnswer,
} from "../../shared/roster.ts";

const ANSWER_TIMEOUT_MS = 5000;
const RETRY_MS = 1000;
const PROJECT_EVENTS = ["project.created", "project.renamed", "project.removed", "project.updated"] as const;

export interface RosterRead {
  /** `null` until the first answer. */
  answer: RosterAgentsAnswer | null;
  /** Connected project ids by roster id, each in the Projects panel's order; `null` until the first answer. */
  connections: ReadonlyMap<string, readonly string[]> | null;
  /** Take a profile the backend has just written. */
  patchProfile: (profile: AgentProfile) => void;
}

export function useRoster(host: HostClient): RosterRead {
  const [answer, setAnswer] = useState<RosterAgentsAnswer | null>(null);
  const [connections, setConnections] = useState<ReadonlyMap<string, readonly string[]> | null>(null);
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
        const call = (method: string): Promise<unknown> => host.apps.call(host.welcome.appId, method, {}, { timeoutMs: ANSWER_TIMEOUT_MS });
        const [agents, connected] = await Promise.all([call(ROSTER_AGENTS_METHOD), call(ROSTER_CONNECTIONS_METHOD)]);
        if (cancelled) return;
        if (!isRosterAgentsAnswer(agents) || !isRosterConnectionsAnswer(connected)) throw new Error("malformed answer");
        held.current = agents;
        setAnswer(agents);
        setConnections(new Map(connected.connections.map((c) => [c.agent, c.projects])));
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

    const subscriptions = [
      host.events.subscribe(`${host.welcome.appId}:${ROSTER_CHANGED_EVENT}`, () => void ask()),
      ...PROJECT_EVENTS.map((event) => host.events.subscribe(event, () => void ask())),
    ];
    // Asked once the subscriptions stand, so no change after the first answer goes unheard.
    void Promise.allSettled(subscriptions).then(() => ask());
    return () => {
      cancelled = true;
      clearTimeout(retry);
      for (const subscription of subscriptions) void subscription.then((s) => s.close()).catch(() => undefined);
    };
  }, [host]);

  const patchProfile = useCallback((profile: AgentProfile) => {
    const current = held.current;
    if (current === null) return;
    const next = { ...current, agents: current.agents.map((entry) => (entry.id === profile.id ? { ...entry, profile, problem: null } : entry)) };
    held.current = next;
    setAnswer(next);
  }, []);

  return { answer, connections, patchProfile };
}
