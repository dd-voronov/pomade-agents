// The agent page's header: ← Roster, the name with its state chips, Start session ▾ and the ⋯
// menu; then the provider, the model and the launch command; then a notice for what needs the
// user's attention; the tab bar closes it (`children`). Start session, Hide and Clone… belong to other tickets (`agent-actions.ts`):
// they show here, disabled, until those are wired.

import { useRef, useState, type ReactElement, type ReactNode } from "react";

import { BackIcon, CaretIcon, DocIcon, MoreIcon, ResumeIcon, WarningIcon } from "../../core/icons.tsx";
import { Menu, type MenuAnchor, type MenuEntry } from "../../core/Menu.tsx";
import type { AgentActions } from "./agent-actions.ts";
import type { AgentContext } from "./agent-context.ts";
import { PROVIDER_LABELS, chipsOf, claudeMdOf, isEditable, modelText, profileFileOf, providerOf } from "./agent-model.ts";
import styles from "./page.module.css";

const LATER = { why: "Not available yet" };

export function AgentHeader({ context, actions, children }: { context: AgentContext; actions: AgentActions; children: ReactNode }): ReactElement {
  const { entry, openFile, navigate, dataDir } = context;
  const { profile } = entry;
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const more = useRef<HTMLButtonElement>(null);
  const start = useRef<HTMLButtonElement>(null);
  const claudeMd = claudeMdOf(entry);
  const profileFile = profileFileOf(dataDir, entry.id);
  const model = modelText(entry);
  const chips = chipsOf(entry);
  const hidden = profile?.hidden === true;
  const cloneable = profile !== null && profile.provider === "claude" && profile.kind === "folder" && !entry.orphan;

  const entries: MenuEntry[] = [];
  if (cloneable) entries.push({ kind: "item", id: "clone", label: "Clone…", ...(actions.clone === null ? { disabled: LATER } : {}), run: () => actions.clone?.() });
  entries.push({
    kind: "item",
    id: "hide",
    label: hidden ? "Show in the “+” menu" : "Hide from the “+” menu",
    ...(actions.setHidden === null || !isEditable(entry) ? { disabled: actions.setHidden === null ? LATER : { why: "The agent’s profile cannot be written" } } : {}),
    run: () => actions.setHidden?.(!hidden),
  });
  if (providerOf(entry) === "claude") {
    entries.push({ kind: "item", id: "open-claude-md", label: "Open CLAUDE.md", glyph: <DocIcon size={14} />, ...(claudeMd === null ? { disabled: { why: "No config folder" } } : {}), run: () => claudeMd !== null && openFile(claudeMd) });
  }
  entries.push({ kind: "item", id: "open-agent-yaml", label: "Open agent.yaml", glyph: <DocIcon size={14} />, ...(profileFile === null ? { disabled: { why: "No workspace is open" } } : {}), run: () => profileFile !== null && openFile(profileFile) });

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
        {chips.length > 0 && (
          <div className={styles.chips}>
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
            <button
              ref={start}
              type="button"
              className={styles.btnPrimary}
              disabled={actions.startSession === null}
              title={actions.startSession === null ? LATER.why : undefined}
              data-testid="agent-start-session"
              onClick={() => start.current !== null && actions.startSession?.(start.current.getBoundingClientRect())}
            >
              <ResumeIcon size={12} />
              Start session
              <span className={styles.caret}>
                <CaretIcon size={12} />
              </span>
            </button>
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
      {children}
      {menu !== null && <Menu entries={entries} anchor={menu} onClose={() => setMenu(null)} label="Agent actions" testId="agent-menu" />}
    </header>
  );
}
