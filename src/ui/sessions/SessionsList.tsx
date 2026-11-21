// The list beside the detail panel (DESIGN §2.7 "List with the detail panel"): the four status
// tabs with their counts, then the open tab's sessions as two-line rows — a long Done or
// Done–skip/Failed tab cut to its latest rows with "Show all N", unless the selected session is
// further down — or its one-line empty text. The selected row is kept in view.

import { useLayoutEffect, useRef, type ReactElement } from "react";
import { SESSION_STATUSES, type SessionStatus } from "pomade-kit/protocol";

import type { Session } from "../../shared/sessions.ts";
import { ListRow } from "./ListRow.tsx";
import type { Groups } from "./selection-model.ts";
import { listRows } from "./selection-model.ts";
import { StatusMark } from "./StatusGroup.tsx";
import { EMPTY_GROUP_TEXT, LATEST_SHOWN, STATUS_LABELS, STATUS_SHORT_LABELS, forkTooltip } from "./table-model.ts";
import styles from "./SessionsList.module.css";

export interface SessionsListProps {
  groups: Groups;
  /** The status tab that is open. */
  tab: SessionStatus;
  onOpenTab: (status: SessionStatus) => void;
  selected: string;
  onSelect: (id: string) => void;
  expanded: ReadonlySet<SessionStatus>;
  onToggleExpanded: (status: SessionStatus) => void;
  workspace: boolean;
  names: ReadonlyMap<string, string>;
  byId: ReadonlyMap<string, Session>;
  now: Date;
  /** The note a row shows, for the session whose note is being typed. */
  noteOf: (session: Session) => string | undefined;
}

export function SessionsList({ groups, tab, onOpenTab, selected, onSelect, expanded, onToggleExpanded, workspace, names, byId, now, noteOf }: SessionsListProps): ReactElement {
  const list = useRef<HTMLDivElement>(null);
  const sessions = groups[tab];
  const shown = listRows(tab, sessions, expanded.has(tab), selected);

  useLayoutEffect(() => {
    const row = list.current?.querySelector(`[data-session-id="${CSS.escape(selected)}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [selected, tab]);

  return (
    <div className={styles.pane} data-testid="sessions-list">
      <div className={styles.tabs} role="tablist" aria-label="Statuses">
        {SESSION_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            role="tab"
            className={styles.tab}
            aria-selected={status === tab}
            title={STATUS_LABELS[status]}
            data-testid={`status-tab-${status}`}
            onClick={() => onOpenTab(status)}
          >
            <StatusMark status={status} />
            <span className={styles.label}>{STATUS_SHORT_LABELS[status]}</span>
            <span className={styles.count} data-testid={`status-tab-count-${status}`}>
              {groups[status].length}
            </span>
          </button>
        ))}
      </div>
      <div ref={list} className={styles.list} role="listbox" aria-label={STATUS_LABELS[tab]} data-testid={`list-${tab}`}>
        {shown.rows.map((session) => (
          <ListRow
            key={session.id}
            session={session}
            workspace={workspace}
            names={names}
            fork={forkTooltip(session, byId)}
            now={now}
            selected={session.id === selected}
            note={noteOf(session)}
            onSelect={onSelect}
          />
        ))}
        {shown.long && (
          <div className={styles.more} data-testid={`list-more-${tab}`}>
            {expanded.has(tab) ? (
              <button type="button" className={styles.link} onClick={() => onToggleExpanded(tab)}>
                Show the latest {LATEST_SHOWN} only
              </button>
            ) : shown.expanded ? (
              `Showing all ${sessions.length}: the selected session is past the latest ${LATEST_SHOWN}`
            ) : (
              <>
                Showing {LATEST_SHOWN} of {sessions.length} ·{" "}
                <button type="button" className={styles.link} onClick={() => onToggleExpanded(tab)}>
                  Show all {sessions.length}
                </button>
              </>
            )}
          </div>
        )}
        {sessions.length === 0 && (
          <div className={styles.empty} data-testid={`list-empty-${tab}`}>
            {EMPTY_GROUP_TEXT[tab]}
          </div>
        )}
      </div>
    </div>
  );
}
