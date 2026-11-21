// One session in the Sessions table: a 28 px line of columns, and its note under it.

import type { ReactElement } from "react";

import { ForkIcon, NoteIcon, TimerIcon } from "../core/icons.tsx";
import type { Session } from "../../shared/sessions.ts";
import { chipsOf, contextMeter, formatAgo, formatMoney, formatStamp, projectLabel, rowName, statusOf, unknownReason, type Columns } from "./table-model.ts";
import styles from "./SessionRow.module.css";

export interface SessionRowProps {
  session: Session;
  columns: Columns;
  /** Project names by id. */
  names: ReadonlyMap<string, string>;
  /** The fork mark's tooltip; `null`: no fork. */
  fork: string | null;
  now: Date;
}

function Unknown({ session }: { session: Session }): ReactElement {
  return (
    <span className={styles.dash} title={unknownReason(session)}>
      —
    </span>
  );
}

function ContextMeter({ session }: { session: Session }): ReactElement {
  const context = session.summary.context;
  if (context === null) return <Unknown session={session} />;
  const { percent, level, fill } = contextMeter(context);
  return (
    <span className={styles.context} data-level={level} title={`Context ${percent}% full`}>
      <span className={styles.bar}>
        <span className={styles.fill} style={{ width: `${fill}%` }} />
      </span>
      <span className={styles.percent}>{percent}%</span>
    </span>
  );
}

export function SessionRow({ session, columns, names, fork, now }: SessionRowProps): ReactElement {
  const { summary } = session;
  const name = rowName(session);
  const chips = chipsOf(session, names);
  const note = session.record?.note;
  const project = columns.project ? projectLabel(session, names) : "";
  const model = summary.model;
  return (
    <div className={styles.row} data-testid="session-row" data-session-id={session.id} data-status={statusOf(session)}>
      <div className={styles.line}>
        <div className={`${styles.cell} ${styles.name}`} data-testid="cell-name">
          {fork !== null && (
            <span className={styles.fork} title={fork} data-testid="fork-mark">
              <ForkIcon size={14} />
            </span>
          )}
          <span className={styles.nameText} data-unnamed={name.unnamed ? "" : undefined} title={name.text}>
            {name.text}
          </span>
          {chips.length > 0 && (
            <span className={styles.chips}>
              {chips.map((chip) => (
                <span key={chip.kind} className={styles.chip} data-kind={chip.kind} title={chip.tooltip} data-testid={`chip-${chip.kind}`}>
                  {chip.kind === "runner" && <TimerIcon size={11} />}
                  {chip.text}
                </span>
              ))}
            </span>
          )}
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
