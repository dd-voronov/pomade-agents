// One session in the list beside the detail panel: its checkbox, its live mark, then two lines — the name with
// its marks and chips, and last active; then project (Workspace scope) · agent · model · effort,
// with context % and ~$ est. on the right. Its note sits under them. The checkbox shows on hover
// and while any row is checked; the row drags onto a status tab.

import type { ReactElement } from "react";

import { NoteIcon } from "../core/icons.tsx";
import { LiveMark } from "../core/LiveMark.tsx";
import type { Session } from "../../shared/sessions.ts";
import { Checkbox } from "./Checkbox.tsx";
import { rowMeta } from "./detail-model.ts";
import type { RowEvents, RowMarks } from "./row-events.ts";
import { SessionName } from "./SessionName.tsx";
import { formatAgo, formatMoney, formatStamp, liveTitle, statusOf } from "./table-model.ts";
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
  marks: RowMarks;
  events: RowEvents;
  /** The note as the row shows it: the saved one, or the one being typed in the panel. */
  note: string | undefined;
}

export function ListRow({ session, workspace, names, fork, now, selected, marks, events, note }: ListRowProps): ReactElement {
  const { summary } = session;
  const meta = rowMeta(session, workspace, names);
  const live = liveTitle(session, now);
  return (
    <div
      className={styles.row}
      role="option"
      aria-selected={selected}
      data-testid="session-row"
      data-session-id={session.id}
      data-status={statusOf(session)}
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
      <Checkbox className={styles.check} checked={marks.checked} label="Check the session" testId="row-check" onToggle={(event) => events.onCheck(session.id, event)} />
      <span className={styles.live}>{live !== null && <LiveMark state={session.live} title={live} />}</span>
      <div className={styles.text}>
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
    </div>
  );
}
