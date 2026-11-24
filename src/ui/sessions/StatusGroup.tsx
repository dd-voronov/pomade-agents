// One status's group in the Sessions table: a sticky header (collapse toggle, status mark, label,
// count, ~$ sum) that takes rows dropped on it, then its rows — the latest 10 of a long Done or
// Done–skip/Failed group with "Show all N" — or its one-line empty text. Holding a search's or
// filter's matches, it shows every one of them, and nothing when it has none.

import type { ReactElement, ReactNode } from "react";
import type { SessionStatus } from "pomade-kit/protocol";

import { ChevronIcon } from "../core/icons.tsx";
import type { Session } from "../../shared/sessions.ts";
import { EMPTY_GROUP_TEXT, LATEST_SHOWN, STATUS_LABELS, costSum, formatMoney, isLong, shownRows } from "./table-model.ts";
import styles from "./StatusGroup.module.css";
import type { StatusDrop } from "./useStatusDrag.ts";

export interface StatusGroupProps {
  status: SessionStatus;
  /** Every session of the group, newest activity first. */
  sessions: readonly Session[];
  collapsed: boolean;
  /** A long group shows all its rows. */
  expanded: boolean;
  onToggleCollapsed: (status: SessionStatus) => void;
  onToggleExpanded: (status: SessionStatus) => void;
  drop: StatusDrop;
  row: (session: Session) => ReactNode;
  /** The group holds a search's or filter's matches. */
  filtered?: boolean;
}

/** The status's mark: a small colored square, so it never reads as a live-state dot. */
export function StatusMark({ status }: { status: SessionStatus }): ReactElement {
  return <span className={styles.mark} data-status={status} aria-hidden="true" />;
}

function sumText(status: SessionStatus, sessions: readonly Session[]): string | null {
  if (sessions.length === 0) return null;
  const sum = costSum(sessions);
  const parts = sum === null ? [] : [formatMoney(sum)];
  if (status === "done-skip") parts.push("not in totals");
  return parts.length === 0 ? null : parts.join(" · ");
}

export function StatusGroup({ status, sessions, collapsed, expanded, onToggleCollapsed, onToggleExpanded, drop, row, filtered = false }: StatusGroupProps): ReactElement {
  const count = sessions.length;
  const sum = sumText(status, sessions);
  const long = !filtered && isLong(status, count);
  return (
    <section className={styles.group} data-testid={`group-${status}`} data-count={count} aria-label={STATUS_LABELS[status]}>
      <div
        className={styles.head}
        data-testid={`group-head-${status}`}
        data-drop={drop.over === status ? "" : undefined}
        onDragOver={(event) => drop.onDragOver(status, event)}
        onDragLeave={(event) => drop.onDragLeave(status, event)}
        onDrop={(event) => drop.onDrop(status, event)}
      >
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={!collapsed}
          title={collapsed ? "Show the group" : "Hide the group's rows"}
          data-testid={`group-toggle-${status}`}
          onClick={() => onToggleCollapsed(status)}
        >
          <span className={styles.chevron}>
            <ChevronIcon size={14} />
          </span>
          <StatusMark status={status} />
          <span className={styles.label}>{STATUS_LABELS[status]}</span>
          <span className={styles.count} data-testid={`group-count-${status}`}>
            {count}
          </span>
        </button>
        {sum !== null && (
          <span className={styles.sum} title="Sum of the estimates in this group" data-testid={`group-sum-${status}`}>
            {sum}
          </span>
        )}
      </div>
      {!collapsed && (
        <>
          {(filtered ? sessions : shownRows(status, sessions, expanded)).map(row)}
          {long && (
            <div className={styles.more} data-testid={`group-more-${status}`}>
              {expanded ? (
                <button type="button" className={styles.link} onClick={() => onToggleExpanded(status)}>
                  Show the latest {LATEST_SHOWN} only
                </button>
              ) : (
                <>
                  Showing {LATEST_SHOWN} of {count} ·{" "}
                  <button type="button" className={styles.link} onClick={() => onToggleExpanded(status)}>
                    Show all {count}
                  </button>
                </>
              )}
            </div>
          )}
          {count === 0 && !filtered && (
            <div className={styles.empty} data-testid={`group-empty-${status}`}>
              {EMPTY_GROUP_TEXT[status]}
            </div>
          )}
        </>
      )}
    </section>
  );
}
