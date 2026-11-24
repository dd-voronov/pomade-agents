// The agent page's header: ← Roster, the name with its state chips, Start session ▾ and the ⋯
// menu — the Roster card's own (`commands/`): Clone…, Hide / Show in the "+" menu, Open CLAUDE.md,
// Open agent.yaml; then the provider, the model and the launch command; then a notice for what needs
// the user's attention — an orphan, an unreadable profile, Needs login with its setup prompt; the
// tab bar closes it (`children`).

import { useRef, useState, type ReactElement, type ReactNode } from "react";

import { newAgentRoute } from "../../core/routes.ts";
import { BackIcon, MoreIcon, WarningIcon } from "../../core/icons.tsx";
import { Menu, type MenuAnchor } from "../../core/Menu.tsx";
import { agentMenuEntries, StartSession, type RosterScope } from "../commands/AgentMenus.tsx";
import type { AgentCommands } from "../commands/useAgentCommands.ts";
import { needsLogin, setupPromptOf } from "../needs-login.ts";
import { NeedsLoginChip, NeedsLoginNotice } from "../NeedsLogin.tsx";
import type { AgentContext } from "./agent-context.ts";
import { PROVIDER_LABELS, chipsOf, modelText, providerOf } from "./agent-model.ts";
import styles from "./page.module.css";

export interface AgentHeaderProps {
  context: AgentContext;
  commands: AgentCommands;
  /** The agent's connected project ids, in the Projects panel's order. */
  connected: readonly string[];
  children: ReactNode;
}

export function AgentHeader({ context, commands, connected, children }: AgentHeaderProps): ReactElement {
  const { entry, navigate, dataDir, counts, projects, profilesOff } = context;
  const { profile } = entry;
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const more = useRef<HTMLButtonElement>(null);
  const model = modelText(entry);
  const chips = chipsOf(entry);
  const loggedOut = needsLogin(entry, counts);
  const scope: RosterScope = { projects, profilesOff, dataDir };

  return (
    <header className={styles.head} data-testid="agent-header">
      <button type="button" className={styles.crumb} data-testid="agent-back" onClick={() => navigate("roster")}>
        <BackIcon size={14} />
        Roster
      </button>
      <div className={styles.title}>
        <h1 className={styles.name} title={entry.id} data-testid="agent-name">
          {entry.id}
        </h1>
        {(chips.length > 0 || loggedOut) && (
          <div className={styles.chips}>
            {loggedOut && <NeedsLoginChip testId="agent-chip-needs-login" />}
            {chips.map((chip) => (
              <span key={chip.key} className={styles.chip} data-tone={chip.tone} title={chip.title} data-testid={`agent-chip-${chip.key}`}>
                {chip.label}
              </span>
            ))}
          </div>
        )}
        <span className={styles.spacer} />
        <div className={styles.actions}>
          {!entry.orphan && (
            <StartSession
              entry={entry}
              connected={connected}
              scope={scope}
              commands={commands}
              className={`${styles.btnPrimary}`}
              caretClassName={`${styles.caret}`}
              testId="agent-start-session"
            />
          )}
          <button
            ref={more}
            type="button"
            className={styles.iconBtn}
            aria-label="More"
            title="More"
            aria-haspopup="menu"
            aria-expanded={menu !== null}
            data-testid="agent-more"
            onClick={() => setMenu(more.current?.getBoundingClientRect() ?? { x: 0, y: 0 })}
          >
            <MoreIcon />
          </button>
        </div>
      </div>
      <div className={styles.sub} data-testid="agent-sub">
        {PROVIDER_LABELS[providerOf(entry)]}
        <span className={styles.sep}>·</span>
        {model.model === null ? <span className={styles.dash}>provider default</span> : <>{model.model}{model.effort !== null && <span className={styles.faint}> {model.effort}</span>}</>}
        {profile !== null && (
          <>
            <span className={styles.sep}>·</span>
            launches with <code>{profile.command}</code>
          </>
        )}
      </div>
      {entry.orphan && (
        <div className={styles.notice} data-testid="agent-orphan-notice">
          <WarningIcon size={14} />
          <span>
            Its config folder{profile === null ? "" : <> <code>{profile.configDir}</code></>} is gone — renamed or removed outside the app. It is left out of the “+” menu and launches.
          </span>
        </div>
      )}
      {entry.problem !== null && (
        <div className={styles.notice} data-testid="agent-problem-notice">
          <WarningIcon size={14} />
          <span>
            <code>agent.yaml</code> {entry.problem}. The agent runs on its first-sight values; the file is never written over.
          </span>
        </div>
      )}
      {loggedOut && (
        <div className={styles.noticeSlot}>
          <NeedsLoginNotice prompt={setupPromptOf(entry)} testId="agent-needs-login" />
        </div>
      )}
      {children}
      {menu !== null && (
        <Menu
          entries={agentMenuEntries(entry, { scope, commands, roster: null, clone: () => navigate(newAgentRoute(entry.id)) })}
          anchor={menu}
          onClose={() => setMenu(null)}
          label="Agent actions"
          testId="agent-menu"
        />
      )}
    </header>
  );
}
