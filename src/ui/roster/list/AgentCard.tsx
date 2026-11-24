// One agent as a card (DESIGN §3.3): name and state chips, provider and model, the role line, the
// tags, Connected to, Last active, This week, and the actions. The role line and the tags each have
// their space reserved (two lines, one row), so editing them in place moves nothing; the actions
// stay inside the card at every width. An agent that has never run a session shows Needs login and,
// as the card's notice, the setup prompt to copy.

import { useRef, useState, type ReactElement } from "react";

import { CaretIcon, ChevronIcon, MoreIcon, ResumeIcon, SessionsIcon, WarningIcon } from "../../core/icons.tsx";
import { Menu, type MenuAnchor, type MenuEntry } from "../../core/Menu.tsx";
import { NeedsLoginChip, NeedsLoginNotice } from "../NeedsLogin.tsx";
import type { RosterActions } from "./actions.ts";
import { ConnectedTo } from "./ConnectedTo.tsx";
import { CARD_NAMES } from "./connected-model.ts";
import { LinkIcon } from "./list-icons.tsx";
import { chipsOf, lastActiveText, modelLabel, weekText, type AgentView } from "./roster-model.ts";
import controls from "./controls.module.css";
import styles from "./AgentCard.module.css";

export interface AgentCardProps {
  agent: AgentView;
  actions: RosterActions;
  /** How many projects the workspace has. */
  projects: number;
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
      {chipsOf(agent).map((chip) => (
        <span key={chip.id} className={controls.chip} data-tone={chip.tone} title={chip.title} data-testid={`chip-${chip.id}`}>
          {chip.label}
        </span>
      ))}
    </>
  );
}

export function OrphanActions({ agent, small }: { agent: AgentView; small?: boolean }): ReactElement {
  const size = small === true ? controls.small : "";
  return (
    <>
      <button type="button" className={`${controls.primary} ${size}`} data-testid={`agent-relink-${agent.id}`}>
        <LinkIcon />
        Re-link
        <span className={controls.caret}>
          <CaretIcon />
        </span>
      </button>
      <button type="button" className={`${controls.btn} ${size}`} data-testid={`agent-remove-${agent.id}`}>
        Remove
      </button>
    </>
  );
}

/** The ⋯ button and its menu: the agent's page, and Clone… for an agent that can be cloned. */
export function MoreButton({ agent, actions, className }: { agent: AgentView; actions: RosterActions; className: string }): ReactElement {
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const entries: MenuEntry[] = [{ kind: "item", id: "open-agent", label: "Open agent page", run: () => actions.openAgent(agent.id) }];
  if (agent.cloneable) entries.push({ kind: "item", id: "clone", label: "Clone…", run: () => actions.cloneAgent(agent.id) });
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
      {menu !== null && <Menu entries={entries} anchor={menu} onClose={() => setMenu(null)} label={`${agent.name} actions`} testId={`agent-menu-${agent.id}`} />}
    </>
  );
}

function Notice({ agent }: { agent: AgentView }): ReactElement | null {
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
    return (
      <div className={styles.notice} data-testid={`agent-notice-${agent.id}`}>
        <WarningIcon size={14} />
        <span>
          <code>agent.yaml</code> can’t be used: {agent.problem}. The agent runs on its first-sight values; the file is never written over.{" "}
          <button type="button" className={styles.link} data-testid={`agent-open-yaml-${agent.id}`}>
            Open agent.yaml
          </button>
        </span>
      </div>
    );
  }
  if (agent.needsLogin) return <NeedsLoginNotice prompt={agent.setupPrompt} testId={`agent-needs-login-${agent.id}`} />;
  return null;
}

export function AgentCard({ agent, actions, projects, now }: AgentCardProps): ReactElement {
  const { orphan } = agent;
  return (
    <article className={styles.card} data-testid={`agent-card-${agent.id}`} data-orphan={orphan ? "" : undefined} data-hidden={agent.hidden ? "" : undefined}>
      <div className={styles.top}>
        <button type="button" className={styles.name} disabled={orphan} title={agent.id} data-testid={`agent-name-${agent.id}`} onClick={() => actions.openAgent(agent.id)}>
          {agent.name}
        </button>
        <StateChips agent={agent} />
        <span className={styles.spacer} />
        {!orphan && <MoreButton agent={agent} actions={actions} className={`${controls.iconBtn} ${styles.more}`} />}
      </div>
      <div className={styles.sub}>
        {agent.providerLabel}
        <span className={styles.sep}>·</span>
        <ModelLine agent={agent} />
      </div>
      <p className={styles.role} data-testid={`agent-role-${agent.id}`} title={agent.role ?? undefined}>
        {agent.role ?? <span className={styles.faint}>No role line</span>}
      </p>
      <div className={styles.tags} data-testid={`agent-tags-${agent.id}`} title={agent.tags.length > 0 ? agent.tags.join(", ") : undefined}>
        {agent.tags.length === 0 ? (
          <span className={styles.faint}>No tags</span>
        ) : (
          agent.tags.map((tag) => (
            <span key={tag} className={styles.tag}>
              {tag}
            </span>
          ))
        )}
      </div>
      <Notice agent={agent} />
      {!orphan && (
        <dl className={styles.facts}>
          <dt>Connected to</dt>
          <dd>
            <ConnectedTo agent={agent.id} agentName={agent.name} ranked={agent.connected} projects={projects} max={CARD_NAMES} onOpen={() => actions.openProjects(agent.id)} />
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
          <OrphanActions agent={agent} />
        ) : (
          <>
            <button type="button" className={controls.primary} data-testid={`agent-start-${agent.id}`}>
              <ResumeIcon size={12} />
              Start session
              <span className={controls.caret}>
                <CaretIcon />
              </span>
            </button>
            <button type="button" className={controls.btn} title="This agent's sessions" aria-label={`${agent.name}'s sessions`} data-testid={`agent-sessions-${agent.id}`}>
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
