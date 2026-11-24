// What the Roster's frame shows of each agent (DESIGN §3.3): the answer of `roster.agents`, the
// agent's counts and its connected projects, put together as the cards and rows read them, in the
// order the Roster lists them.

import type { AgentProvider, RosterAgentsAnswer } from "../../../shared/roster.ts";
import type { AgentCounts } from "../../../shared/work-sessions.ts";
import { noCounts } from "../agent-counts-model.ts";
import { needsLogin, setupPromptOf, type SessionFacts } from "../needs-login.ts";
import { formatAgo, formatMoney } from "../../sessions/table-model.ts";
import { rankConnected, type ConnectedProject } from "./connected-model.ts";

export const PROVIDER_LABELS: Record<AgentProvider, string> = { claude: "Claude Code", codex: "Codex" };

/** Which of the Roster's views is shown; remembered on this Mac. */
export type RosterView = "cards" | "list";
export const DEFAULT_VIEW: RosterView = "cards";

/** A stored view; anything else reads as the default. */
export function viewOf(stored: string | null): RosterView {
  return stored === "list" || stored === "cards" ? stored : DEFAULT_VIEW;
}

/** One agent as a card or a row shows it. */
export type AgentView = {
  id: string;
  name: string;
  provider: AgentProvider;
  providerLabel: string;
  builtin: boolean;
  hidden: boolean;
  orphan: boolean;
  /** Why `agent.yaml` cannot be used; `null` when it can (or none is kept). */
  problem: string | null;
  /** Nothing about it can be edited: no profile is kept, its file is unusable, or it is an orphan. */
  readOnly: boolean;
  /** The profile's config folder as written (`Agents/x`, `~/.claude`); `null` without a usable profile. */
  configDir: string | null;
  model: string | null;
  effort: string | null;
  role: string | null;
  tags: string[];
  /** Connected projects, ranked (`rankConnected`). */
  connected: ConnectedProject[];
  lastActiveAt: string | null;
  week: AgentCounts["week"];
  /** A Claude Code folder agent with a usable profile, not an orphan: ⋯ offers Clone…. */
  cloneable: boolean;
  /** No session of it exists yet (`needsLogin`): the chip and the notice with the setup prompt. */
  needsLogin: boolean;
  /** The prompt the notice copies (`setupPromptOf`). */
  setupPrompt: string;
};

/** The roster's id and display name of a model for the card's second line: `claude-opus-4-8` is
 *  `opus-4.8`; a name that is not a dated or numbered Claude id stays as it is. */
export function modelLabel(model: string): string {
  return model.replace(/^claude-/, "").replace(/-(\d+)-(\d+)(?=$|-)/, "-$1.$2");
}

/** The agents of `answer`, in the Roster's order, with the counts and connections they read. */
export function agentViews(
  answer: RosterAgentsAnswer,
  counts: ReadonlyMap<string, AgentCounts>,
  connections: ReadonlyMap<string, readonly string[]>,
  names: ReadonlyMap<string, string>,
  sessions: SessionFacts | null = null,
): AgentView[] {
  return answer.agents.map((entry): AgentView => {
    const mine = counts.get(entry.id) ?? noCounts(entry.id);
    return {
      id: entry.id,
      name: entry.name,
      provider: entry.provider,
      providerLabel: PROVIDER_LABELS[entry.provider],
      builtin: entry.kind === "builtin",
      hidden: entry.hidden,
      orphan: entry.orphan,
      problem: entry.problem,
      readOnly: answer.profilesOff !== null || entry.problem !== null || entry.orphan,
      configDir: entry.profile?.configDir ?? null,
      model: entry.model,
      effort: entry.effort,
      role: entry.profile?.role ?? null,
      tags: entry.profile?.tags ?? [],
      connected: rankConnected(connections.get(entry.id) ?? [], mine.projects, names),
      lastActiveAt: mine.lastActiveAt,
      week: mine.week,
      cloneable: entry.profile !== null && entry.provider === "claude" && entry.kind === "folder" && !entry.orphan,
      needsLogin: needsLogin(entry, sessions),
      setupPrompt: setupPromptOf(entry),
    };
  });
}

/** An agent the Roster lists in the hidden section: left out of the "+" menu, and in order. An
 *  orphan and an agent whose `agent.yaml` cannot be used stay among the others. */
export const isTucked = (agent: AgentView): boolean => agent.hidden && !agent.orphan && agent.problem === null;

/** The agents in the main list and in the collapsible hidden section, each in the Roster's order. */
export function sections(agents: readonly AgentView[]): { shown: AgentView[]; hidden: AgentView[] } {
  return { shown: agents.filter((a) => !isTucked(a)), hidden: agents.filter(isTucked) };
}

/** The header's "7 agents". */
export const agentCount = (n: number): string => `${n} agent${n === 1 ? "" : "s"}`;

const sessionCount = (n: number): string => `${n} session${n === 1 ? "" : "s"}`;

/** "11 sessions · ~$9.85": this week's work sessions and ~$; the ~$ is left out when none is known. */
export function weekText(week: AgentCounts["week"]): string {
  return week.costUsd === null ? sessionCount(week.sessions) : `${sessionCount(week.sessions)} · ${formatMoney(week.costUsd)}`;
}

/** The card's Last active: relative ("5m", "yesterday"), "never" with none. */
export const lastActiveText = (iso: string | null, now: Date): string => (iso === null ? "never" : formatAgo(iso, now));

/** The state chips beside an agent's name, in order. */
export function chipsOf(agent: AgentView): { id: "built-in" | "orphan" | "unreadable" | "hidden"; label: string; tone: "plain" | "warn"; title?: string }[] {
  const chips: ReturnType<typeof chipsOf> = [];
  if (agent.builtin) chips.push({ id: "built-in", label: "built-in", tone: "plain" });
  if (agent.orphan) chips.push({ id: "orphan", label: "orphan", tone: "warn" });
  if (agent.problem !== null) chips.push({ id: "unreadable", label: "agent.yaml can't be read", tone: "warn", title: agent.problem });
  if (agent.hidden) chips.push({ id: "hidden", label: "hidden", tone: "plain", title: "Left out of Pomade's \"+\" menu" });
  return chips;
}
