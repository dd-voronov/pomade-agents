// The header's actions that belong to later tickets — Start session (T-021), Hide / Show in the
// "+" menu (T-021) and Clone… (T-026). Each is `null` until its ticket wires it: the control shows
// in its place, disabled. A ticket replaces its entry here and nothing else on the page.

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
  void context;
  return { startSession: null, setHidden: null, clone: null };
}
