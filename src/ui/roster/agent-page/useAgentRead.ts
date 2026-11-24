// One read of an agent's provider config through Pomade's broker — its permissions, its memory —
// asked when the tab shows and again when the roster changes (a changed profile may move the
// config folder). While the backend does not answer it asks again every second.

import { useEffect, useState } from "react";
import type { HostClient } from "pomade-kit/sdk";

const ANSWER_TIMEOUT_MS = 5000;
const RETRY_MS = 1000;

export type AgentRead<T> = { status: "loading" } | { status: "ready"; value: T } | { status: "refused"; reason: string };

/** Ask `method` for `agent` (`{ agent }`); `isAnswer` checks the answer's shape. `again` changes when it must be asked again. */
export function useAgentRead<T>(host: HostClient, method: string, agent: string, isAnswer: (value: unknown) => value is T, again: unknown): AgentRead<T> {
  const [read, setRead] = useState<{ agent: string; result: AgentRead<T> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const ask = async (): Promise<void> => {
      try {
        const value = await host.apps.call(host.welcome.appId, method, { agent }, { timeoutMs: ANSWER_TIMEOUT_MS });
        if (cancelled) return;
        if (!isAnswer(value)) throw new Error("malformed answer");
        setRead({ agent, result: { status: "ready", value } });
      } catch (err) {
        if (cancelled) return;
        // `not-found` is the backend's answer, not a missing backend: the agent has nothing to read.
        const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : "";
        if (code === "not-found") setRead({ agent, result: { status: "refused", reason: err instanceof Error ? err.message : code } });
        else retry = setTimeout(() => void ask(), RETRY_MS);
      }
    };
    void ask();
    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
  }, [host, method, agent, isAnswer, again]);

  // A read of another agent is not this one's.
  return read !== null && read.agent === agent ? read.result : { status: "loading" };
}
