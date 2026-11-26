// The New agent page, route `roster/new` — `roster/new?clone=<id>` starts it as a clone of that
// agent (ARCHITECTURE §3.6): the form with "Create will"
// beside it, then the Create in place — its steps ticking — and where it ends: done, with the new
// agent's tab open and its setup prompt to copy; the alias to fix with Check again; or nothing kept.

import { useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { WORKSPACE_PROJECT_ID } from "pomade-kit/protocol";
import type { HostClient } from "pomade-kit/sdk";

import { ROLE_MAX, TAGS_MAX, TAG_MAX, type CreateStep } from "../../../shared/roster.ts";
import { copyText } from "../../core/clipboard.ts";
import { CaretIcon, CheckIcon, CloseIcon, TerminalIcon, WarningIcon } from "../../core/icons.tsx";
import { Menu, type MenuAnchor, type MenuEntry } from "../../core/Menu.tsx";
import { ROSTER_ROUTE, agentRoute } from "../../core/routes.ts";
import { tagsFull, withTags } from "../profile-edit/profile-edit-model.ts";
import { useRoster } from "../useRoster.ts";
import { setupPrompt } from "../needs-login.ts";
import { BackGlyph, CopyGlyph, SpinnerGlyph } from "./glyphs.tsx";
import {
  NEVER_CLONED,
  RC_FILE_LABEL,
  TEMPLATE_PATH,
  UNTOUCHED,
  WORKSPACE_LABEL,
  aliasFailed,
  clonePrefill,
  cloneable,
  createWill,
  nameMessage,
  openInLabel,
  pageTitle,
  stepLabel,
  takePrefill,
  type Part,
  type StartFrom,
  type Touched,
} from "./new-agent-model.ts";
import styles from "./NewAgentPage.module.css";
import { useConnectable, useCreateAgent, useNameCheck, type Connectable } from "./useNewAgent.ts";

/** The Start from choices, in order. */
const START_FROM: readonly { kind: StartFrom["kind"]; label: string }[] = [
  { kind: "template", label: "Blank template" },
  { kind: "clone", label: "Clone an agent" },
];

function Parts({ parts }: { parts: readonly Part[] }): ReactElement {
  return (
    <>
      {parts.map((part, i) => (typeof part === "string" ? <span key={i}>{part}</span> : <code key={i}>{part.code}</code>))}
    </>
  );
}

/** Copy `text`; the button shows a tick for a moment. `label` shows the word beside the glyph. */
function CopyButton({ text, testId, label = false }: { text: string; testId: string; label?: boolean }): ReactElement {
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    await copyText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const glyph = copied ? <CheckIcon size={14} /> : <CopyGlyph />;
  return label ? (
    <button type="button" className={`${styles.button} ${styles.small}`} data-testid={testId} onClick={() => void copy()}>
      {glyph}
      {copied ? "Copied" : "Copy"}
    </button>
  ) : (
    <button type="button" className={styles.iconButton} title={copied ? "Copied" : "Copy"} aria-label={copied ? "Copied" : "Copy"} data-testid={testId} onClick={() => void copy()}>
      {glyph}
    </button>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }): ReactElement {
  return (
    <div className={styles.field}>
      {htmlFor === undefined ? <div className={styles.label}>{label}</div> : (
        <label className={styles.label} htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {children}
    </div>
  );
}

interface Props {
  host: HostClient;
  /** The agent the page starts as a clone of; `null` for the blank template. */
  clone: string | null;
  navigate: (route: string) => void;
}

export function NewAgentPage({ host, clone, navigate }: Props): ReactElement {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [startFrom, setStartFrom] = useState<StartFrom>(clone === null ? { kind: "template" } : { kind: "clone", source: clone });
  /** The source whose role, tags and projects the form took. */
  const [prefilled, setPrefilled] = useState<string | null>(null);
  /** What the user changed: a source's values replace only the rest. */
  const [touched, setTouched] = useState<Touched>(UNTOUCHED);
  const [sourceMenu, setSourceMenu] = useState<MenuAnchor | null>(null);
  const sourceButton = useRef<HTMLButtonElement>(null);
  const [tried, setTried] = useState(false);
  const { state: nameState, refuse } = useNameCheck(host, name);
  const connectable = useConnectable(host);
  const { answer: roster } = useRoster(host);
  const { state: run, create, checkAgain, goToTab, edit } = useCreateAgent(host);

  const projects = connectable?.projects ?? [];
  const sources = roster === null ? [] : cloneable(roster.agents);
  const source = startFrom.kind === "clone" ? startFrom.source : null;
  const sourceEntry = source === null ? undefined : sources.find((a) => a.id === source);
  // A clone takes its source's role, tags and projects once both are known — those the user has not
  // typed or picked — and the user changes them freely after.
  if (sourceEntry !== undefined && source !== prefilled && connectable !== null) {
    const taken = takePrefill({ role, tags, projects: chosen }, touched, clonePrefill(sourceEntry, connectable.projects));
    setPrefilled(source);
    setRole(taken.role);
    setTags(taken.tags);
    setChosen(taken.projects);
  }
  const editTags = (next: readonly string[]): void => {
    setTags([...next]);
    setTouched((t) => ({ ...t, tags: true }));
  };
  /** The checked projects, in sidebar order. */
  const checked = projects.filter((p) => chosen.includes(p.id));
  const checkedNames = checked.map((p) => p.name);
  const roleOk = role.trim() !== "";
  const nameOk = nameState.status === "ok" || nameState.status === "checking";
  const sourceOk = startFrom.kind === "template" || sourceEntry !== undefined;
  const formOk = nameOk && roleOk && sourceOk;
  const shownName = run.result?.name ?? name;
  /** The project the Create chose for the first tab, by name. */
  const openIn = run.result === null ? openInLabel(checkedNames) : run.result.openIn === WORKSPACE_PROJECT_ID ? WORKSPACE_LABEL : (projects.find((p) => p.id === run.result?.openIn)?.name ?? run.result.openIn);

  const submit = async (): Promise<void> => {
    setTried(true);
    if (!formOk) {
      // The fields turn red on the next render: focus the first of them then.
      setTimeout(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0);
      return;
    }
    const allTags = [...withTags(tags, tagDraft)];
    setTags(allTags);
    setTagDraft("");
    const result = await create({ name, role: role.trim(), tags: allTags, projects: checked.map((p) => p.id), ...(source === null ? {} : { clone: source }) });
    if (result?.outcome === "refused" && result.refused !== null) {
      refuse(result.refused);
      edit();
    }
  };

  const onFieldKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      void submit();
    }
  };
  const onTagKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if ((event.key === "Enter" || event.key === ",") && tagDraft.trim() !== "") {
      event.preventDefault();
      editTags(withTags(tags, tagDraft));
      setTagDraft("");
    } else if (event.key === "Backspace" && tagDraft === "" && tags.length > 0) {
      editTags(tags.slice(0, -1));
    } else if (event.key === "Enter") {
      event.preventDefault();
    }
  };

  const sourceEntries: MenuEntry[] =
    sources.length === 0
      ? [{ kind: "item", id: "clone-source-none", label: "No folder agent to clone", disabled: { why: "Only Claude Code folder agents are cloned" }, run: () => undefined }]
      : sources.map((a) => ({
          kind: "item",
          id: `clone-source-${a.id}`,
          label: a.id,
          ...(a.profile?.role === undefined ? {} : { detail: a.profile.role }),
          checked: a.id === source,
          run: () => setStartFrom({ kind: "clone", source: a.id }),
        }));
  const sourceInvalid = tried && startFrom.kind === "clone" && sourceEntry === undefined;
  const message = nameMessage(nameState, tried);
  const nameInvalid = nameState.status === "bad" || (tried && nameState.status === "empty");
  const roleInvalid = tried && !roleOk;
  const full = tagsFull(tags);

  const form = (
    <>
      <div className={styles.grid}>
        <div className={styles.main}>
          <Field label="Start from">
            <div className={styles.seg} role="group" aria-label="Start from" data-testid="new-agent-start-from">
              {START_FROM.map((option) => (
                <button
                  key={option.kind}
                  type="button"
                  aria-pressed={startFrom.kind === option.kind}
                  data-testid={`new-agent-from-${option.kind}`}
                  onClick={() => startFrom.kind !== option.kind && setStartFrom(option.kind === "template" ? { kind: "template" } : { kind: "clone", source: null })}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {startFrom.kind === "clone" ? (
              <div className={styles.clone}>
                <button
                  ref={sourceButton}
                  type="button"
                  className={`${styles.button} ${styles.select}`}
                  aria-haspopup="menu"
                  aria-expanded={sourceMenu !== null}
                  aria-invalid={sourceInvalid}
                  data-testid="new-agent-clone-source"
                  onClick={() => setSourceMenu(sourceButton.current?.getBoundingClientRect() ?? { x: 0, y: 0 })}
                >
                  <span className={styles.selectText}>{source ?? "Pick an agent"}</span>
                  <CaretIcon size={12} />
                </button>
                <span className={sourceInvalid ? styles.error : styles.hint} data-testid="new-agent-clone-hint">
                  {sourceEntry !== undefined
                    ? `Role, tags and projects are prefilled from ${sourceEntry.id}; change them freely.`
                    : sourceInvalid
                      ? source === null
                        ? "Pick the agent to clone."
                        : `${source} is not a folder agent that can be cloned.`
                      : `${sources.length === 1 ? "1 folder agent" : `${sources.length} folder agents`} can be cloned.`}
                </span>
              </div>
            ) : (
              <div className={styles.hint}>
                From <code>{TEMPLATE_PATH}</code>: a blank <code>CLAUDE.md</code> its first session fills in.
              </div>
            )}
            {sourceMenu !== null && <Menu entries={sourceEntries} anchor={sourceMenu} onClose={() => setSourceMenu(null)} label="Agent to clone" testId="new-agent-clone-menu" />}
          </Field>
          <Field label="Name" htmlFor="new-agent-name">
            <div className={styles.inputWrap}>
              <input
                id="new-agent-name"
                className={`${styles.input} ${styles.mono}`}
                data-state={nameState.status === "ok" ? "valid" : undefined}
                aria-invalid={nameInvalid}
                value={name}
                placeholder="claude-tax-advisor"
                autoComplete="off"
                spellCheck={false}
                // The page opens to name the agent.
                autoFocus
                data-testid="new-agent-name"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={onFieldKey}
              />
              {nameState.status === "checking" ? (
                <span className={`${styles.adorn} ${styles.spin}`} data-testid="new-agent-name-checking">
                  <SpinnerGlyph />
                </span>
              ) : nameState.status === "ok" ? (
                <span className={`${styles.adorn} ${styles.ok}`}>
                  <CheckIcon size={14} />
                </span>
              ) : null}
            </div>
            <div className={message.tone === "error" ? styles.error : styles.hint} data-testid="new-agent-name-message" data-state={nameState.status} data-problem={nameState.status === "bad" ? nameState.verdict.problem : undefined}>
              <Parts parts={message.parts} />
            </div>
          </Field>
          <Field label="Provider">
            <div className={styles.seg} role="group" aria-label="Provider">
              <button type="button" aria-pressed="true">
                Claude Code
              </button>
              <button type="button" disabled title="Codex-based agents come later">
                Codex
              </button>
            </div>
          </Field>
          <Field label="Role line" htmlFor="new-agent-role">
            <input
              id="new-agent-role"
              className={styles.input}
              aria-invalid={roleInvalid}
              value={role}
              placeholder="Prepares the Spanish tax return and tracks its deadlines."
              maxLength={ROLE_MAX}
              data-testid="new-agent-role"
              onChange={(e) => {
                setRole(e.target.value);
                setTouched((t) => ({ ...t, role: true }));
              }}
              onKeyDown={onFieldKey}
            />
            <div className={roleInvalid ? styles.error : styles.hint}>{roleInvalid ? "One line on what it is for — the card and the setup prompt use it." : "One line: what it is for."}</div>
          </Field>
          <Field label="Tags" htmlFor="new-agent-tag">
            {/* A click anywhere in the box types a tag; the input inside is the keyboard's way in. */}
            <div className={styles.tags} onClick={() => document.getElementById("new-agent-tag")?.focus()}>
              {tags.map((tag) => (
                <span key={tag} className={styles.tag} data-testid="new-agent-tag-chip">
                  {tag}
                  <button type="button" className={styles.tagRemove} title={`Remove ${tag}`} aria-label={`Remove ${tag}`} onClick={() => editTags(tags.filter((t) => t !== tag))}>
                    <CloseIcon size={12} />
                  </button>
                </span>
              ))}
              <input
                id="new-agent-tag"
                className={styles.tagInput}
                value={tagDraft}
                placeholder={tags.length === 0 ? "tax, personal" : ""}
                maxLength={TAG_MAX}
                disabled={full}
                data-testid="new-agent-tag"
                onChange={(e) => setTagDraft(e.target.value.replace(/,/g, ""))}
                onKeyDown={onTagKey}
                onBlur={() => {
                  if (tagDraft.trim() !== "") {
                    editTags(withTags(tags, tagDraft));
                    setTagDraft("");
                  }
                }}
              />
            </div>
            <div className={styles.hint} data-testid="new-agent-tags-hint">{full ? `${TAGS_MAX} tags are the most: remove one to add another.` : "Enter or comma adds a tag."}</div>
          </Field>
          <Field label="Connect to projects">
            <ProjectList connectable={connectable} chosen={chosen} onToggle={(id) => {
              setChosen(chosen.includes(id) ? chosen.filter((c) => c !== id) : [...chosen, id]);
              setTouched((t) => ({ ...t, projects: true }));
            }} />
          </Field>
        </div>
        <aside className={styles.side} aria-label="Create will" data-testid="new-agent-create-will">
          <div className={styles.label}>Create will</div>
          <ol className={styles.willSteps}>
            {createWill(name, checkedNames, startFrom).map((item, i) => (
              <li key={i} className={item.faint === true ? styles.faint : undefined}>
                <Parts parts={item.parts} />
              </li>
            ))}
          </ol>
          {sourceEntry === undefined ? null : (
            <p className={styles.never} data-testid="new-agent-never-cloned">
              <Parts parts={NEVER_CLONED} />
            </p>
          )}
        </aside>
      </div>
      <div className={styles.foot}>
        <button type="button" className={styles.primary} aria-disabled={tried && !formOk} data-testid="new-agent-create" onClick={() => void submit()}>
          Create agent
        </button>
        <button type="button" className={styles.button} onClick={() => navigate(ROSTER_ROUTE)}>
          Cancel
        </button>
        {tried && !formOk ? <span className={styles.error}>Fix the fields marked red.</span> : null}
      </div>
    </>
  );

  return (
    <div className={styles.page} data-testid="new-agent" data-phase={run.phase}>
      <header className={styles.head}>
        <button type="button" className={styles.crumb} data-testid="new-agent-back" onClick={() => navigate(ROSTER_ROUTE)}>
          <BackGlyph />
          Roster
        </button>
        <div className={styles.title}>
          <h1>{pageTitle(run.phase, shownName, sourceEntry?.id ?? null)}</h1>
        </div>
      </header>
      <div className={styles.body}>
        <div className={styles.content}>
          {run.phase === "edit" ? (
            form
          ) : (
            <Progress
              name={shownName}
              steps={run.steps}
              projectNames={checkedNames}
              clone={source}
              openIn={openIn}
              prompt={setupPrompt(shownName, role, tags)}
              tabId={run.tabId}
              tabProblem={run.tabProblem}
              onGoToTab={() => void goToTab()}
              phase={run.phase}
              aliasLine={run.result?.aliasLine ?? null}
              rcFile={run.result?.rcFile ?? null}
              lost={run.lost}
              checking={run.checking}
              checkDetail={run.checkDetail}
              onCheckAgain={() => void checkAgain()}
              onEdit={edit}
              navigate={navigate}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ProjectList({ connectable, chosen, onToggle }: { connectable: Connectable | null; chosen: readonly string[]; onToggle: (id: string) => void }): ReactElement {
  if (connectable === null) return <div className={styles.hint}>Reading the projects…</div>;
  const { projects, offerEvery } = connectable;
  const offers = offerEvery.length === 0 ? "" : `${offerEvery.join(", ")} ${offerEvery.length === 1 ? "offers" : "offer"} every agent already.`;
  if (projects.length === 0) return <div className={styles.hint} data-testid="new-agent-projects-none">{offers === "" ? "The workspace has no projects." : `${offers} The new agent is in their “+” menus by itself.`}</div>;
  let group = "";
  return (
    <>
      <div className={styles.projects} data-testid="new-agent-projects">
        {projects.map((p) => {
          const header = p.group !== group && p.group !== "" ? p.group : null;
          group = p.group;
          const on = chosen.includes(p.id);
          return (
            <div key={p.id} className={styles.projectItem}>
              {header === null ? null : <div className={styles.group}>{header}</div>}
              <button type="button" role="checkbox" aria-checked={on} className={styles.projectRow} data-testid={`new-agent-project-${p.id}`} onClick={() => onToggle(p.id)}>
                <span className={styles.box}>{on ? <CheckIcon size={10} stroke={2.2} /> : null}</span>
                <span className={styles.projectName}>{p.name}</span>
                <span className={styles.projectRoot}>{p.root}</span>
              </button>
            </div>
          );
        })}
      </div>
      {offers === "" ? null : <div className={styles.hint}>{offers}</div>}
    </>
  );
}

function StepRow({ step, label }: { step: CreateStep; label: string }): ReactElement {
  const mark = step.state === "done" ? <CheckIcon size={10} stroke={2.2} /> : step.state === "run" ? <SpinnerGlyph /> : step.state === "fail" ? <CloseIcon size={10} /> : null;
  return (
    <li className={styles.step} data-state={step.state} data-testid={`new-agent-step-${step.id}`} title={step.state === "fail" ? undefined : (step.detail ?? undefined)}>
      <span className={styles.stepLine}>
        <span className={styles.mark}>{mark}</span>
        <span className={styles.stepLabel}>{label}</span>
      </span>
      {step.state === "fail" && step.detail !== null ? <span className={styles.stepDetail}>{step.detail}</span> : null}
    </li>
  );
}

interface ProgressProps {
  name: string;
  steps: CreateStep[];
  projectNames: readonly string[];
  /** The clone source; `null` for the template. */
  clone: string | null;
  /** Where the first tab opens, by name. */
  openIn: string;
  /** The setup prompt to paste after `/login`. */
  prompt: string;
  /** The new agent's tab; `null` while none is open. */
  tabId: string | null;
  /** Why Go to its tab found no tab. */
  tabProblem: string | null;
  onGoToTab: () => void;
  phase: "creating" | "done" | "incomplete" | "failed";
  aliasLine: string | null;
  rcFile: string | null;
  lost: string | null;
  checking: boolean;
  checkDetail: string | null;
  onCheckAgain: () => void;
  onEdit: () => void;
  navigate: (route: string) => void;
}

function Progress(props: ProgressProps): ReactElement {
  const { name, steps, projectNames, phase, aliasLine, openIn, navigate } = props;
  const back = (
    <button type="button" className={styles.button} onClick={() => navigate(ROSTER_ROUTE)}>
      Back to Roster
    </button>
  );
  const projectsFailed = steps.some((s) => s.id === "projects" && s.state === "fail");
  return (
    <>
      <ol className={styles.steps} data-testid="new-agent-steps">
        {steps.map((step) => (
          <StepRow key={step.id} step={step} label={stepLabel(step.id, name, projectNames, props.clone, openIn)} />
        ))}
      </ol>
      {phase === "failed" ? (
        <div className={`${styles.notice} ${styles.danger}`} data-testid="new-agent-failed">
          <WarningIcon size={14} />
          <div>
            {props.lost === null ? (
              <b>{name} was not created; nothing of it was kept.</b>
            ) : (
              <>
                <b>No answer from the app ({props.lost}).</b> Look on the Roster for {name} before trying again.
              </>
            )}
            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={props.onEdit}>
                Back to the form
              </button>
              {back}
            </div>
          </div>
        </div>
      ) : null}
      {phase === "incomplete" && projectsFailed ? (
        <div className={`${styles.notice} ${styles.warn}`} data-testid="new-agent-projects-failed">
          <WarningIcon size={14} />
          <div>
            <b>Not every project was connected.</b> Connect them from {name}’s page, Projects.
          </div>
        </div>
      ) : null}
      {phase === "incomplete" && aliasFailed(steps) && aliasLine !== null ? (
        <div className={`${styles.notice} ${styles.danger}`} data-testid="new-agent-alias-failed">
          <WarningIcon size={14} />
          <div className={styles.noticeBody}>
            <b>
              <code>{name}</code> doesn’t resolve in a fresh zsh.
            </b>{" "}
            Everything else is created; its tab opens once it resolves. Add this line to <code>{props.rcFile ?? RC_FILE_LABEL}</code> (something later in the file may override it), then check again:
            <div className={styles.spec}>
              <code className={styles.specLine} data-testid="new-agent-alias-line" title={aliasLine}>
                {aliasLine}
              </code>
              <CopyButton text={aliasLine} testId="new-agent-copy-alias" />
            </div>
            {props.checkDetail === null ? null : (
              <div className={styles.error} data-testid="new-agent-check-detail">
                Still not: {props.checkDetail}.
              </div>
            )}
            <div className={styles.actions}>
              <button type="button" className={styles.primary} disabled={props.checking} data-testid="new-agent-check-again" onClick={props.onCheckAgain}>
                {props.checking ? <SpinnerGlyph className={styles.spinning} /> : null}
                {props.checking ? "Checking…" : "Check again"}
              </button>
              {back}
            </div>
          </div>
        </div>
      ) : null}
      {phase === "done" || (phase === "incomplete" && !aliasFailed(steps)) ? (
        <div className={styles.done} data-testid="new-agent-done">
          <h2>
            <CheckIcon size={14} stroke={2} />
            {name} is ready
          </h2>
          <p data-testid="new-agent-done-text">
            {props.tabId === null ? (
              <>Its tab did not open: Go to its tab opens one. It starts logged out: run </>
            ) : (
              <>
                Its tab is open in <b>{openIn}</b>. It starts logged out: run{" "}
              </>
            )}
            <code>/login</code> there, then paste this prompt so the <code>creating-claude-agent</code> skill writes its identity.
          </p>
          <div className={styles.prompt}>
            <p data-testid="new-agent-setup-prompt">{props.prompt}</p>
            <CopyButton text={props.prompt} testId="new-agent-copy-prompt" label />
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} data-testid="new-agent-go-to-tab" onClick={props.onGoToTab}>
              <TerminalIcon size={14} />
              Go to its tab
            </button>
            <button type="button" className={styles.button} data-testid="new-agent-open-page" onClick={() => navigate(agentRoute(name))}>
              Open its page
            </button>
            {back}
          </div>
          {props.tabProblem === null ? null : (
            <div className={styles.error} data-testid="new-agent-tab-problem">
              No tab to go to: {props.tabProblem}.
            </div>
          )}
        </div>
      ) : null}
    </>
  );
}
