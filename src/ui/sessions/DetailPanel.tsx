// The detail panel (DESIGN §2.7 "List with the detail panel"): one session's name — renamed in
// place — its live state and since when (Closed: when it was last active), Rename and Move to project, its marker notes, its status as four buttons with the one-line note under them, the
// facts, and its first message, last message and last agent answer. A refused change says so
// under the note.

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { SESSION_STATUSES, type SessionStatus } from "pomade-kit/protocol";

import { CaretIcon, CloseIcon, FolderIcon, ForkIcon, InfoIcon, MoveIcon, PencilIcon, TimerIcon, WarningIcon } from "../core/icons.tsx";
import { LiveMark } from "../core/LiveMark.tsx";
import { SESSION_NAME_MAX, SESSION_NOTE_MAX, type Session } from "../../shared/sessions.ts";
import { ClampedText } from "./ClampedText.tsx";
import {
  CLAMP_LINES,
  PROVIDER_LABELS,
  detailName,
  liveLine,
  markerNotes,
  noteToSave,
  sameMessage,
  startedIn,
  type MarkerNote,
} from "./detail-model.ts";
import { StatusMark } from "./StatusGroup.tsx";
import { STATUS_LABELS, STATUS_SHORT_LABELS, formatMoney, formatStamp, liveTitle, projectLabel, statusOf } from "./table-model.ts";
import type { Failure } from "./useStatusChange.ts";
import { ContextMeter, Unknown } from "./Values.tsx";
import styles from "./DetailPanel.module.css";

export interface DetailPanelProps {
  session: Session;
  now: Date;
  /** Project names by id. */
  names: ReadonlyMap<string, string>;
  /** The workspace's root with symlinks resolved and as Pomade names it; empty while not known. */
  workspaceRoots: readonly string[];
  /** Every session the UI holds, by id: a fork's parent may be outside the scope. */
  byId: ReadonlyMap<string, Session>;
  /** True for a session this tab lists. */
  inTab: (id: string) => boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
  /** Set the session's status (a toast with Undo follows). */
  onSetStatus: (session: string, status: SessionStatus) => void;
  /** Save the session's note — `null` removes it; resolves `false` when it was refused. */
  saveNote: (session: string, note: string | null) => Promise<boolean>;
  failure: Failure | null;
  /** The note field's text while it is typed in; `null` once it is saved or left. */
  onDraftNote: (session: string, text: string | null) => void;
  /** The name shows as a field, focused. */
  renaming: boolean;
  onStartRename: () => void;
  /** The name field was left with `text` in it (Enter, or focus moved away). */
  onSaveName: (text: string) => void;
  /** The name field was left with Esc: nothing is saved. */
  onCancelRename: () => void;
  /** Move to project is open under the panel's button. */
  moveOpen: boolean;
  /** Open Move to project under the panel's button now (the row menu asked for it). */
  askMove: boolean;
  /** Open Move to project under `anchor`, the button's box. */
  onOpenMove: (anchor: DOMRect) => void;
}

function LiveLine({ session, now }: { session: Session; now: Date }): ReactElement {
  const line = liveLine(session, now);
  const title = liveTitle(session, now);
  return (
    <p className={styles.sub} data-testid="detail-live" data-state={session.live}>
      {title !== null && <LiveMark state={session.live} title={title} />}
      <span className={styles.liveWord} data-state={session.live}>
        {line.state}
      </span>
      {line.when !== "" && <span>· {line.when}</span>}
    </p>
  );
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
                Shared folder: {note.projects} have the same root, and no Pomade tab launched this session, so it shows in each. Move to project pins it to one.
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

function NameField({ session, onSaveName, onCancelRename }: Pick<DetailPanelProps, "session" | "onSaveName" | "onCancelRename">): ReactElement {
  const field = useRef<HTMLInputElement>(null);
  const leaving = useRef<"save" | "revert">("save");

  useLayoutEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      leaving.current = "revert";
      event.currentTarget.blur();
    }
  };

  return (
    <input
      ref={field}
      className={styles.nameInput}
      type="text"
      defaultValue={session.record?.name ?? ""}
      placeholder="Session name — also the tab’s name"
      aria-label="Session name"
      title="Saved on Enter or when you leave the field; Esc keeps the name; an empty field makes the session unnamed"
      maxLength={SESSION_NAME_MAX}
      spellCheck={false}
      data-testid="name-input"
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        if (leaving.current === "revert") onCancelRename();
        else onSaveName(event.currentTarget.value);
      }}
    />
  );
}

function Actions({ moveOpen, askMove, onStartRename, onOpenMove }: Pick<DetailPanelProps, "moveOpen" | "askMove" | "onStartRename" | "onOpenMove">): ReactElement {
  const moveButton = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const button = moveButton.current;
    if (askMove && button !== null) onOpenMove(button.getBoundingClientRect());
  }, [askMove, onOpenMove]);

  return (
    <div className={styles.actions}>
      <button type="button" className={styles.action} title="Rename the session — its tab takes the name (F2)" data-testid="detail-rename" onClick={onStartRename}>
        <PencilIcon />
        Rename
      </button>
      <button
        ref={moveButton}
        type="button"
        className={styles.action}
        aria-haspopup="menu"
        aria-expanded={moveOpen}
        title="Show the session in another project, over the folder it started in"
        data-testid="detail-move"
        onClick={(event) => onOpenMove(event.currentTarget.getBoundingClientRect())}
      >
        <MoveIcon />
        Move to project
        <CaretIcon />
      </button>
    </div>
  );
}

function NoteField({ session, saveNote, onDraftNote }: Pick<DetailPanelProps, "session" | "saveNote" | "onDraftNote">): ReactElement {
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
    const ok = await saveNote(session.id, note);
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

function StatusButtons({ session, onSetStatus }: Pick<DetailPanelProps, "session" | "onSetStatus">): ReactElement {
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
            if (status !== current) onSetStatus(session.id, status);
          }}
        >
          <StatusMark status={status} />
          <span className={styles.segmentLabel}>{STATUS_SHORT_LABELS[status]}</span>
        </button>
      ))}
    </div>
  );
}

function Facts({ session, now, names, workspaceRoots }: Pick<DetailPanelProps, "session" | "now" | "names" | "workspaceRoots">): ReactElement {
  const { summary } = session;
  const folder = startedIn(session, workspaceRoots);
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
          {props.renaming ? (
            <NameField session={session} onSaveName={props.onSaveName} onCancelRename={props.onCancelRename} />
          ) : (
            <h2 className={styles.name} data-unnamed={name.unnamed ? "" : undefined} title="Click to rename (F2)" data-testid="detail-name" onClick={props.onStartRename}>
              {name.text}
            </h2>
          )}
          <button type="button" className={styles.close} title="Close (Esc)" aria-label="Close the details" data-testid="detail-close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <LiveLine session={session} now={now} />
        <Actions moveOpen={props.moveOpen} askMove={props.askMove} onStartRename={props.onStartRename} onOpenMove={props.onOpenMove} />
        <MarkerNotes notes={notes} onSelect={onSelect} />
        <section className={styles.section}>
          <h3 className={styles.label}>Status</h3>
          <StatusButtons session={session} onSetStatus={props.onSetStatus} />
          <NoteField session={session} saveNote={props.saveNote} onDraftNote={props.onDraftNote} />
          {failure !== null && failure.sessions.includes(session.id) && (
            <p className={styles.failure} role="alert" title={failure.reason} data-testid="change-failure">
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
