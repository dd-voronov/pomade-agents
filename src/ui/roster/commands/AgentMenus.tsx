// An agent's buttons with their menus, the same on a card, a list row and the agent's page
// (ARCHITECTURE §3.3, §3.4): **Start session ▾** — the mode when more than Normal is enabled, then the
// connected projects, the others, the Workspace; the ⋯ menu's entries — on the Roster also the
// agent's page and its sessions — Clone…, Hide / Show in the "+" menu, Open CLAUDE.md, Open
// agent.yaml; and an orphan's **Re-link ▾** (the unclaimed agent folders, read each time it opens) and
// **Remove**, which asks first. Each caller gives the button its look.

import { useRef, useState, type ReactElement, type ReactNode } from "react";
import { WORKSPACE_PROJECT_ID, type ProjectRef } from "pomade-kit/protocol";

import type { ModeId, RosterEntry, UnclaimedFolder } from "../../../shared/roster.ts";
import { CaretIcon, DocIcon, EyeOffIcon, OpenIcon, ResumeIcon, SessionsIcon, TrashIcon } from "../../core/icons.tsx";
import { Menu, type MenuAnchor, type MenuEntry } from "../../core/Menu.tsx";
import { claudeMdOf, isEditable, profileFileOf, providerOf } from "../agent-page/agent-model.ts";
import { ProjectSwatch } from "../ProjectSwatch.tsx";
import { LinkIcon } from "../list/list-icons.tsx";
import { CopyGlyph } from "../new-agent/glyphs.tsx";
import { cannotStart, launchModes, launchTargets } from "./commands-model.ts";
import type { AgentCommands } from "./useAgentCommands.ts";
import styles from "./menus.module.css";

/** What the menus need besides the agent: the projects, whether profiles are kept, where. */
export interface RosterScope {
  /** Pomade's projects by stable id, in the Projects panel's order. */
  projects: ReadonlyMap<string, ProjectRef>;
  /** Why no profiles are kept (no workspace is open); `null` while they are. */
  profilesOff: string | null;
  /** `<workspace>/Apps/pomade-agents`, absolute; `null` without a workspace. */
  dataDir: string | null;
}

/** The Workspace's glyph in a menu: the project every agent is offered in. */
function WorkspaceGlyph(): ReactElement {
  return <span className={styles.workspace} aria-hidden="true" />;
}

function useAnchor(): [MenuAnchor | null, (button: HTMLButtonElement | null) => void, () => void] {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  return [anchor, (button) => setAnchor(button?.getBoundingClientRect() ?? { x: 0, y: 0 }), () => setAnchor(null)];
}

export interface StartSessionProps {
  entry: RosterEntry;
  /** Its connected project ids. */
  connected: readonly string[];
  scope: RosterScope;
  commands: AgentCommands;
  /** The button's look. */
  className: string;
  caretClassName: string;
  testId: string;
}

/** **Start session ▾**: off, saying why, for an agent Pomade cannot launch. */
export function StartSession({ entry, connected, scope, commands, className, caretClassName, testId }: StartSessionProps): ReactElement {
  const button = useRef<HTMLButtonElement>(null);
  const [anchor, open, close] = useAnchor();
  const [mode, setMode] = useState<ModeId>("normal");
  const why = cannotStart(entry, scope.profilesOff);
  const modes = launchModes(entry);
  const chosen = modes.some((m) => m.id === mode) ? mode : "normal";
  const { connected: on, others } = launchTargets(connected, scope.projects);

  const item = (id: string, label: string, glyph: ReactNode): MenuEntry => ({ kind: "item", id: `launch-${id}`, label, glyph, run: () => commands.launch(entry.id, chosen, id) });
  const entries: MenuEntry[] = [];
  if (modes.length > 1) entries.push({ kind: "segment", id: "mode", label: "Mode", options: modes.map((m) => ({ id: m.id, label: m.name })), value: chosen, onChange: (id) => setMode(id as ModeId) });
  if (on.length > 0) entries.push({ kind: "head", label: "Connected" }, ...on.map((p) => item(p.id, p.name, <ProjectSwatch id={p.id} />)));
  if (others.length > 0) entries.push({ kind: "head", label: "Not connected" }, ...others.map((p) => item(p.id, p.name, <ProjectSwatch id={p.id} />)));
  if (on.length + others.length > 0) entries.push({ kind: "separator" });
  entries.push(item(WORKSPACE_PROJECT_ID, "Workspace", <WorkspaceGlyph />));

  return (
    <>
      <button
        ref={button}
        type="button"
        className={className}
        disabled={why !== null}
        title={why ?? undefined}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        data-testid={testId}
        onClick={() => open(button.current)}
      >
        <ResumeIcon size={12} />
        Start session
        <span className={caretClassName}>
          <CaretIcon size={12} />
        </span>
      </button>
      {anchor !== null && <Menu entries={entries} anchor={anchor} onClose={close} label={`Start ${entry.name}`} testId="start-menu" />}
    </>
  );
}

export interface AgentMenuOptions {
  scope: RosterScope;
  commands: AgentCommands;
  /** The Roster's menu also opens the agent's page and its sessions; the page's does not. */
  roster: { openAgent: () => void } | null;
  /** Clone… — the New agent page with this agent as its source. */
  clone: () => void;
}

/** The ⋯ menu's entries for `entry`. */
export function agentMenuEntries(entry: RosterEntry, { scope, commands, roster, clone }: AgentMenuOptions): MenuEntry[] {
  const entries: MenuEntry[] = [];
  if (roster !== null) {
    entries.push(
      { kind: "item", id: "open-agent", label: "Open agent page", glyph: <OpenIcon size={14} />, run: roster.openAgent },
      { kind: "item", id: "sessions", label: "Sessions", glyph: <SessionsIcon size={14} />, run: () => commands.openSessions(entry.id) },
      { kind: "separator" },
    );
  }
  const cloneable = entry.profile !== null && entry.provider === "claude" && entry.kind === "folder" && !entry.orphan;
  if (cloneable) entries.push({ kind: "item", id: "clone", label: "Clone…", glyph: <CopyGlyph size={14} />, run: clone });
  const hidden = entry.hidden;
  entries.push({
    kind: "item",
    id: "hide",
    label: hidden ? "Show in the “+” menu" : "Hide from the “+” menu",
    glyph: <EyeOffIcon size={14} />,
    ...(isEditable(entry) ? {} : { disabled: { why: scope.profilesOff === null ? "The agent’s profile cannot be written" : "No workspace is open" } }),
    run: () => commands.setHidden(entry.id, entry.name, !hidden),
  });
  const claudeMd = claudeMdOf(entry);
  if (providerOf(entry) === "claude") {
    entries.push({ kind: "item", id: "open-claude-md", label: "Open CLAUDE.md", glyph: <DocIcon size={14} />, ...(claudeMd === null ? { disabled: { why: "No config folder" } } : {}), run: () => claudeMd !== null && commands.openFile(claudeMd) });
  }
  const profileFile = profileFileOf(scope.dataDir, entry.id);
  entries.push({ kind: "item", id: "open-agent-yaml", label: "Open agent.yaml", glyph: <DocIcon size={14} />, ...(profileFile === null ? { disabled: { why: "No workspace is open" } } : {}), run: () => profileFile !== null && commands.openFile(profileFile) });
  return entries;
}

export interface OrphanActionsProps {
  entry: RosterEntry;
  commands: AgentCommands;
  /** Remove asked, waiting for its confirmation. */
  removing: boolean;
  onRemoving: (removing: boolean) => void;
  /** The buttons' looks. */
  primary: string;
  plain: string;
  danger: string;
  caretClassName: string;
}

type Folders = { state: "failed" } | { state: "read"; folders: UnclaimedFolder[] };

/** An orphan's **Re-link ▾** and **Remove**; once Remove is asked, **Remove** (danger) and **Cancel**. */
export function OrphanActions({ entry, commands, removing, onRemoving, primary, plain, danger, caretClassName }: OrphanActionsProps): ReactElement {
  const button = useRef<HTMLButtonElement>(null);
  const [anchor, open, close] = useAnchor();
  const [folders, setFolders] = useState<Folders>({ state: "read", folders: [] });
  const [busy, setBusy] = useState(false);

  if (removing) {
    return (
      <>
        <button
          type="button"
          className={danger}
          disabled={busy}
          data-testid={`agent-remove-confirm-${entry.id}`}
          onClick={() => {
            setBusy(true);
            void commands.removeOrphan(entry.id, entry.name).then((removed) => {
              setBusy(false);
              if (!removed) onRemoving(false);
            });
          }}
        >
          <TrashIcon size={14} />
          Remove
        </button>
        <button type="button" className={plain} disabled={busy} data-testid={`agent-remove-cancel-${entry.id}`} onClick={() => onRemoving(false)}>
          Cancel
        </button>
      </>
    );
  }

  const entries: MenuEntry[] = [{ kind: "head", label: "Unclaimed agent folders" }];
  if (folders.state === "failed") entries.push({ kind: "note", text: "The agent folders could not be read." });
  else if (folders.folders.length === 0) entries.push({ kind: "note", text: "None: every agent folder is an agent’s own." });
  else entries.push(...folders.folders.map((folder): MenuEntry => ({ kind: "item", id: `relink-${folder.name}`, label: folder.configDir, glyph: <LinkIcon size={14} />, run: () => commands.relink(entry.id, entry.name, folder) })));

  return (
    <>
      <button
        ref={button}
        type="button"
        className={primary}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        data-testid={`agent-relink-${entry.id}`}
        onClick={() => {
          // The menu opens once the folders are read (a local read): it is placed at its full size.
          commands.unclaimedFolders().then(
            (found) => {
              setFolders({ state: "read", folders: found });
              open(button.current);
            },
            () => {
              setFolders({ state: "failed" });
              open(button.current);
            },
          );
        }}
      >
        <LinkIcon size={14} />
        Re-link
        <span className={caretClassName}>
          <CaretIcon size={12} />
        </span>
      </button>
      <button type="button" className={plain} data-testid={`agent-remove-${entry.id}`} onClick={() => onRemoving(true)}>
        Remove
      </button>
      {anchor !== null && <Menu entries={entries} anchor={anchor} onClose={close} label={`Re-link ${entry.name}`} testId="relink-menu" />}
    </>
  );
}
