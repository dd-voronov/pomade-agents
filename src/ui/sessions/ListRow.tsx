// One session in the list beside the detail panel, on two lines: the name with its marks and
// chips, and last active; then project (Workspace scope) · agent · model · effort, with context %
// and ~$ est. on the right. Its note sits under it.

import type { ReactElement } from "react";

import { NoteIcon } from "../core/icons.tsx";
import type { Session } from "../../shared/sessions.ts";
import { rowMeta } from "./detail-model.ts";
import { SessionName } from "./SessionName.tsx";
import { formatAgo, formatMoney, formatStamp, statusOf } from "./table-model.ts";
import { ContextMeter, Unknown } from "./Values.tsx";
import styles from "./ListRow.module.css";

export interface ListRowProps {
  session: Session;
  workspace: boolean;
  /** Project names by id. */
  names: ReadonlyMap<string, string>;
  /** The fork mark's tooltip; `null`: no fork. */
  fork: string | null;
  now: Date;
  selected: boolean;
  /** The note as the row shows it: the saved one, or the one being typed in the panel. */
  note: string | undefined;
  onSelect: (id: string) => void;
}

export function ListRow({ session, workspace, names, fork, now, selected, note, onSelect }: ListRowProps): ReactElement {
  const { summary } = session;
  const meta = rowMeta(session, workspace, names);
  return (
    <div
      className={styles.row}
      role="option"
      aria-selected={selected}
      data-testid="session-row"
      data-session-id={session.id}
      data-status={statusOf(session)}
      onClick={() => onSelect(session.id)}
    >
      <div className={styles.first}>
        <SessionName session={session} names={names} fork={fork} />
        <span className={styles.when} title={formatStamp(summary.lastActiveAt, now)} data-testid="cell-last">
          {formatAgo(summary.lastActiveAt, now)}
        </span>
      </div>
      <div className={styles.second}>
        <span className={styles.meta} title={meta.join(" · ")} data-testid="row-meta">
          {meta.map((part, i) => (
            <span key={i}>
              {i > 0 && <span className={styles.sep}> · </span>}
              {part}
            </span>
          ))}
        </span>
        <span className={styles.numbers}>
          <ContextMeter session={session} />
          <span data-testid="cell-cost">{summary.costUsd === null ? <Unknown session={session} /> : formatMoney(summary.costUsd)}</span>
        </span>
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
