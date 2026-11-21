// The detail panel (DESIGN §2.7 "List with the detail panel"): one session's name and when it was
// last active, its marker notes, its status as four buttons with the one-line note under them, the
// facts, and its first message, last message and last agent answer. A refused change says so
// under the note.

import { useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { SESSION_STATUSES, type ProjectRef, type SessionStatus } from "pomade-kit/protocol";

import { CloseIcon, FolderIcon, ForkIcon, InfoIcon, TimerIcon, WarningIcon } from "../core/icons.tsx";
import { SESSION_NOTE_MAX, type Session } from "../../shared/sessions.ts";
import { ClampedText } from "./ClampedText.tsx";
import {
  CLAMP_LINES,
  PROVIDER_LABELS,
  detailName,
  lastActiveLine,
  markerNotes,
  noteToSave,
  sameMessage,
  startedIn,
  type ChangeKind,
  type MarkerNote,
} from "./detail-model.ts";
import { StatusMark } from "./StatusGroup.tsx";
import { STATUS_LABELS, STATUS_SHORT_LABELS, formatMoney, formatStamp, projectLabel, statusOf } from "./table-model.ts";
import type { Failure } from "./useStatusChange.ts";
import { ContextMeter, Unknown } from "./Values.tsx";
import styles from "./DetailPanel.module.css";

export interface DetailPanelProps {
  session: Session;
  now: Date;
  /** Project names by id. */
  names: ReadonlyMap<string, string>;
  projects: ReadonlyMap<string, ProjectRef>;
  /** The workspace's absolute root; `null` until the backend has said it. */
  workspaceRoot: string | null;
  /** Every session the UI holds, by id: a fork's parent may be outside the scope. */
  byId: ReadonlyMap<string, Session>;
  /** True for a session this tab lists. */
  inTab: (id: string) => boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
  change: (session: string, kind: ChangeKind, status: SessionStatus, note?: string | null) => Promise<boolean>;
  failure: Failure | null;
  /** The note field's text while it is typed in; `null` once it is saved or left. */
  onDraftNote: (session: string, text: string | null) => void;
}

function Note({ icon, children, kind }: { icon: ReactElement; children: ReactNode; kind: MarkerNote["kind"] }): ReactElement {
  return (
    <div className={styles.markerNote} data-testid={`marker-${kind}`}>
      {icon}
      <span>{children}</span>
    </div>
  );
}

function MarkerNotes({ notes, onSelect }: { notes: MarkerNote[]; onSelect: (id: string) => void }): ReactElement {
  return (
    <>
      {notes.map((note) => {
        switch (note.kind) {
          case "runner":
            return (
              <Note key={note.kind} kind={note.kind} icon={<TimerIcon />}>
                Started by Runner job <b>{note.job}</b>, unattended.
              </Note>
            );
          case "fork": {
            const parent = note.parent;
            return (
              <Note key={note.kind} kind={note.kind} icon={<ForkIcon />}>
                Forked from{" "}
                {parent === null ? (
                  note.parentName === null ? "a session this tab does not list" : `“${note.parentName}”`
                ) : (
                  <button type="button" className={styles.link} onClick={() => onSelect(parent)} data-testid="fork-parent">
                    {note.parentName}
                  </button>
                )}
                .
              </Note>
            );
          }
          case "shared-folder":
            return (
              <Note key={note.kind} kind={note.kind} icon={<FolderIcon />}>
                Shared folder: {note.projects} have the same root, and no Pomade tab launched this session, so it shows in each.
              </Note>
            );
          case "outside-pomade":
            return (
              <Note key={note.kind} kind={note.kind} icon={<InfoIcon />}>
                Started outside Pomade. No tab is bound to it, so its live state is always Closed.
              </Note>
            );
        }
      })}
    </>
  );
}

function NoteField({ session, change, onDraftNote }: Pick<DetailPanelProps, "session" | "change" | "onDraftNote">): ReactElement {
  const saved = session.record?.note;
  /** What the field holds while it differs from the saved note; `null`: it shows the saved note. */
  const [draft, setDraft] = useState<string | null>(null);
  const leaving = useRef<"save" | "revert">("save");

  const save = async (text: string): Promise<void> => {
    const note = noteToSave(text, saved);
    if (note === undefined) {
      setDraft(null);
      onDraftNote(session.id, null);
      return;
    }
    const ok = await change(session.id, "note", statusOf(session), note);
    // A refused note stays in the field to try again; the row goes back to the saved note.
    if (ok) setDraft(null);
    onDraftNote(session.id, null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      leaving.current = "revert";
      event.currentTarget.blur();
    }
  };

  return (
    <input
      className={styles.noteInput}
      type="text"
      value={draft ?? saved ?? ""}
      placeholder="Add a one-line note…"
      aria-label="Status note"
      title="Saved on Enter or when you leave the field; an empty field removes the note"
      maxLength={SESSION_NOTE_MAX}
      spellCheck={false}
      data-testid="note-input"
      onChange={(event) => {
        setDraft(event.target.value);
        onDraftNote(session.id, event.target.value);
      }}
      onKeyDown={onKeyDown}
      onBlur={() => {
        if (leaving.current === "revert") {
          leaving.current = "save";
          setDraft(null);
          onDraftNote(session.id, null);
          return;
        }
        if (draft !== null) void save(draft);
      }}
    />
  );
}

function StatusButtons({ session, change }: Pick<DetailPanelProps, "session" | "change">): ReactElement {
  const current = statusOf(session);
  return (
    <div className={styles.segmented} role="group" aria-label="Status" data-testid="status-buttons">
      {SESSION_STATUSES.map((status) => (
        <button
          key={status}
          type="button"
          className={styles.segment}
          aria-pressed={status === current}
          title={status === current ? `${STATUS_LABELS[status]} — the session's status` : `Set the status to ${STATUS_LABELS[status]}`}
          data-testid={`status-${status}`}
          onClick={() => {
            if (status !== current) void change(session.id, "status", status);
          }}
        >
          <StatusMark status={status} />
          <span className={styles.segmentLabel}>{STATUS_SHORT_LABELS[status]}</span>
        </button>
      ))}
    </div>
  );
}

function Facts({ session, now, names, projects, workspaceRoot }: Pick<DetailPanelProps, "session" | "now" | "names" | "projects" | "workspaceRoot">): ReactElement {
  const { summary } = session;
  const folder = startedIn(session, projects, workspaceRoot);
  const status = statusOf(session);
  return (
    <dl className={styles.facts} data-testid="facts">
      <dt>Project</dt>
      <dd data-testid="fact-project">{projectLabel(session, names)}</dd>
      <dt>Started in</dt>
      <dd data-testid="fact-started-in">
        {folder === null ? (
          <span className={styles.faint}>No folder recorded</span>
        ) : (
          <>
            <code className={styles.code}>{folder.folder}</code>
            {folder.root !== null && <span className={styles.faint}>{folder.root}</span>}
            {folder.branch !== null && <span className={styles.faint}>on {folder.branch}</span>}
          </>
        )}
      </dd>
      <dt>Started</dt>
      <dd data-testid="fact-started">{formatStamp(summary.startedAt, now)}</dd>
      <dt>Last active</dt>
      <dd data-testid="fact-last-active">{formatStamp(summary.lastActiveAt, now)}</dd>
      <dt>Agent</dt>
      <dd data-testid="fact-agent">
        {summary.agent}
        <span className={styles.faint}>{PROVIDER_LABELS[summary.provider]}</span>
      </dd>
      <dt>Model</dt>
      <dd data-testid="fact-model">
        {summary.model === null ? (
          <Unknown session={session} />
        ) : (
          <>
            {summary.model}
            {summary.effort !== null && <span className={styles.faint}>effort {summary.effort}</span>}
          </>
        )}
      </dd>
      <dt>Context</dt>
      <dd data-testid="fact-context">
        <ContextMeter session={session} />
        {summary.context === null && summary.model !== null && <span className={styles.faint}>model not in the price table</span>}
      </dd>
      <dt>~$ est.</dt>
      <dd data-testid="fact-cost">
        {summary.costUsd === null ? <Unknown session={session} /> : formatMoney(summary.costUsd)}
        {status === "done-skip" && summary.costUsd !== null && <span className={styles.faint}>not counted in totals</span>}
      </dd>
    </dl>
  );
}

function Messages({ session }: { session: Session }): ReactElement {
  const { firstMessage, lastMessage, lastAnswer } = session.summary;
  const none = (text: string, testId: string): ReactElement => (
    <p className={styles.none} data-testid={testId}>
      {text}
    </p>
  );
  return (
    <>
      <section className={styles.section}>
        <h3 className={styles.label}>First message</h3>
        {firstMessage === null ? none("No message from you yet.", "first-message") : <ClampedText text={firstMessage.text} lines={CLAMP_LINES.user} from="user" testId="first-message" />}
      </section>
      <section className={styles.section}>
        <h3 className={styles.label}>Last message</h3>
        {sameMessage(firstMessage, lastMessage)
          ? none("Same as the first — the session has one message from you.", "last-message")
          : lastMessage === null
            ? none("No message from you yet.", "last-message")
            : <ClampedText text={lastMessage.text} lines={CLAMP_LINES.user} from="user" testId="last-message" />}
      </section>
      <section className={styles.section}>
        <h3 className={styles.label}>Last agent answer</h3>
        {lastAnswer === null ? none("No answer yet.", "last-answer") : <ClampedText text={lastAnswer.text} lines={CLAMP_LINES.agent} from="agent" testId="last-answer" />}
      </section>
    </>
  );
}

export function DetailPanel(props: DetailPanelProps): ReactElement {
  const { session, now, names, byId, inTab, onSelect, onClose, failure } = props;
  const name = detailName(session);
  const notes = markerNotes(session, byId, names, inTab);
  return (
    <aside className={styles.panel} aria-label="Session details" data-testid="detail-panel" data-session-id={session.id}>
      <div className={styles.inner}>
        <div className={styles.head}>
          <h2 className={styles.name} data-unnamed={name.unnamed ? "" : undefined} data-testid="detail-name">
            {name.text}
          </h2>
          <button type="button" className={styles.close} title="Close (Esc)" aria-label="Close the details" data-testid="detail-close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <p className={styles.sub} data-testid="detail-last-active">
          {lastActiveLine(session.summary.lastActiveAt, now)}
        </p>
        <MarkerNotes notes={notes} onSelect={onSelect} />
        <section className={styles.section}>
          <h3 className={styles.label}>Status</h3>
          <StatusButtons session={session} change={props.change} />
          <NoteField session={session} change={props.change} onDraftNote={props.onDraftNote} />
          {failure !== null && failure.session === session.id && (
            <p className={styles.failure} role="alert" data-testid="change-failure">
              <WarningIcon size={14} />
              <span>{failure.text}</span>
            </p>
          )}
        </section>
        <section className={styles.section}>
          <Facts {...props} />
        </section>
        <Messages session={session} />
      </div>
    </aside>
  );
}
