// One session in the Sessions table: a 28 px line of columns, and its note under it. Clicking it
// selects the session; the row selected before the detail panel closed is marked, as where ↑ ↓
// go on from.

import type { ReactElement } from "react";

import { NoteIcon } from "../core/icons.tsx";
import type { Session } from "../../shared/sessions.ts";
import { SessionName } from "./SessionName.tsx";
import { formatAgo, formatMoney, formatStamp, projectLabel, statusOf, type Columns } from "./table-model.ts";
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
  onSelect: (id: string) => void;
}

export function SessionRow({ session, columns, names, fork, now, lastSelected, onSelect }: SessionRowProps): ReactElement {
  const { summary } = session;
  const note = session.record?.note;
  const project = columns.project ? projectLabel(session, names) : "";
  const model = summary.model;
  return (
    <div
      className={styles.row}
      data-testid="session-row"
      data-session-id={session.id}
      data-status={statusOf(session)}
      data-last-selected={lastSelected ? "" : undefined}
      onClick={() => onSelect(session.id)}
    >
      <div className={styles.line}>
        <div className={`${styles.cell} ${styles.name}`} data-testid="cell-name">
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
