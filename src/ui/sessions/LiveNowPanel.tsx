// The Live now panel — what the Agents strip icon fills Pomade's side panel with (DESIGN §2.8):
// every agent running now across projects, grouped by project, the active one first. A row's click
// focuses its agent tab (Pomade switches to its project); a group header's click switches to its
// project by focusing that group's first tab. The two buttons open or focus the app's wide tab at
// Sessions and at the Roster. The rows are the backend's (`liveNow.list`); so is the icon's badge.

import type { ReactElement } from "react";
import type { ProjectRef } from "pomade-kit/protocol";
import type { HostClient } from "pomade-kit/sdk";

import type { LiveTabRow } from "../../shared/live-now.ts";
import { BackendStatus } from "../core/BackendStatus.tsx";
import { RosterIcon, SessionsIcon } from "../core/icons.tsx";
import { LIVE_LABELS } from "../core/live.ts";
import { LiveMark } from "../core/LiveMark.tsx";
import { openTab } from "../core/openTab.ts";
import { ROSTER_ROUTE, SESSIONS_ROUTE } from "../core/routes.ts";
import { useActiveProject } from "../core/useActiveProject.ts";
import { useNow } from "../core/useNow.ts";
import { useProjects } from "../core/useProjects.ts";
import { groupRows, headerCount, rowTitle } from "./live-now-model.ts";
import styles from "./LiveNowPanel.module.css";
import { formatAgo, formatStamp } from "./table-model.ts";
import { useLiveNow } from "./useLiveNow.ts";

/** "Since when" is renewed this often. */
const CLOCK_MS = 30_000;

const NO_PROJECTS: ReadonlyMap<string, ProjectRef> = new Map();

function TabRow({ row, now, focus }: { row: LiveTabRow; now: Date; focus: () => void }): ReactElement {
  const title = rowTitle(row);
  const label = LIVE_LABELS[row.state];
  return (
    <button
      type="button"
      className={styles.row}
      data-testid="live-row"
      data-tab={row.tabId}
      data-state={row.state}
      title={`${label} since ${formatStamp(row.since, now)} — switches project and focuses the tab`}
      onClick={focus}
    >
      <span className={styles.lead}>
        <LiveMark state={row.state} title={label} />
      </span>
      <span className={styles.text}>
        <span className={styles.line1}>
          <span className={styles.name} data-unnamed={title.unnamed || undefined} data-testid="live-row-name">
            {title.text}
          </span>
          <span className={styles.when} data-testid="live-row-since">
            {formatAgo(row.since, now)}
          </span>
        </span>
        <span className={styles.line2}>
          <span className={styles.word} data-state={row.state} data-testid="live-row-state">
            {label}
          </span>
          <span>·</span>
          <span className={styles.agent} data-testid="live-row-agent">
            {row.agent}
          </span>
        </span>
      </span>
    </button>
  );
}

export function LiveNowPanel({ host }: { host: HostClient }): ReactElement {
  const answer = useLiveNow(host);
  const projects = useProjects(host) ?? NO_PROJECTS;
  const active = useActiveProject(host);
  const now = useNow(CLOCK_MS);
  const rows = answer?.rows ?? [];
  const groups = groupRows(rows, active.id, projects);
  const focus = (tabId: string): void => {
    host.agentTabs.focus(tabId).catch(() => undefined);
  };

  return (
    <div className={styles.panel} data-testid="live-now-panel">
      <header className={styles.header}>
        <h1 className={styles.title}>Live now</h1>
        <span className={styles.count} data-testid="live-now-count">
          {headerCount(rows)}
        </span>
      </header>
      <nav className={styles.actions} aria-label="Agents tabs">
        <button type="button" className={styles.action} data-testid="open-sessions" onClick={() => openTab(host, SESSIONS_ROUTE)}>
          <SessionsIcon size={14} />
          Sessions
        </button>
        <button type="button" className={styles.action} data-testid="open-roster" onClick={() => openTab(host, ROSTER_ROUTE)}>
          <RosterIcon size={14} />
          Roster
        </button>
      </nav>
      <div className={styles.body} data-testid="live-now-list">
        {answer !== null && groups.length === 0 && (
          <div className={styles.empty} data-testid="live-now-empty">
            <b>No agents running</b>
            Sessions with an open agent tab and unattended runs show up here.
          </div>
        )}
        {groups.map((group) => (
          <section key={group.project} className={styles.group} data-testid="live-group" data-project={group.project} aria-label={group.name}>
            <button
              type="button"
              className={styles.groupHead}
              data-testid="live-group-head"
              title={`Switch to ${group.name}`}
              onClick={() => {
                const [first] = group.rows;
                if (first !== undefined) focus(first.tabId);
              }}
            >
              <span className={styles.groupName}>{group.name}</span>
              {group.current && (
                <span className={styles.current} data-testid="live-group-current">
                  current
                </span>
              )}
              <span className={styles.groupCount}>{group.rows.length}</span>
            </button>
            {group.rows.map((row) => (
              <TabRow key={row.tabId} row={row} now={now} focus={() => focus(row.tabId)} />
            ))}
          </section>
        ))}
      </div>
      <BackendStatus host={host} />
    </div>
  );
}
