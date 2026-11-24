// One agent as a row of the list (DESIGN §3.3): name with its state chips over the role line,
// provider and model, Connected to, Last active, This week, and Start session ▾ with the ⋯ menu.
// Narrow lists drop the provider column and This week first, then Last active.

import type { ReactElement } from "react";

import { CaretIcon, MoreIcon, ResumeIcon } from "../../core/icons.tsx";
import type { RosterActions } from "./actions.ts";
import { ModelLine, OrphanActions, StateChips } from "./AgentCard.tsx";
import { ConnectedTo } from "./ConnectedTo.tsx";
import { ROW_NAMES } from "./connected-model.ts";
import { lastActiveText, weekText, type AgentView } from "./roster-model.ts";
import controls from "./controls.module.css";
import styles from "./AgentList.module.css";

export interface AgentRowProps {
  agent: AgentView;
  actions: RosterActions;
  projects: number;
  now: Date;
}

function SecondLine({ agent }: { agent: AgentView }): ReactElement {
  if (agent.orphan) return <>Config folder <code>{agent.configDir}</code> is gone</>;
  if (agent.problem !== null) return <>agent.yaml can’t be used: {agent.problem}</>;
  return agent.role === null ? <span className={styles.faint}>No role line</span> : <>{agent.role}</>;
}

export function AgentRow({ agent, actions, projects, now }: AgentRowProps): ReactElement {
  const { orphan } = agent;
  return (
    <div className={styles.row} data-testid={`agent-card-${agent.id}`} data-orphan={orphan ? "" : undefined} data-hidden={agent.hidden ? "" : undefined}>
      <div className={styles.agent}>
        <div className={styles.line1}>
          <button type="button" className={styles.name} disabled={orphan} title={agent.id} data-testid={`agent-name-${agent.id}`} onClick={() => actions.openAgent(agent.id)}>
            {agent.name}
          </button>
          <span className={styles.chips}>
            <StateChips agent={agent} />
          </span>
        </div>
        <div className={styles.line2} data-testid={`agent-role-${agent.id}`} title={agent.role ?? undefined}>
          <SecondLine agent={agent} />
        </div>
      </div>
      <div className={styles.model}>
        <div className={styles.cell}>{agent.providerLabel}</div>
        <div className={`${styles.cell} ${styles.faint}`}>{orphan ? null : <ModelLine agent={agent} />}</div>
      </div>
      <div className={styles.connected}>
        {orphan ? null : <ConnectedTo agent={agent.id} agentName={agent.name} ranked={agent.connected} projects={projects} max={ROW_NAMES} onOpen={() => actions.openProjects(agent.id)} />}
      </div>
      <div className={styles.last} data-testid={`agent-last-${agent.id}`}>
        {orphan ? null : lastActiveText(agent.lastActiveAt, now)}
      </div>
      <div className={styles.week} data-testid={`agent-week-${agent.id}`} title={orphan ? undefined : "Work sessions this week, and their cost"}>
        {orphan ? null : <WeekCell agent={agent} />}
      </div>
      <div className={styles.actions}>
        {orphan ? (
          <OrphanActions agent={agent} small />
        ) : (
          <>
            <button type="button" className={`${controls.primary} ${controls.small}`} data-testid={`agent-start-${agent.id}`}>
              <ResumeIcon size={12} />
              Start session
              <span className={controls.caret}>
                <CaretIcon />
              </span>
            </button>
            <button type="button" className={`${controls.iconBtn} ${styles.more}`} title="More" aria-label={`More for ${agent.name}`} data-testid={`agent-more-${agent.id}`}>
              <MoreIcon />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** "11 sessions" over "~$9.85" — the row's two lines. */
function WeekCell({ agent }: { agent: AgentView }): ReactElement {
  const { sessions, costUsd } = agent.week;
  if (sessions === 0) return <span className={styles.faint}>—</span>;
  const [count, cost] = weekText({ sessions, costUsd }).split(" · ");
  return (
    <>
      <div className={styles.cell}>{count}</div>
      {cost !== undefined && <div className={`${styles.cell} ${styles.faint}`}>{cost}</div>}
    </>
  );
}
