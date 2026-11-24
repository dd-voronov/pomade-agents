// The New agent page, route `roster/new` (DESIGN §3.6; the agreed layout is
// `prototypes/roster/`'s): the form with "Create will" beside it, then the Create in place — its
// steps ticking — and where it ends: done, the alias to fix with Check again, or nothing kept.

import { useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import type { HostClient } from "pomade-kit/sdk";

import type { CreateStep } from "../../../shared/roster.ts";
import { copyText } from "../../core/clipboard.ts";
import { CheckIcon, CloseIcon, WarningIcon } from "../../core/icons.tsx";
import { ROSTER_ROUTE, agentRoute } from "../../core/routes.ts";
import { BackGlyph, CopyGlyph, SpinnerGlyph } from "./glyphs.tsx";
import {
  RC_FILE_LABEL,
  TEMPLATE_PATH,
  addTags,
  aliasFailed,
  createWill,
  nameMessage,
  pageTitle,
  stepLabel,
  type Part,
} from "./new-agent-model.ts";
import styles from "./NewAgentPage.module.css";
import { useConnectable, useCreateAgent, useNameCheck, type Connectable } from "./useNewAgent.ts";

/** Where a new agent starts from, by id. The template is the one choice now; cloning an agent
 *  joins it as a second option, with its source picker under the control. */
const START_FROM: readonly { id: string; label: string }[] = [{ id: "template", label: "Blank template" }];

const ROLE_MAX = 140;
const TAG_MAX = 24;

function Parts({ parts }: { parts: readonly Part[] }): ReactElement {
  return (
    <>
      {parts.map((part, i) => (typeof part === "string" ? <span key={i}>{part}</span> : <code key={i}>{part.code}</code>))}
    </>
  );
}

/** Copy `text`; the button shows a tick for a moment. */
function CopyButton({ text, testId }: { text: string; testId: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    await copyText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button type="button" className={styles.iconButton} title={copied ? "Copied" : "Copy"} aria-label={copied ? "Copied" : "Copy"} data-testid={testId} onClick={() => void copy()}>
      {copied ? <CheckIcon size={14} /> : <CopyGlyph />}
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
  navigate: (route: string) => void;
}

export function NewAgentPage({ host, navigate }: Props): ReactElement {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [startFrom, setStartFrom] = useState("template");
  const [tried, setTried] = useState(false);
  const { state: nameState, refuse } = useNameCheck(host, name);
  const connectable = useConnectable(host);
  const { state: run, create, checkAgain, edit } = useCreateAgent(host);

  const projects = connectable?.projects ?? [];
  /** The checked projects, in sidebar order. */
  const checked = projects.filter((p) => chosen.includes(p.id));
  const checkedNames = checked.map((p) => p.name);
  const roleOk = role.trim() !== "";
  const nameOk = nameState.status === "ok" || nameState.status === "checking";
  const formOk = nameOk && roleOk;
  const shownName = run.result?.name ?? name;

  const submit = async (): Promise<void> => {
    setTried(true);
    if (!formOk) {
      // The fields turn red on the next render: focus the first of them then.
      setTimeout(() => document.querySelector<HTMLElement>('input[aria-invalid="true"]')?.focus(), 0);
      return;
    }
    const allTags = addTags(tags, tagDraft);
    setTags(allTags);
    setTagDraft("");
    const result = await create({ name, role: role.trim(), tags: allTags, projects: checked.map((p) => p.id) });
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
      setTags(addTags(tags, tagDraft));
      setTagDraft("");
    } else if (event.key === "Backspace" && tagDraft === "" && tags.length > 0) {
      setTags(tags.slice(0, -1));
    } else if (event.key === "Enter") {
      event.preventDefault();
    }
  };

  const message = nameMessage(nameState, tried);
  const nameInvalid = nameState.status === "bad" || (tried && nameState.status === "empty");
  const roleInvalid = tried && !roleOk;

  const form = (
    <>
      <div className={styles.grid}>
        <div className={styles.main}>
          <Field label="Start from">
            <div className={styles.seg} role="group" aria-label="Start from" data-testid="new-agent-start-from">
              {START_FROM.map((option) => (
                <button key={option.id} type="button" aria-pressed={startFrom === option.id} onClick={() => setStartFrom(option.id)}>
                  {option.label}
                </button>
              ))}
            </div>
            <div className={styles.hint}>
              From <code>{TEMPLATE_PATH}</code>: a blank <code>CLAUDE.md</code> its first session fills in.
            </div>
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
              onChange={(e) => setRole(e.target.value)}
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
                  <button type="button" className={styles.tagRemove} title={`Remove ${tag}`} aria-label={`Remove ${tag}`} onClick={() => setTags(tags.filter((t) => t !== tag))}>
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
                data-testid="new-agent-tag"
                onChange={(e) => setTagDraft(e.target.value.replace(/,/g, ""))}
                onKeyDown={onTagKey}
                onBlur={() => {
                  if (tagDraft.trim() !== "") {
                    setTags(addTags(tags, tagDraft));
                    setTagDraft("");
                  }
                }}
              />
            </div>
            <div className={styles.hint}>Enter or comma adds a tag.</div>
          </Field>
          <Field label="Connect to projects">
            <ProjectList connectable={connectable} chosen={chosen} onToggle={(id) => setChosen(chosen.includes(id) ? chosen.filter((c) => c !== id) : [...chosen, id])} />
          </Field>
        </div>
        <aside className={styles.side} aria-label="Create will" data-testid="new-agent-create-will">
          <div className={styles.label}>Create will</div>
          <ol className={styles.willSteps}>
            {createWill(name, checkedNames).map((item, i) => (
              <li key={i} className={item.faint === true ? styles.faint : undefined}>
                <Parts parts={item.parts} />
              </li>
            ))}
          </ol>
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
          <h1>{pageTitle(run.phase, shownName)}</h1>
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
  const { name, steps, projectNames, phase, aliasLine, navigate } = props;
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
          <StepRow key={step.id} step={step} label={stepLabel(step.id, name, projectNames)} />
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
            Everything else is created. Add this line to <code>{props.rcFile ?? RC_FILE_LABEL}</code> (something later in the file may override it), then check again:
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
          <p>
            It’s on the Roster and in the “+” menu. It starts logged out: its first session asks for <code>/login</code>.
          </p>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} data-testid="new-agent-open-page" onClick={() => navigate(agentRoute(name))}>
              Open its page
            </button>
            {back}
          </div>
        </div>
      ) : null}
    </>
  );
}
