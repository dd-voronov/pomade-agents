// The Roster's header: the title, how many agents, this week's work sessions and ~$ across them, the
// view switch and New agent.

import type { ReactElement } from "react";

import { GridIcon, ListIcon, PlusIcon } from "./list-icons.tsx";
import { agentCount, weekText, type RosterView } from "./roster-model.ts";
import type { AgentCounts } from "../../../shared/work-sessions.ts";
import controls from "./controls.module.css";
import styles from "./RosterHeader.module.css";

export interface RosterHeaderProps {
  agents: number;
  week: AgentCounts["week"];
  /** The counts are partial: the stores are still being read. */
  indexing: boolean;
  view: RosterView;
  onView: (view: RosterView) => void;
  /** New agent is unavailable (no workspace to keep a profile in). */
  newDisabled: boolean;
  onNewAgent: () => void;
}

export function RosterHeader({ agents, week, indexing, view, onView, newDisabled, onNewAgent }: RosterHeaderProps): ReactElement {
  return (
    <header className={styles.head}>
      <h1 className={styles.title}>Roster</h1>
      <span className={styles.scope} data-testid="roster-count" data-count={agents}>
        {agentCount(agents)}
      </span>
      <span className={styles.sum} title="Work sessions this week, and their cost, across agents" data-testid="roster-week" data-sessions={week.sessions}>
        {indexing && "Indexing… "}
        <span className={styles.sumLabel}>This week: </span>
        {weekText(week)}
      </span>
      <div className={styles.seg} role="group" aria-label="Roster view">
        <button type="button" aria-pressed={view === "cards"} title="Cards" aria-label="Cards" data-testid="roster-view-cards" onClick={() => onView("cards")}>
          <GridIcon />
        </button>
        <button type="button" aria-pressed={view === "list"} title="List" aria-label="List" data-testid="roster-view-list" onClick={() => onView("list")}>
          <ListIcon />
        </button>
      </div>
      <button
        type="button"
        className={controls.primary}
        disabled={newDisabled}
        title={newDisabled ? "No workspace is open" : undefined}
        data-testid="roster-new-agent"
        onClick={onNewAgent}
      >
        <PlusIcon />
        New agent
      </button>
    </header>
  );
}
