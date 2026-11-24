// The header's actions that belong to later tickets — Start session (T-021) and Hide / Show in the
// "+" menu (T-021) — and Clone…, which opens the New agent page with this agent as its source. An
// entry still `null` shows its control in place, disabled. A ticket replaces its entry here and
// nothing else on the page.

import { newAgentRoute } from "../../core/routes.ts";
import type { AgentContext } from "./agent-context.ts";

export interface AgentActions {
  /** Open the Start session menu under `anchor`. */
  startSession: ((anchor: DOMRect) => void) | null;
  /** Hide the agent from Pomade's "+" menu, or show it there again. */
  setHidden: ((hidden: boolean) => void) | null;
  /** Start the New agent page with this agent as the source. */
  clone: (() => void) | null;
}

export function useAgentActions(context: AgentContext): AgentActions {
  const { navigate, entry } = context;
  return { startSession: null, setHidden: null, clone: () => navigate(newAgentRoute(entry.id)) };
}
