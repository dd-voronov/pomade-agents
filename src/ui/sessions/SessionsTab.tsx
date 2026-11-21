// The Sessions tab: the header (the scope, its session count and ~$ sum), then — while no session
// is selected — the table of the scope's sessions, or — once one is — the list with the detail
// panel (DESIGN §2.7). A state page shows while the stores are read, or when the scope has none.
// The scope is the project the tab was opened in (`welcome.project`); a tab keeps it. The
// selection is the tab's route (`useSelection`); ↑ ↓ move it in both layouts, Esc closes the panel.

import { useEffect, useMemo, useState, type ReactElement } from "react";
import { WORKSPACE_PROJECT_ID, type ProjectRef, type SessionStatus } from "pomade-kit/protocol";
import type { HostClient } from "pomade-kit/sdk";

import { SessionsIcon } from "../core/icons.tsx";
import { StatePage } from "../core/StatePage.tsx";
import { useBackendInfo } from "../core/useBackendInfo.ts";
import { useNow } from "../core/useNow.ts";
import { useProjects } from "../core/useProjects.ts";
import type { Session } from "../../shared/sessions.ts";
import { draftNote } from "./detail-model.ts";
import { DetailPanel } from "./DetailPanel.tsx";
import { listRows, openTab, revealInTable, step, tableOrder, type PickedTab } from "./selection-model.ts";
import { SessionsList } from "./SessionsList.tsx";
import { SessionsTable } from "./SessionsTable.tsx";
import { formatHeaderSum, groupByStatus, inScope, statusOf, totalCost } from "./table-model.ts";
import styles from "./SessionsTab.module.css";
import { useSelection } from "./useSelection.ts";
import { useSessions } from "./useSessions.ts";
import { useStatusChange } from "./useStatusChange.ts";

/** Relative times ("5m") are renewed this often. */
const CLOCK_MS = 30_000;

const NO_PROJECTS: ReadonlyMap<string, ProjectRef> = new Map();

const toggled = (set: ReadonlySet<SessionStatus>, status: SessionStatus): Set<SessionStatus> => {
  const next = new Set(set);
  if (!next.delete(status)) next.add(status);
  return next;
};

/** A key the tab acts on only when no field takes it and no modifier changes it. */
function forTheTab(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  const target = event.target;
  return !(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable));
}

export function SessionsTab({ host, route }: { host: HostClient; route: string }): ReactElement {
  const { copy, update } = useSessions(host);
  const projects = useProjects(host) ?? NO_PROJECTS;
  const names = useMemo(() => new Map([...projects].map(([id, p]) => [id, p.name])), [projects]);
  const backend = useBackendInfo(host);
  const workspaceRoot = backend.status === "running" ? backend.info.workspace : null;
  const now = useNow(CLOCK_MS);
  const scope = host.welcome.project;
  const workspace = scope.id === WORKSPACE_PROJECT_ID;
  const scopeName = workspace ? "Workspace · all projects" : (names.get(scope.id) ?? scope.name);

  const [selectedId, select] = useSelection(host, route);
  const [lastSelected, setLastSelected] = useState<string | null>(null);
  const [picked, setPicked] = useState<PickedTab | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<SessionStatus>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<SessionStatus>>(new Set());
  const [noteDraft, setNoteDraft] = useState<{ session: string; text: string } | null>(null);
  const { change, failure, dismiss } = useStatusChange(host, update);

  const groups = groupByStatus(copy?.byId.values() ?? [], scope.id);
  const count = groups.active.length + groups["on-hold"].length + groups.done.length + groups["done-skip"].length;
  const candidate = selectedId === null ? undefined : copy?.byId.get(selectedId);
  const selected = candidate !== undefined && inScope(candidate, scope.id) ? candidate : null;
  const tab = selected === null ? null : openTab(selected, picked);

  const onSelect = (id: string): void => {
    if (failure !== null && failure.session !== id) dismiss();
    setPicked(null);
    select(id);
  };

  const close = (): void => {
    if (selected === null) return;
    setLastSelected(selected.id);
    const revealed = revealInTable(groups, selected.id, collapsed, expanded);
    setCollapsed(revealed.collapsed);
    setExpanded(revealed.expanded);
    dismiss();
    select(null);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!forTheTab(event)) return;
      if (event.key === "Escape" && selected !== null) {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const order =
        selected === null || tab === null
          ? tableOrder(groups, collapsed, expanded)
          : listRows(tab, groups[tab], expanded.has(tab), selected.id).rows.map((s) => s.id);
      const next = step(order, selected?.id ?? null, direction, selected === null ? lastSelected : null);
      if (next === null) return;
      event.preventDefault();
      if (next !== selected?.id) onSelect(next);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const noteOf = (session: Session): string | undefined =>
    noteDraft !== null && noteDraft.session === session.id ? draftNote(noteDraft.text) : session.record?.note;

  let body: ReactElement;
  if (copy === null) {
    body = (
      <StatePage icon={<SessionsIcon size={20} />} title="Reading the session stores…" testId="sessions-reading">
        The agents' sessions show here once their stores are read.
      </StatePage>
    );
  } else if (count === 0) {
    body = (
      <StatePage icon={<SessionsIcon size={20} />} title={`No sessions in ${workspace ? "the Workspace" : scopeName} yet`} testId="sessions-empty">
        {copy.indexing
          ? "The agents' session stores are still being read."
          : "Start an agent from the + menu. Its session shows up here within a couple of seconds, as Active."}
      </StatePage>
    );
  } else if (selected !== null && tab !== null) {
    body = (
      <div className={styles.split} data-testid="sessions-split">
        <SessionsList
          groups={groups}
          tab={tab}
          onOpenTab={(status) => setPicked({ status, session: selected.id, sessionStatus: statusOf(selected) })}
          selected={selected.id}
          onSelect={onSelect}
          expanded={expanded}
          onToggleExpanded={(status) => setExpanded((set) => toggled(set, status))}
          workspace={workspace}
          names={names}
          byId={copy.byId}
          now={now}
          noteOf={noteOf}
        />
        <DetailPanel
          key={selected.id}
          session={selected}
          now={now}
          names={names}
          projects={projects}
          workspaceRoot={workspaceRoot}
          byId={copy.byId}
          inTab={(id) => {
            const session = copy.byId.get(id);
            return session !== undefined && inScope(session, scope.id);
          }}
          onSelect={onSelect}
          onClose={close}
          change={change}
          failure={failure}
          onDraftNote={(session, text) => setNoteDraft(text === null ? null : { session, text })}
        />
      </div>
    );
  } else {
    body = (
      <SessionsTable
        groups={groups}
        workspace={workspace}
        names={names}
        byId={copy.byId}
        now={now}
        collapsed={collapsed}
        expanded={expanded}
        onToggleCollapsed={(status) => setCollapsed((set) => toggled(set, status))}
        onToggleExpanded={(status) => setExpanded((set) => toggled(set, status))}
        lastSelected={lastSelected}
        onSelect={onSelect}
      />
    );
  }

  return (
    <div className={styles.tab}>
      <header className={styles.head}>
        <h1 className={styles.title}>Sessions</h1>
        <span className={styles.scope} data-testid="sessions-scope">
          {scopeName}
        </span>
        {copy !== null && (
          <span
            className={styles.sum}
            title="Done–skip/Failed is left out of the total"
            data-testid="sessions-count"
            data-count={count}
            data-revision={copy.since.revision}
            data-indexing={copy.indexing ? "" : undefined}
          >
            {copy.indexing && <span className={styles.indexing}>Indexing… </span>}
            {formatHeaderSum(count, totalCost(groups))}
          </span>
        )}
      </header>
      {copy?.recordsOff != null && (
        <p className={styles.recordsOff} data-testid="sessions-records-off">
          {copy.recordsOff}
        </p>
      )}
      {body}
    </div>
  );
}
