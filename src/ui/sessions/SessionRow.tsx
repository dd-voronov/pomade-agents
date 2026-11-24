// One session in the Sessions table: a 28 px line of columns, and its note under it. Clicking it
// selects the session; the row selected before the detail panel closed is marked, as where ↑ ↓
// go on from. Its checkbox sits before the name, under the group header's chevron, and its live
// mark between them, under the status mark; ⋯ at the end
// opens its menu. Both show on hover; the checkbox also while any row is checked. The row drags
// onto a group header.

import type { ReactElement } from "react";

import { MoreIcon, NoteIcon } from "../core/icons.tsx";
import { LiveMark } from "../core/LiveMark.tsx";
import type { Session } from "../../shared/sessions.ts";
import { Checkbox } from "./Checkbox.tsx";
import type { RowEvents, RowMarks } from "./row-events.ts";
import { SessionName } from "./SessionName.tsx";
import { formatAgo, formatMoney, formatStamp, liveTitle, projectLabel, statusOf, type Columns } from "./table-model.ts";
import { ContextMeter, Unknown } from "./Values.tsx";
import styles from "./SessionRow.module.css";

export interface SessionRowProps {
  session: Session;
  columns: Columns;
  /** Project names by id. */
  names: ReadonlyMap<string, string>;
  /** The fork mark's tooltip; `null`: no fork. */
  fork: string | null;
  now: Date;
  /** The row selected before the detail panel closed. */
  lastSelected: boolean;
  marks: RowMarks;
  events: RowEvents;
}

export function SessionRow({ session, columns, names, fork, now, lastSelected, marks, events }: SessionRowProps): ReactElement {
  const { summary } = session;
  const note = session.record?.note;
  const project = columns.project ? projectLabel(session, names) : "";
  const model = summary.model;
  const live = liveTitle(session, now);
  return (
    <div
      className={styles.row}
      data-testid="session-row"
      data-session-id={session.id}
      data-status={statusOf(session)}
      data-last-selected={lastSelected ? "" : undefined}
      data-checked={marks.checked ? "" : undefined}
      data-menu={marks.menu ? "" : undefined}
      draggable
      onClick={(event) => events.onClick(session.id, event)}
      // Shift+click checks a range: no text selection along with it.
      onMouseDown={(event) => {
        if (event.shiftKey) event.preventDefault();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        events.onMenu(session.id, { x: event.clientX, y: event.clientY });
      }}
      onDragStart={(event) => events.onDragStart(session.id, event)}
      onDragEnd={events.onDragEnd}
    >
      <div className={styles.line}>
        <div className={`${styles.cell} ${styles.name}`} data-testid="cell-name">
          <Checkbox className={styles.check} checked={marks.checked} label="Check the session" testId="row-check" onToggle={(event) => events.onCheck(session.id, event)} />
          {live !== null && <span className={styles.live}><LiveMark state={session.live} title={live} /></span>}
          <SessionName session={session} names={names} fork={fork} />
        </div>
        {columns.project && (
          <div className={`${styles.cell} ${styles.muted}`} title={project} data-testid="cell-project">
            {project}
          </div>
        )}
        {columns.agent && (
          <div className={styles.cell} title={summary.agent} data-testid="cell-agent">
            {summary.agent}
          </div>
        )}
        {columns.model && (
          <div className={`${styles.cell} ${styles.muted}`} title={[model, summary.effort].filter(Boolean).join(" · ")} data-testid="cell-model">
            {model ?? <Unknown session={session} />}
            {columns.effort && model !== null && summary.effort !== null && <span className={styles.effort}> · {summary.effort}</span>}
          </div>
        )}
        {columns.context && (
          <div className={`${styles.cell} ${styles.contextCell}`} data-testid="cell-context">
            <ContextMeter session={session} />
          </div>
        )}
        {columns.cost && (
          <div className={`${styles.cell} ${styles.number}`} data-testid="cell-cost">
            {summary.costUsd === null ? <Unknown session={session} /> : formatMoney(summary.costUsd)}
          </div>
        )}
        <div className={`${styles.cell} ${styles.number} ${styles.muted}`} title={formatStamp(summary.lastActiveAt, now)} data-testid="cell-last">
          {formatAgo(summary.lastActiveAt, now)}
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.more}
            title="More"
            aria-label="The session's menu"
            aria-haspopup="menu"
            aria-expanded={marks.menu}
            tabIndex={-1}
            draggable={false}
            data-testid="row-more"
            onClick={(event) => {
              event.stopPropagation();
              events.onMenu(session.id, event.currentTarget.getBoundingClientRect());
            }}
          >
            <MoreIcon />
          </button>
        </div>
      </div>
      {note !== undefined && (
        <div className={styles.note} data-testid="session-note">
          <NoteIcon size={12} />
          <span title={note}>{note}</span>
        </div>
      )}
    </div>
  );
}
