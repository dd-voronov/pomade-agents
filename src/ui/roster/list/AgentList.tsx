// The list view: a header row and one row per agent.

import type { ReactElement } from "react";

import type { RosterTools } from "./AgentCard.tsx";
import { AgentRow } from "./AgentRow.tsx";
import type { AgentView } from "./roster-model.ts";
import styles from "./AgentList.module.css";

export interface AgentListProps {
  /** Which of the Roster's two lists this is. */
  section: "shown" | "hidden";
  agents: readonly AgentView[];
  tools: RosterTools;
  now: Date;
}

export function AgentList({ section, agents, tools, now }: AgentListProps): ReactElement {
  return (
    <div className={styles.list} data-testid={`roster-list-${section}`}>
      <div className={styles.head}>
        <span>
          Agent
        </span>
        <span className={styles.hModel}>
          Provider · model
        </span>
        <span className={styles.hConnected} title="By work sessions in the last 90 days">
          Connected to
        </span>
        <span className={styles.hLast}>
          Last active
        </span>
        <span className={styles.hWeek}>
          This week
        </span>
        <span />
      </div>
      {agents.map((agent) => (
        <AgentRow key={agent.id} agent={agent} tools={tools} now={now} />
      ))}
    </div>
  );
}
