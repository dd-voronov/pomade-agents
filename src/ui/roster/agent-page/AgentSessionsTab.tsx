// Sessions: this agent's sessions across every project — the latest of them, newest first — with a
// Project filter and Open in Sessions, which opens the Sessions tab of the Workspace with the agent
// (and the project) as filters. The data is the Sessions tab's: the same `sessions.list` copy and
// the same row values.

import { useMemo, useRef, useState, type ReactElement } from "react";
import { WORKSPACE_PROJECT_ID } from "pomade-kit/protocol";

import { CaretIcon, SessionsIcon } from "../../core/icons.tsx";
import { LiveMark } from "../../core/LiveMark.tsx";
import { Menu, type MenuAnchor, type MenuEntry } from "../../core/Menu.tsx";
import { sessionsFilterRoute } from "../../core/routes.ts";
import { useNow } from "../../core/useNow.ts";
import { WORKSPACE_TARGET } from "../../sessions/edit-model.ts";
import { STATUS_SHORT_LABELS, formatAgo, formatMoney, formatStamp, liveTitle, projectLabel, rowName, statusOf } from "../../sessions/table-model.ts";
import { useSessions } from "../../sessions/useSessions.ts";
import type { AgentContext } from "./agent-context.ts";
import { agentSessions } from "./agent-sessions-model.ts";
import { Section } from "./Section.tsx";
import styles from "./page.module.css";
import rows from "./sessions-tab.module.css";

/** Relative times ("5m") are renewed this often. */
const CLOCK_MS = 30_000;

export function AgentSessionsTab({ context }: { context: AgentContext }): ReactElement {
  const { host, entry, projects, show } = context;
  const { copy } = useSessions(host);
  const now = useNow(CLOCK_MS);
  const [project, setProject] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const filter = useRef<HTMLButtonElement>(null);
  const names = useMemo(() => new Map([...projects].map(([id, p]) => [id, p.name])), [projects]);
  const listed = useMemo(() => agentSessions(copy?.byId.values() ?? [], entry.id, project, names), [copy, entry.id, project, names]);
  const { rows: sessions, total } = listed;
  const projectName = project === null ? null : project === WORKSPACE_PROJECT_ID ? WORKSPACE_TARGET : (names.get(project) ?? project);

  const entries: MenuEntry[] = [
    { kind: "item", id: "project-all", label: "All projects", checked: project === null, trail: String(listed.projects.all), run: () => setProject(null) },
    ...listed.projects.options.map((option): MenuEntry => ({ kind: "item", id: `project-${option.key}`, label: option.label, checked: project === option.key, trail: String(option.count), run: () => setProject(option.key) })),
  ];

  const openInSessions = (): void => {
    const route = sessionsFilterRoute({ agent: entry.id, ...(project === null ? {} : { project }) });
    host.tabs.openApp({ route, projectId: WORKSPACE_PROJECT_ID }).catch((err: unknown) => {
      show("Sessions was not opened.", null, err instanceof Error ? err.message : String(err));
    });
  };

  return (
    <Section
      title="Sessions"
      testId="agent-sessions"
      action={
        <button type="button" className={`${styles.btn} ${styles.sm}`} data-testid="open-in-sessions" onClick={openInSessions}>
          <SessionsIcon size={14} />
          Open in Sessions
        </button>
      }
    >
      <div className={rows.filter}>
        <button
          ref={filter}
          type="button"
          className={`${styles.btn} ${styles.sm}`}
          data-on={project === null ? undefined : ""}
          aria-expanded={menu !== null}
          aria-haspopup="menu"
          data-testid="project-filter"
          onClick={() => setMenu(filter.current?.getBoundingClientRect() ?? { x: 0, y: 0 })}
        >
          <span className={rows.filterName}>{projectName ?? "Project"}</span>
          <CaretIcon size={12} />
        </button>
        {project !== null && (
          <button type="button" className={styles.link} data-testid="project-filter-clear" onClick={() => setProject(null)}>
            Clear
          </button>
        )}
      </div>
      <div className={`${styles.block} ${styles.flush}`}>
        {copy === null && <p className={`${styles.none} ${styles.pad}`}>Reading the sessions…</p>}
        {copy !== null && sessions.length === 0 && (
          <p className={`${styles.none} ${styles.pad}`} data-testid="agent-sessions-empty">
            {projectName === null ? "No sessions yet." : `No sessions of ${entry.id} in ${projectName}.`}
          </p>
        )}
        {sessions.map((session) => {
          const name = rowName(session);
          const live = liveTitle(session, now);
          const { summary } = session;
          const status = statusOf(session);
          return (
            <div key={session.id} className={rows.row} data-status={status} data-testid="agent-session-row" data-session-id={session.id}>
              <span className={rows.status} data-status={status} title={STATUS_SHORT_LABELS[status]} />
              <span className={rows.live}>{live !== null && <LiveMark state={session.live} title={live} />}</span>
              <span className={rows.name} data-unnamed={name.unnamed ? "" : undefined} title={name.text} data-testid="agent-session-name">
                {name.text}
              </span>
              <span className={rows.project} title={projectLabel(session, names)}>
                {projectLabel(session, names)}
              </span>
              <span className={rows.model}>
                {summary.model ?? "—"}
                {summary.effort !== null && <span className={styles.faint}> {summary.effort}</span>}
              </span>
              <span className={`${rows.number} ${rows.cost}`}>{summary.costUsd === null ? "—" : formatMoney(summary.costUsd)}</span>
              <span className={rows.number} title={formatStamp(summary.lastActiveAt, now)}>
                {formatAgo(summary.lastActiveAt, now)}
              </span>
            </div>
          );
        })}
      </div>
      {total > sessions.length && (
        <p className={styles.hint} data-testid="agent-sessions-cut">
          The latest {sessions.length} of {total}. Open in Sessions has them all.
        </p>
      )}
      {menu !== null && <Menu entries={entries} anchor={menu} onClose={() => setMenu(null)} label="Project filter" testId="project-menu" />}
    </Section>
  );
}
