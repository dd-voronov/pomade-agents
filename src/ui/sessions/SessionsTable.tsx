// The Sessions table (DESIGN §2.7 "Table — nothing selected"): one scrolling list with a sticky
// column header and the four collapsible status groups. It measures its own width and shows the
// columns that fit. Which groups are collapsed or expanded is the tab's, so it stays while the
// sessions change and across the detail panel. Opened again from the panel, it scrolls to the row
// that was selected.

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement, type RefObject } from "react";
import { SESSION_STATUSES, type SessionStatus } from "pomade-kit/protocol";

import type { Session } from "../../shared/sessions.ts";
import { SessionRow } from "./SessionRow.tsx";
import { StatusGroup } from "./StatusGroup.tsx";
import { columnTemplate, columnsFor, forkTooltip, type Columns } from "./table-model.ts";
import styles from "./SessionsTable.module.css";

export interface SessionsTableProps {
  groups: Record<SessionStatus, readonly Session[]>;
  /** The Workspace's tab: every session, with a Project column. */
  workspace: boolean;
  /** Project names by id. */
  names: ReadonlyMap<string, string>;
  /** Every session the UI holds, by id: a fork's parent may be outside the scope. */
  byId: ReadonlyMap<string, Session>;
  now: Date;
  collapsed: ReadonlySet<SessionStatus>;
  /** Long groups that show all their rows. */
  expanded: ReadonlySet<SessionStatus>;
  onToggleCollapsed: (status: SessionStatus) => void;
  onToggleExpanded: (status: SessionStatus) => void;
  /** The row selected before the detail panel closed: marked, and scrolled into view when the table opens. */
  lastSelected: string | null;
  onSelect: (id: string) => void;
}

function useWidth(): [RefObject<HTMLDivElement>, number | null] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

function ColumnHeader({ columns }: { columns: Columns }): ReactElement {
  return (
    <div className={styles.columns} data-testid="sessions-columns">
      <div className={`${styles.heading} ${styles.name}`}>
        Name
      </div>
      {columns.project && (
        <div className={styles.heading}>
          Project
        </div>
      )}
      {columns.agent && (
        <div className={styles.heading}>
          Agent
        </div>
      )}
      {columns.model && (
        <div className={styles.heading}>
          {columns.effort ? "Model · effort" : "Model"}
        </div>
      )}
      {columns.context && (
        <div className={styles.heading}>
          Context
        </div>
      )}
      {columns.cost && (
        <div className={`${styles.heading} ${styles.number}`}>
          ~$ est.
        </div>
      )}
      <div className={`${styles.heading} ${styles.number}`}>
        Last active
      </div>
    </div>
  );
}

export function SessionsTable({
  groups,
  workspace,
  names,
  byId,
  now,
  collapsed,
  expanded,
  onToggleCollapsed,
  onToggleExpanded,
  lastSelected,
  onSelect,
}: SessionsTableProps): ReactElement {
  const [ref, width] = useWidth();
  const revealed = useRef(lastSelected);
  useLayoutEffect(() => {
    const id = revealed.current;
    if (id === null) return;
    const row = ref.current?.querySelector(`[data-session-id="${CSS.escape(id)}"]`);
    row?.scrollIntoView({ block: "center" });
  }, [ref]);
  // Until the first measure (before paint) every column is laid out.
  const columns = columnsFor(width ?? Infinity, workspace);
  const shown = Object.entries(columns)
    .filter(([, on]) => on)
    .map(([column]) => column)
    .join(" ");
  const style = { "--columns": columnTemplate(columns) } as CSSProperties;

  return (
    <div ref={ref} className={styles.table} style={style} data-testid="sessions-table" data-columns={shown}>
      <ColumnHeader columns={columns} />
      {SESSION_STATUSES.map((status) => (
        <StatusGroup
          key={status}
          status={status}
          sessions={groups[status]}
          collapsed={collapsed.has(status)}
          expanded={expanded.has(status)}
          onToggleCollapsed={onToggleCollapsed}
          onToggleExpanded={onToggleExpanded}
          row={(session) => (
            <SessionRow
              key={session.id}
              session={session}
              columns={columns}
              names={names}
              fork={forkTooltip(session, byId)}
              now={now}
              lastSelected={session.id === lastSelected}
              onSelect={onSelect}
            />
          )}
        />
      ))}
    </div>
  );
}
