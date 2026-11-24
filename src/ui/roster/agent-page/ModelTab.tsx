// Model & modes (DESIGN §3.4, §3.5; layout: prototypes/roster): the agent's default model and
// effort, written to Claude Code's `settings.json` (only those keys; Codex read-only), then its
// modes — Normal always on, a switch for Full autonomy in `agent.yaml` — each enabled one with its
// launch line, read-only, and Copy.

import { useEffect, useRef, useState, type ReactElement } from "react";
import type { HostClient } from "pomade-kit/sdk";

import { copyText } from "../../core/clipboard.ts";
import { CaretIcon, CheckIcon, WarningIcon } from "../../core/icons.tsx";
import { Menu, type MenuAnchor, type MenuEntry } from "../../core/Menu.tsx";
import { Switch } from "../../core/Switch.tsx";
import { EFFORT_LEVELS } from "../../../shared/model-choices.ts";
import {
  ROSTER_MODEL_CONFIG_METHOD,
  ROSTER_SET_MODEL_METHOD,
  ROSTER_UPDATE_PROFILE_METHOD,
  isAgentModelConfig,
  isRosterUpdateProfileResult,
  type AgentModelConfig,
  type ModeId,
  type RosterSetModelParams,
} from "../../../shared/roster.ts";
import { CopyGlyph } from "../new-agent/glyphs.tsx";
import type { AgentContext } from "./agent-context.ts";
import { isEditable, providerOf } from "./agent-model.ts";
import {
  LISTED_MODES,
  MODE_TEXT,
  changeFailedText,
  configFileLabel,
  effortSavedText,
  modeEnabled,
  modeSavedText,
  modelChoices,
  modelSavedText,
} from "./model-tab-model.ts";
import { Section } from "./Section.tsx";
import styles from "./page.module.css";
import tab from "./model-tab.module.css";
import { useAgentRead } from "./useAgentRead.ts";
import { useLaunchLines, type LaunchLine } from "./useLaunchLines.ts";

const ANSWER_TIMEOUT_MS = 5000;
const COPIED_MS = 1500;

/** Why the agent's settings cannot be changed here, or `null` when they can. */
function lockedReason(context: AgentContext): string | null {
  const { entry, profilesOff } = context;
  if (profilesOff !== null) return "Read-only: no workspace is open.";
  if (entry.orphan) return "Read-only: its config folder is gone.";
  if (!isEditable(entry)) return "Read-only until its agent.yaml can be read.";
  return null;
}

function CopyButton({ text, testId }: { text: string; testId: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async (): Promise<void> => {
    await copyText(text);
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };
  const label = copied ? "Copied" : "Copy the launch line";
  return (
    <button type="button" className={styles.iconBtn} title={label} aria-label={label} data-testid={testId} data-copied={copied || undefined} onClick={() => void copy()}>
      {copied ? <CheckIcon size={14} /> : <CopyGlyph size={14} />}
    </button>
  );
}

function CodexModel({ context, config }: { context: AgentContext; config: AgentModelConfig }): ReactElement {
  return (
    <div className={styles.block} data-testid="model-codex">
      <dl className={styles.facts}>
        <dt>Model</dt>
        <dd data-testid="model-fact-model">{config.model ?? <span className={styles.dash}>provider default</span>}</dd>
        <dt>Effort</dt>
        <dd data-testid="model-fact-effort">{config.effort ?? <span className={styles.dash}>provider default</span>}</dd>
        <dt>Set in</dt>
        <dd>
          <button type="button" className={styles.link} disabled={!config.exists} data-testid="model-open-config" onClick={() => context.openFile(config.file)}>
            {configFileLabel(context.entry.profile?.configDir, config.file)}
          </button>
        </dd>
      </dl>
      <p className={`${styles.hint} ${tab.hintIn}`} data-testid="model-hint">
        Read-only here: editing Codex’s model comes with Codex-based agents.
      </p>
    </div>
  );
}

interface ClaudeModelProps {
  context: AgentContext;
  config: AgentModelConfig;
  busy: boolean;
  onSet: (params: Omit<RosterSetModelParams, "agent">) => void;
}

function ClaudeModel({ context, config, busy, onSet }: ClaudeModelProps): ReactElement {
  const { entry, openFile } = context;
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const select = useRef<HTMLButtonElement>(null);
  const reason = lockedReason(context);
  const locked = reason !== null || !config.writable;
  const where = configFileLabel(entry.profile?.configDir, config.file);
  const entries: MenuEntry[] = [
    ...modelChoices(config.model).map(({ id, checked }): MenuEntry => ({ kind: "item", id: `model-${id}`, label: id, checked, run: () => id !== config.model && onSet({ model: id }) })),
    { kind: "separator" },
    { kind: "item", id: "model-default", label: "Provider default", checked: config.model === null, trail: "removes the key", run: () => config.model !== null && onSet({ model: null }) },
  ];
  return (
    <div className={styles.block} data-testid="model-claude">
      {config.problem !== null && (
        <div className={`${styles.notice} ${tab.noticeIn}`} data-testid="model-problem">
          <WarningIcon size={14} />
          <span>
            <code>{where}</code> cannot be used: {config.problem}. The model is read-only here until it is fixed — the app never writes over it.{" "}
            <button type="button" className={styles.link} data-testid="model-open-settings" onClick={() => openFile(config.file)}>
              Open settings.json
            </button>
          </span>
        </div>
      )}
      <div className={tab.fieldRow}>
        <span className={tab.fieldLabel} id="model-label">
          Default model
        </span>
        <button
          ref={select}
          type="button"
          className={`${styles.btn} ${styles.sm} ${tab.select}`}
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          aria-labelledby="model-label"
          disabled={locked || busy}
          data-testid="model-select"
          onClick={() => setMenu(select.current?.getBoundingClientRect() ?? { x: 0, y: 0 })}
        >
          <span className={tab.selectText}>{config.model ?? "Provider default"}</span>
          <span className={styles.caret}>
            <CaretIcon size={12} />
          </span>
        </button>
      </div>
      <div className={tab.fieldRow}>
        <span className={tab.fieldLabel} id="effort-label">
          Effort
        </span>
        <div className={tab.seg} role="group" aria-labelledby="effort-label" data-testid="effort">
          {EFFORT_LEVELS.map((level) => (
            <button key={level} type="button" aria-pressed={config.effort === level} disabled={locked || busy} data-level={level} data-testid={`effort-${level}`} onClick={() => level !== config.effort && onSet({ effort: level })}>
              <span>{level}</span>
            </button>
          ))}
        </div>
      </div>
      <p className={`${styles.hint} ${tab.hintIn}`} data-testid="model-hint">
        {reason ?? (
          <>
            Writes <code>model</code> and <code>effortLevel</code> in <code>{where}</code>; no other key changes. Sessions already running keep theirs.
          </>
        )}
      </p>
      {menu !== null && <Menu entries={entries} anchor={menu} onClose={() => setMenu(null)} label="Default model" testId="model-menu" />}
    </div>
  );
}

interface ModeRowProps {
  context: AgentContext;
  mode: ModeId;
  on: boolean;
  line: LaunchLine | undefined;
  /** Why the switch takes no clicks, or `null`. */
  locked: string | null;
  onSwitch: (on: boolean) => void;
}

function ModeRow({ context, mode, on, line, locked, onSwitch }: ModeRowProps): ReactElement {
  const { entry } = context;
  const normal = mode === "normal";
  const title = normal ? "Normal is always offered" : (locked ?? (on ? "Offered — click to stop offering it" : "Not offered — click to offer it"));
  return (
    <div className={tab.modeRow} data-testid={`mode-row-${mode}`} data-on={on || undefined}>
      <span className={tab.switchSlot}>
        <Switch on={on} {...(normal || locked !== null ? {} : { onChange: onSwitch })} title={title} label={MODE_TEXT[mode].label} testId={`mode-switch-${mode}`} />
      </span>
      <div className={tab.modeText}>
        <div className={tab.modeL1}>
          <b>{MODE_TEXT[mode].label}</b>
          <span className={styles.faint}>{MODE_TEXT[mode][providerOf(entry)]}</span>
        </div>
        {!on ? (
          <div className={tab.modeOff} data-testid={`mode-off-${mode}`}>
            Not offered: not in the “+” menu, not by Runner, not on this agent’s Start session.
          </div>
        ) : entry.orphan ? (
          <div className={tab.modeOff}>Not launched: its config folder is gone.</div>
        ) : (
          <div className={tab.spec}>
            <code className={tab.specLine} title={line?.ok === true ? line.spec.line : undefined} data-testid={`launch-line-${mode}`}>
              {line === undefined ? " " : line.ok ? line.spec.line : <span className={styles.dash}>{line.reason}</span>}
            </code>
            {line?.ok === true ? <CopyButton text={line.spec.line} testId={`copy-line-${mode}`} /> : <span className={tab.copySlot} />}
          </div>
        )}
      </div>
    </div>
  );
}

function Modes({ context, host }: { context: AgentContext; host: HostClient }): ReactElement {
  const { entry, revision, show } = context;
  const [pending, setPending] = useState<{ agent: string; mode: ModeId; on: boolean } | null>(null);
  // A switch shows its new state from the click until the roster answers with it.
  const pendingSaved = pending === null ? null : modeEnabled(entry, pending.mode);
  useEffect(() => {
    if (pending !== null && (pending.agent !== entry.id || pendingSaved === pending.on)) setPending(null);
  }, [pending, pendingSaved, entry.id]);
  const asked = LISTED_MODES.filter((mode) => modeEnabled(entry, mode) !== false);
  const lines = useLaunchLines(host, entry.id, asked, revision);
  const shownOn = (mode: ModeId): boolean => {
    if (pending !== null && pending.agent === entry.id && pending.mode === mode) return pending.on;
    return modeEnabled(entry, mode) ?? lines.get(mode)?.ok === true;
  };
  const locked = lockedReason(context) ?? (pending !== null ? "Saving…" : null);
  const exit = [...lines.values()].find((l): l is Extract<LaunchLine, { ok: true }> => l.ok)?.spec.exit ?? "/exit";

  const switchMode = (mode: ModeId, on: boolean): void => {
    setPending({ agent: entry.id, mode, on });
    void (async () => {
      try {
        const answer = await host.apps.call(host.welcome.appId, ROSTER_UPDATE_PROFILE_METHOD, { agent: entry.id, modes: { [mode]: on } }, { timeoutMs: ANSWER_TIMEOUT_MS });
        if (!isRosterUpdateProfileResult(answer)) throw new Error("the backend's answer was malformed");
        show(modeSavedText(mode, entry.id, on), null);
      } catch (err) {
        setPending(null);
        const failed = changeFailedText("mode", err);
        show(failed.text, null, failed.reason);
      }
    })();
  };

  const idNote =
    providerOf(entry) === "claude" ? (
      <>
        A new session gets its id up front (<code>--session-id</code>). Ends with <code>{exit}</code>.
      </>
    ) : (
      <>
        Codex can’t take a session id up front; callers find the session with <code>sessions.find</code>. Ends with <code>{exit}</code>.
      </>
    );
  return (
    <Section title="Modes" testId="agent-modes">
      <p className={`${styles.hint} ${tab.hintLead}`}>The launch spec Pomade’s “+” menu and Runner build from. {idNote}</p>
      <div className={`${styles.block} ${styles.flush}`}>
        {LISTED_MODES.map((mode) => (
          <ModeRow key={mode} context={context} mode={mode} on={shownOn(mode)} line={lines.get(mode)} locked={locked} onSwitch={(on) => switchMode(mode, on)} />
        ))}
      </div>
    </Section>
  );
}

export function ModelTab({ context }: { context: AgentContext }): ReactElement {
  const { host, entry, revision, show } = context;
  const read = useAgentRead(host, ROSTER_MODEL_CONFIG_METHOD, entry.id, isAgentModelConfig, revision);
  const readValue = read.status === "ready" ? read.value : null;
  // What the tab shows: the latest read, or a write's own answer until the next read lands.
  const [shown, setShown] = useState<{ agent: string; config: AgentModelConfig } | null>(null);
  const [seenRead, setSeenRead] = useState<AgentModelConfig | null>(null);
  if (readValue !== seenRead) {
    setSeenRead(readValue);
    if (readValue !== null) setShown({ agent: entry.id, config: readValue });
  }
  const config = shown !== null && shown.agent === entry.id ? shown.config : null;
  const [busy, setBusy] = useState(false);

  const setModel = (params: Omit<RosterSetModelParams, "agent">): void => {
    setBusy(true);
    void (async () => {
      try {
        const answer = await host.apps.call(host.welcome.appId, ROSTER_SET_MODEL_METHOD, { agent: entry.id, ...params }, { timeoutMs: ANSWER_TIMEOUT_MS });
        if (!isAgentModelConfig(answer)) throw new Error("the backend's answer was malformed");
        setShown({ agent: entry.id, config: answer });
        show(params.model !== undefined ? modelSavedText(answer.model) : effortSavedText(answer.effort ?? ""), null);
      } catch (err) {
        const failed = changeFailedText(params.model !== undefined ? "model" : "effort", err);
        show(failed.text, null, failed.reason);
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <>
      <Section title="Model" testId="agent-model">
        {config === null ? (
          <div className={styles.block}>
            <p className={styles.none} data-testid="model-loading">
              {read.status === "refused" ? `This agent’s config cannot be read: ${read.reason}` : "Reading the config…"}
            </p>
          </div>
        ) : config.provider === "codex" ? (
          <CodexModel context={context} config={config} />
        ) : (
          <ClaudeModel context={context} config={config} busy={busy} onSet={setModel} />
        )}
      </Section>
      <Modes context={context} host={host} />
    </>
  );
}
