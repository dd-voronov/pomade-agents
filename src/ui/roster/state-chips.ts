// The state chips beside an agent's name — on its card, its list row and its page, one list for all:
// built-in, orphan, an `agent.yaml` that cannot be read, hidden from Pomade's "+" menu. Hidden reads
// the roster's own answer, which an unusable file still gives (its first-sight value).

import type { RosterEntry } from "../../shared/roster.ts";

export interface StateChip {
  id: "built-in" | "orphan" | "unreadable" | "hidden";
  label: string;
  tone: "plain" | "warn";
  title?: string;
}

/** The chips of `entry`, in order. */
export function stateChips(entry: RosterEntry): StateChip[] {
  const chips: StateChip[] = [];
  if (entry.kind === "builtin") chips.push({ id: "built-in", label: "built-in", tone: "plain" });
  if (entry.orphan) chips.push({ id: "orphan", label: "orphan", tone: "warn" });
  if (entry.problem !== null) chips.push({ id: "unreadable", label: "agent.yaml can’t be read", tone: "warn", title: entry.problem });
  if (entry.hidden) chips.push({ id: "hidden", label: "hidden", tone: "plain", title: "Left out of Pomade’s “+” menu" });
  return chips;
}
