// One agent as a card (DESIGN §3.3): name and state chips, provider and model, the role line, the
// tags, Connected to, Last active, This week, and the actions. The role line (two lines) and the
// tags (one row) are edited in place — the agent page's `RoleLine` and `TagList` — in a room of fixed
// height, so hovering or editing them moves nothing; the actions stay inside the card at every width.
// An agent that has never run a session shows Needs login and, as the card's notice, the setup
// prompt to copy. An orphan shows Re-link ▾ and Remove, which asks in the notice first.

import { useRef, useState, type ReactElement } from "react";

import { ChevronIcon, MoreIcon, SessionsIcon, WarningIcon } from "../../core/icons.tsx";
import { Menu, type MenuAnchor } from "../../core/Menu.tsx";
import { agentMenuEntries, OrphanActions, StartSession, type RosterScope } from "../commands/AgentMenus.tsx";
import type { AgentCommands } from "../commands/useAgentCommands.ts";
import { NeedsLoginChip, NeedsLoginNotice } from "../NeedsLogin.tsx";
import { RoleLine } from "../profile-edit/RoleLine.tsx";
import { TagList } from "../profile-edit/TagList.tsx";
import type { ProfileEdit } from "../profile-edit/useProfileEdit.ts";
import { stateChips } from "../state-chips.ts";
import type { RosterActions } from "./actions.ts";
import { ConnectedTo } from "./ConnectedTo.tsx";
import { CARD_NAMES } from "./connected-model.ts";
import { lastActiveText, modelLabel, weekText, type AgentView } from "./roster-model.ts";
import controls from "./controls.module.css";
import styles from "./AgentCard.module.css";

/** What a card or a row acts with: the tab's navigation, the agents' commands, the profile edits, the projects. */
export interface RosterTools {
  actions: RosterActions;
  commands: AgentCommands;
  edit: ProfileEdit;
  scope: RosterScope;
}

export interface AgentCardProps {
  agent: AgentView;
  tools: RosterTools;
  now: Date;
}

/** "opus-4.8 high", or the provider's default when it sets no model. */
export function ModelLine({ agent }: { agent: AgentView }): ReactElement {
  if (agent.model === null) return <span className={styles.faint}>provider default</span>;
  return (
    <>
      {agent.provider === "codex" ? agent.model : modelLabel(agent.model)}
      {agent.effort !== null && <span className={styles.faint}> {agent.effort}</span>}
    </>
  );
}

export function StateChips({ agent }: { agent: AgentView }): ReactElement {
  return (
    <>
      {agent.needsLogin && <NeedsLoginChip testId={`chip-needs-login-${agent.id}`} />}
      <OtherChips agent={agent} />
    </>
  );
}

/** The state chips but Needs login: a narrow list row drops these and keeps that one. */
export function OtherChips({ agent }: { agent: AgentView }): ReactElement {
  return (
    <>
      {stateChips(agent.entry).map((chip) => (
        <span key={chip.id} className={controls.chip} data-tone={chip.tone} title={chip.title} data-testid={`chip-${chip.id}`}>
          {chip.label}
        </span>
      ))}
    </>
  );
}

/** An orphan's buttons in a card's or a row's look. */
export function OrphanButtons({ agent, tools, small, removing, onRemoving }: { agent: AgentView; tools: RosterTools; small?: boolean; removing: boolean; onRemoving: (removing: boolean) => void }): ReactElement {
  const size = small === true ? controls.small : "";
  return (
    <OrphanActions
      entry={agent.entry}
      commands={tools.commands}
      removing={removing}
      onRemoving={onRemoving}
      primary={`${controls.primary} ${size}`}
      plain={`${controls.btn} ${size}`}
      danger={`${controls.btn} ${controls.danger} ${size}`}
      caretClassName={controls.caret ?? ""}
    />
  );
}

/** Start session ▾ in a card's or a row's look. */
export function StartButton({ agent, tools, small }: { agent: AgentView; tools: RosterTools; small?: boolean }): ReactElement {
  return (
    <StartSession
      entry={agent.entry}
      connected={agent.connectedIds}
      scope={tools.scope}
      commands={tools.commands}
      className={small === true ? `${controls.primary} ${controls.small}` : `${controls.primary}`}
      caretClassName={controls.caret ?? ""}
      testId={`agent-start-${agent.id}`}
    />
  );
}

/** The ⋯ button and its menu: the agent's page and sessions, then Clone…, Hide / Show, its files. */
export function MoreButton({ agent, tools, className }: { agent: AgentView; tools: RosterTools; className: string }): ReactElement {
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const { actions, commands, scope } = tools;
  return (
    <>
      <button
        ref={button}
        type="button"
        className={className}
        title="More"
        aria-label={`More for ${agent.name}`}
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        data-testid={`agent-more-${agent.id}`}
        onClick={() => setMenu(button.current?.getBoundingClientRect() ?? { x: 0, y: 0 })}
      >
        <MoreIcon />
      </button>
      {menu !== null && (
        <Menu
          entries={agentMenuEntries(agent.entry, { scope, commands, roster: { openAgent: () => actions.openAgent(agent.id) }, clone: () => actions.cloneAgent(agent.id) })}
          anchor={menu}
          onClose={() => setMenu(null)}
          label={`${agent.name} actions`}
          testId={`agent-menu-${agent.id}`}
        />
      )}
    </>
  );
}

function Notice({ agent, tools, removing }: { agent: AgentView; tools: RosterTools; removing: boolean }): ReactElement | null {
  if (agent.orphan && removing) {
    return (
      <div className={styles.notice} data-tone="danger" data-testid={`agent-notice-${agent.id}`}>
        <span>
          Remove <b>{agent.name}</b>’s profile? This deletes <code>Apps/pomade-agents/agents/{agent.id}/</code>. No agent folder is touched.
        </span>
      </div>
    );
  }
  if (agent.orphan) {
    return (
      <div className={styles.notice} data-testid={`agent-notice-${agent.id}`}>
        <WarningIcon size={14} />
        <span>
          Its config folder <code>{agent.configDir}</code> is gone — renamed or removed outside the app. It is left out of the “+” menu and launches.
        </span>
      </div>
    );
  }
  if (agent.problem !== null) {
    const profileFile = tools.scope.dataDir === null ? null : `${tools.scope.dataDir}/agents/${agent.id}/agent.yaml`;
    return (
      <div className={styles.notice} data-testid={`agent-notice-${agent.id}`}>
        <WarningIcon size={14} />
        <span>
          <code>agent.yaml</code> can’t be used: {agent.problem}. The agent runs on its first-sight values; the file is never written over.{" "}
          <button type="button" className={styles.link} disabled={profileFile === null} data-testid={`agent-open-yaml-${agent.id}`} onClick={() => profileFile !== null && tools.commands.openFile(profileFile)}>
            Open agent.yaml
          </button>
        </span>
      </div>
    );
  }
  if (agent.needsLogin) return <NeedsLoginNotice prompt={agent.setupPrompt} testId={`agent-needs-login-${agent.id}`} />;
  return null;
}

export function AgentCard({ agent, tools, now }: AgentCardProps): ReactElement {
  const { orphan } = agent;
  const { actions, edit, scope } = tools;
  const [removing, setRemoving] = useState(false);
  const editable = !agent.readOnly;
  return (
    <article className={styles.card} data-testid={`agent-card-${agent.id}`} data-orphan={orphan ? "" : undefined} data-hidden={agent.hidden ? "" : undefined}>
      <div className={styles.top}>
        <button type="button" className={styles.name} disabled={orphan} title={agent.id} data-testid={`agent-name-${agent.id}`} onClick={() => actions.openAgent(agent.id)}>
          {agent.name}
        </button>
        <StateChips agent={agent} />
        <span className={styles.spacer} />
        {!orphan && <MoreButton agent={agent} tools={tools} className={`${controls.iconBtn} ${styles.more}`} />}
      </div>
      <div className={styles.sub}>
        {agent.providerLabel}
        <span className={styles.sep}>·</span>
        <ModelLine agent={agent} />
      </div>
      <div className={styles.role} data-testid={`agent-role-room-${agent.id}`}>
        <RoleLine role={agent.role ?? undefined} editable={editable} onSave={(role) => edit.saveRole(agent.id, role)} lines={2} testId={`agent-role-${agent.id}`} />
      </div>
      <TagList tags={agent.tags} editable={editable} onSave={(tags) => edit.saveTags(agent.id, tags)} add="hover" oneRow testId={`agent-tags-${agent.id}`} />
      <Notice agent={agent} tools={tools} removing={removing} />
      {!orphan && (
        <dl className={styles.facts}>
          <dt>Connected to</dt>
          <dd>
            <ConnectedTo agent={agent.id} agentName={agent.name} ranked={agent.connected} projects={scope.projects.size} max={CARD_NAMES} onOpen={() => actions.openProjects(agent.id)} />
          </dd>
          <dt>Last active</dt>
          <dd data-testid={`agent-last-${agent.id}`}>{lastActiveText(agent.lastActiveAt, now)}</dd>
          <dt>This week</dt>
          <dd data-testid={`agent-week-${agent.id}`} title="Work sessions this week, and their cost">
            {weekText(agent.week)}
          </dd>
        </dl>
      )}
      <div className={styles.actions}>
        {orphan ? (
          <OrphanButtons agent={agent} tools={tools} removing={removing} onRemoving={setRemoving} />
        ) : (
          <>
            <StartButton agent={agent} tools={tools} />
            <button
              type="button"
              className={controls.btn}
              title="This agent's sessions"
              aria-label={`${agent.name}'s sessions`}
              data-testid={`agent-sessions-${agent.id}`}
              onClick={() => tools.commands.openSessions(agent.id)}
            >
              <SessionsIcon size={14} />
              <span className={styles.sessionsLabel}>Sessions</span>
            </button>
            <button type="button" className={`${controls.btn} ${styles.open}`} title={`Open ${agent.name}'s page`} data-testid={`agent-open-${agent.id}`} onClick={() => actions.openAgent(agent.id)}>
              Open
              <span className={styles.openChevron}>
                <ChevronIcon size={12} />
              </span>
            </button>
          </>
        )}
      </div>
    </article>
  );
}
