// Projects: where the agent is offered and where it worked (ARCHITECTURE §3.4). One table — Project ·
// Sessions (90 d) · Last session — in two bands: Connected, the projects whose "+" menu offers the
// agent (under the sidebar's groups), and Not connected, the others, those the agent has sessions in
// first. Connect and Disconnect write the project's setting (`project.setAgents`) and offer Undo; a
// project that offers every agent is locked. A row opens the Sessions tab of this agent filtered to
// that project.

import { useMemo, useState, type ReactElement } from "react";

import { ChevronIcon, LockIcon, PlusIcon } from "../../core/icons.tsx";
import { agentSessionsRoute } from "../../core/routes.ts";
import { formatAgo, formatStamp } from "../../sessions/table-model.ts";
import { ProjectSwatch } from "../ProjectSwatch.tsx";
import type { AgentContext } from "./agent-context.ts";
import { connectAgent, disconnectAgent, offerFailure, type OfferChange } from "./project-offers.ts";
import { projectsView, type ProjectGroup, type ProjectRow } from "./projects-model.ts";
import { Section } from "./Section.tsx";
import styles from "./page.module.css";
import table from "./projects-tab.module.css";
import { useVisibleAgents } from "./useVisibleAgents.ts";

const WORK_SESSIONS = (n: number): string => `${n} work session${n === 1 ? "" : "s"}`;

export function ProjectsTab({ context }: { context: AgentContext }): ReactElement {
  const { host, entry, projects, projectsRead, counts, now, show, navigate, profilesOff } = context;
  const agent = entry.id;
  const visible = useVisibleAgents(host, useMemo(() => [...projects.keys()], [projects]));
  const [all, setAll] = useState<string | null>(null);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());

  const own = counts?.byAgent.get(agent)?.projects;
  const view = useMemo(
    () => (visible === null || !projectsRead || counts === null ? null : projectsView({ projects: projects.values(), counts: own ?? [], visible, agent })),
    [projects, projectsRead, counts, own, visible, agent],
  );

  const blocked = profilesOff !== null ? profilesOff : entry.orphan ? `${agent}’s folder is gone: re-link or remove it on the Roster.` : entry.problem !== null ? `${agent}’s profile cannot be read.` : null;

  /** Run one write for `row`, its button disabled meanwhile; `done` gets the list as it stood before. */
  const write = async (row: ProjectRow, call: () => Promise<OfferChange>, done: (before: readonly string[]) => void): Promise<void> => {
    setPending((p) => new Set(p).add(row.id));
    try {
      const result = await call();
      if (result.done) done(result.before);
      else show(`${row.name} was not changed. ${result.reason}`, null);
    } catch (err) {
      const { text, title } = offerFailure(err);
      show(text, null, title);
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(row.id);
        return next;
      });
    }
  };

  const connect = (row: ProjectRow, at?: number, undoable = true): Promise<void> =>
    write(
      row,
      () => connectAgent(host, row.id, agent, at),
      () => {
        if (undoable) show(`${row.name}’s settings now list ${agent}.`, () => void disconnect(row, false));
      },
    );

  const disconnect = (row: ProjectRow, undoable = true): Promise<void> =>
    write(
      row,
      () => disconnectAgent(host, row.id, agent),
      (before) => {
        if (undoable) show(`${row.name} no longer offers ${agent}. Its sessions there stay.`, () => void connect(row, before.indexOf(agent), false));
      },
    );

  const open = (row: ProjectRow): void => navigate(agentSessionsRoute(agent, row.id));

  const renderRow = (row: ProjectRow, connected: boolean): ReactElement => {
    const busy = pending.has(row.id);
    return (
      <div
        key={row.id}
        className={table.row}
        data-testid="project-row"
        data-project={row.id}
        data-connected={connected}
        data-locked={row.everyAgent || undefined}
        title={`Show ${agent}’s sessions in ${row.name}`}
        onClick={() => open(row)}
      >
        <span className={table.name}>
          <ProjectSwatch id={row.id} />
          <button type="button" className={table.open} data-testid="project-open">
            {row.name}
          </button>
          <span className={table.root} title={row.root}>
            {row.root}
          </span>
        </span>
        <span className={table.number} data-testid="project-sessions" title={row.sessions === null ? "No work sessions in this project" : `${WORK_SESSIONS(row.sessions)} in the last 90 days`}>
          {row.sessions === null ? <span className={styles.dash}>—</span> : row.sessions}
        </span>
        <span className={table.last} data-testid="project-last" title={row.lastAt === null ? undefined : formatStamp(row.lastAt, now)}>
          {row.lastAt === null ? <span className={styles.dash}>—</span> : formatAgo(row.lastAt, now)}
        </span>
        <span className={table.action}>
          {connected ? (
            row.everyAgent ? (
              <span className={table.lock} data-testid="project-locked" title="This project’s setting is [&quot;*&quot;]: it offers every agent">
                <LockIcon size={12} />
                <span className={table.lockText}>offers every agent</span>
              </span>
            ) : (
              <button
                type="button"
                className={`${styles.btn} ${styles.sm} ${table.off}`}
                data-testid="project-disconnect"
                disabled={busy || blocked !== null}
                title={blocked ?? undefined}
                onClick={(event) => {
                  event.stopPropagation();
                  void disconnect(row);
                }}
              >
                Disconnect
              </button>
            )
          ) : (
            <button
              type="button"
              className={`${styles.btn} ${styles.sm}`}
              data-testid="project-connect"
              disabled={busy || blocked !== null}
              title={blocked ?? undefined}
              onClick={(event) => {
                event.stopPropagation();
                void connect(row);
              }}
            >
              <PlusIcon size={12} />
              Connect
            </button>
          )}
        </span>
      </div>
    );
  };

  const renderGroups = (groups: readonly ProjectGroup[], connected: boolean): ReactElement[] =>
    groups.map((group) => (
      <div key={group.key} data-testid="project-group" data-group={group.label} data-connected={connected}>
        <div className={table.sub}>{group.label}</div>
        {group.rows.map((row) => renderRow(row, connected))}
      </div>
    ));

  const band = (label: string, n: number, note: string | null, testId: string): ReactElement => (
    <div className={table.band} data-testid={testId}>
      <span>{label}</span>
      <span className={table.count}>{n}</span>
      {note !== null && <span className={table.note}>{note}</span>}
    </div>
  );

  const folded = view !== null && view.foldable && all !== agent;
  const notConnected = view === null ? 0 : view.used.length + view.neverCount;

  return (
    <Section title="Projects" testId="agent-projects">
      <p className={table.lead}>
        A connected project offers {agent} in its “+” menu — the same list as the project’s settings. The Workspace offers every agent. Click a row for its sessions.
      </p>
      <div className={`${styles.block} ${styles.flush} ${table.table}`} data-testid="projects-table">
        <div className={table.head}>
          <span>Project</span>
          <span title="Work sessions in the last 90 days">
            Sessions <span className={table.window}>(90 d)</span>
          </span>
          <span>
            Last<span className={table.wide}> session</span>
          </span>
          <span />
        </div>
        {view === null ? (
          <p className={table.empty} data-testid="projects-loading">
            Reading the projects…
          </p>
        ) : (
          <>
            {band("Connected", view.connectedCount, null, "projects-connected")}
            {view.connectedCount === 0 ? (
              <p className={table.empty} data-testid="projects-none-connected">
                No project offers {agent}. Connect one below, or start it in the Workspace, which offers every agent.
              </p>
            ) : (
              renderGroups(view.connected, true)
            )}
            {notConnected > 0 && band("Not connected", notConnected, view.used.length > 0 ? `${view.used.length} with sessions` : null, "projects-not-connected")}
            {view.used.map((row) => renderRow(row, false))}
            {view.neverCount > 0 &&
              (folded ? (
                <button type="button" className={table.more} data-testid="projects-show-all" onClick={() => setAll(agent)}>
                  <ChevronIcon size={12} />
                  Show all projects
                  <span className={table.count}>{view.neverCount} more</span>
                </button>
              ) : (
                renderGroups(view.never, false)
              ))}
          </>
        )}
      </div>
      <p className={styles.hint} data-testid="projects-caption">
        Sessions (90 d): work sessions — every session except Skip/Failed ones — active in the last 90 days. Last session: the latest of them, however long ago.
      </p>
    </Section>
  );
}
