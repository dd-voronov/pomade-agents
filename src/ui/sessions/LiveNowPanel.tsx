// The Live now panel — what the Agents strip icon fills Pomade's side panel with (DESIGN §2.8):
// every agent running now across projects, grouped by project, the active one first. A tab row's
// click focuses its agent tab (Pomade switches to its project); an unattended run's (⏱, its job's
// name) opens its attached terminal tab in its project. A group header's click switches to its
// project through the group's first tab, else its first run. The two buttons open or focus the app's wide tab at
// Sessions and at the Roster. The rows are the backend's (`liveNow.list`); so is the icon's badge.

import type { ReactElement } from "react";
import type { ProjectRef } from "pomade-kit/protocol";
import type { HostClient } from "pomade-kit/sdk";

import { RUNNER_APP_ID } from "../../shared/runner-events.ts";
import type { LiveRow, LiveRunRow, LiveTabRow } from "../../shared/live-now.ts";
import { liveRowKey } from "../../shared/live-now.ts";
import { BackendStatus } from "../core/BackendStatus.tsx";
import { RosterIcon, SessionsIcon, TimerIcon } from "../core/icons.tsx";
import { LIVE_LABELS } from "../core/live.ts";
import { LiveMark } from "../core/LiveMark.tsx";
import { openTab } from "../core/openTab.ts";
import { ROSTER_ROUTE, SESSIONS_ROUTE } from "../core/routes.ts";
import { useActiveProject } from "../core/useActiveProject.ts";
import { useNow } from "../core/useNow.ts";
import { useProjects } from "../core/useProjects.ts";
import { groupRows, groupTarget, headerCount, rowAgent, rowTitle, rowTooltip } from "./live-now-model.ts";
import styles from "./LiveNowPanel.module.css";
import { formatAgo } from "./table-model.ts";
import { useLiveNow } from "./useLiveNow.ts";

/** "Since when" is renewed this often. */
const CLOCK_MS = 30_000;

const NO_PROJECTS: ReadonlyMap<string, ProjectRef> = new Map();

function Row({ row, now, open }: { row: LiveRow; now: Date; open: (() => void) | null }): ReactElement {
  const title = rowTitle(row);
  const label = LIVE_LABELS[row.state];
  return (
    <button
      type="button"
      className={styles.row}
      data-testid="live-row"
      data-tab={row.kind === "tab" ? row.tabId : undefined}
      data-run={row.kind === "run" ? row.run : undefined}
      data-state={row.state}
      title={rowTooltip(row, now)}
      disabled={open === null}
      onClick={open ?? undefined}
    >
      <span className={styles.lead}>
        <LiveMark state={row.state} title={label} />
      </span>
      <span className={styles.text}>
        <span className={styles.line1}>
          {row.kind === "run" && (
            <span className={styles.runIcon} data-testid="live-row-run" title="Unattended run">
              <TimerIcon size={14} />
            </span>
          )}
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
            {rowAgent(row)}
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
  const focus = (row: LiveTabRow): void => {
    host.agentTabs.focus(row.tabId).catch(() => undefined);
  };
  const attach = (row: LiveRunRow, terminal: string): void => {
    host.tabs.openAttached({ session: { app: RUNNER_APP_ID, session: terminal }, title: row.name, projectId: row.project }).catch(() => undefined);
  };
  /** What a row's click does; `null`: nothing (a run whose terminal is not known). */
  const opener = (row: LiveRow): (() => void) | null => {
    if (row.kind === "tab") return () => focus(row);
    const { terminal } = row;
    return terminal === null ? null : () => attach(row, terminal);
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
                const target = groupTarget(group);
                if (target !== null) opener(target)?.();
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
              <Row key={liveRowKey(row)} row={row} now={now} open={opener(row)} />
            ))}
          </section>
        ))}
      </div>
      <BackendStatus host={host} />
    </div>
  );
}
