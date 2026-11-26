// One agent as a row of the list (ARCHITECTURE §3.3): name with its state chips over the role line,
// provider and model, Connected to, Last active, This week, and Start session ▾ with the ⋯ menu —
// the card's own buttons and menus; an orphan's Re-link ▾ and Remove, which asks in place first.
// An agent that Needs login keeps its chip at every width and offers the setup prompt on the second
// line. Narrow lists drop the provider column and This week first, then Last active, then the other chips.

import { useState, type ReactElement } from "react";

import { NeedsLoginChip, NeedsLoginLine } from "../NeedsLogin.tsx";
import { type RosterTools, ModelLine, MoreButton, OtherChips, OrphanButtons, StartButton } from "./AgentCard.tsx";
import { ConnectedTo } from "./ConnectedTo.tsx";
import { ROW_NAMES } from "./connected-model.ts";
import { lastActiveText, weekText, type AgentView } from "./roster-model.ts";
import controls from "./controls.module.css";
import styles from "./AgentList.module.css";

export interface AgentRowProps {
  agent: AgentView;
  tools: RosterTools;
  now: Date;
}

function SecondLine({ agent, removing }: { agent: AgentView; removing: boolean }): ReactElement {
  if (agent.orphan && removing) return <>Remove its profile? No agent folder is touched.</>;
  if (agent.orphan) return <>Config folder <code>{agent.configDir}</code> is gone</>;
  if (agent.problem !== null) return <>agent.yaml can’t be used: {agent.problem}</>;
  if (agent.needsLogin) return <NeedsLoginLine prompt={agent.setupPrompt} testId={`agent-needs-login-${agent.id}`} />;
  return agent.role === null ? <span className={styles.faint}>No role line</span> : <>{agent.role}</>;
}

export function AgentRow({ agent, tools, now }: AgentRowProps): ReactElement {
  const { orphan } = agent;
  const { actions, scope } = tools;
  const [removing, setRemoving] = useState(false);
  return (
    <div className={styles.row} data-testid={`agent-card-${agent.id}`} data-orphan={orphan ? "" : undefined} data-hidden={agent.hidden ? "" : undefined}>
      <div className={styles.agent}>
        <div className={styles.line1}>
          <button type="button" className={styles.name} disabled={orphan} title={agent.id} data-testid={`agent-name-${agent.id}`} onClick={() => actions.openAgent(agent.id)}>
            {agent.name}
          </button>
          {agent.needsLogin && <NeedsLoginChip testId={`chip-needs-login-${agent.id}`} />}
          <span className={styles.chips}>
            <OtherChips agent={agent} />
          </span>
        </div>
        <div className={styles.line2} data-testid={`agent-role-${agent.id}`} title={agent.role ?? undefined}>
          <SecondLine agent={agent} removing={removing} />
        </div>
      </div>
      <div className={styles.model}>
        <div className={styles.cell}>{agent.providerLabel}</div>
        <div className={`${styles.cell} ${styles.faint}`}>{orphan ? null : <ModelLine agent={agent} />}</div>
      </div>
      <div className={styles.connected}>
        {orphan ? null : <ConnectedTo agent={agent.id} agentName={agent.name} ranked={agent.connected} projects={scope.projects.size} max={ROW_NAMES} onOpen={() => actions.openProjects(agent.id)} />}
      </div>
      <div className={styles.last} data-testid={`agent-last-${agent.id}`}>
        {orphan ? null : lastActiveText(agent.lastActiveAt, now)}
      </div>
      <div className={styles.week} data-testid={`agent-week-${agent.id}`} title={orphan ? undefined : "Work sessions this week, and their cost"}>
        {orphan ? null : <WeekCell agent={agent} />}
      </div>
      <div className={styles.actions}>
        {orphan ? (
          <OrphanButtons agent={agent} tools={tools} small removing={removing} onRemoving={setRemoving} />
        ) : (
          <>
            <StartButton agent={agent} tools={tools} small />
            <MoreButton agent={agent} tools={tools} className={`${controls.iconBtn} ${styles.more}`} />
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
