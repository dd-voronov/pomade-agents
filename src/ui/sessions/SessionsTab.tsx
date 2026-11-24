// The Sessions tab: the header (the scope, its session count and ~$ sum), the bulk bar while rows
// are checked, then — while no session is selected — the table of the scope's sessions, or — once
// one is — the list with the detail panel (DESIGN §2.7). A state page shows while the stores are
// read, or when the scope has none. The scope is the project the tab was opened in
// (`welcome.project`); a tab keeps it. The selection is the tab's route (`useSelection`); the
// checked rows, the row menu and the toast are the tab's own.
//
// Keys: ↑ ↓ move the selection in both layouts; Shift+↑↓ check a range from the selected row (the
// list) or the marked one (the table); Space checks that row; Cmd+A checks every row shown; Esc
// clears the checks, then closes the panel.

import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { WORKSPACE_PROJECT_ID, type ProjectRef, type SessionStatus } from "pomade-kit/protocol";
import type { HostClient } from "pomade-kit/sdk";

import { SessionsIcon } from "../core/icons.tsx";
import { Menu, type MenuAnchor } from "../core/Menu.tsx";
import { StatePage } from "../core/StatePage.tsx";
import { useBackendInfo } from "../core/useBackendInfo.ts";
import { useNow } from "../core/useNow.ts";
import { useProjects } from "../core/useProjects.ts";
import type { Session } from "../../shared/sessions.ts";
import { BulkBar } from "./BulkBar.tsx";
import { NONE_CHECKED, extended, headerClick, headerState, pruned, targetsOf, toggled as toggledCheck, withAll, withRange, type Checked } from "./check-model.ts";
import { draftNote } from "./detail-model.ts";
import { DetailPanel } from "./DetailPanel.tsx";
import type { RowEvents } from "./row-events.ts";
import { rowMenuEntries } from "./row-menu.tsx";
import { listRows, openTab, revealInTable, step, tableOrder, type PickedTab } from "./selection-model.ts";
import { SessionsList } from "./SessionsList.tsx";
import { SessionsTable } from "./SessionsTable.tsx";
import { formatHeaderSum, groupByStatus, inScope, statusOf, totalCost } from "./table-model.ts";
import { Toast } from "./Toast.tsx";
import styles from "./SessionsTab.module.css";
import { useSelection } from "./useSelection.ts";
import { useSessions } from "./useSessions.ts";
import { useStatusChange } from "./useStatusChange.ts";
import { useStatusDrag } from "./useStatusDrag.ts";
import { useStatusMoves } from "./useStatusMoves.ts";

/** Relative times ("5m") are renewed this often. */
const CLOCK_MS = 30_000;

const NO_PROJECTS: ReadonlyMap<string, ProjectRef> = new Map();
const NO_ROOTS: readonly string[] = [];

const toggled = (set: ReadonlySet<SessionStatus>, status: SessionStatus): Set<SessionStatus> => {
  const next = new Set(set);
  if (!next.delete(status)) next.add(status);
  return next;
};

/** True when a field takes the keys the event's target gets. */
function inAField(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
}

/** The modifiers a key comes with: none, Shift alone, Cmd (Ctrl) alone, or another mix. */
function modifiers(event: KeyboardEvent): "none" | "shift" | "command" | "other" {
  const command = event.metaKey || event.ctrlKey;
  if (event.altKey || (command && event.shiftKey)) return "other";
  if (command) return "command";
  return event.shiftKey ? "shift" : "none";
}

interface OpenMenu {
  session: string;
  anchor: MenuAnchor;
}

export function SessionsTab({ host, route, navigate }: { host: HostClient; route: string; navigate: (route: string) => void }): ReactElement {
  const { copy, update } = useSessions(host);
  const projects = useProjects(host) ?? NO_PROJECTS;
  const names = useMemo(() => new Map([...projects].map(([id, p]) => [id, p.name])), [projects]);
  const backend = useBackendInfo(host);
  const workspaceRoots = useMemo(() => {
    if (backend.status !== "running") return NO_ROOTS;
    const { workspaceReal, workspace } = backend.info;
    return [...new Set([workspaceReal, workspace].filter((root) => root !== null))];
  }, [backend]);
  const now = useNow(CLOCK_MS);
  const scope = host.welcome.project;
  const workspace = scope.id === WORKSPACE_PROJECT_ID;
  const scopeName = workspace ? "Workspace · all projects" : (names.get(scope.id) ?? scope.name);

  const [selectedId, select] = useSelection(route, navigate);
  const [lastSelected, setLastSelected] = useState<string | null>(null);
  const [picked, setPicked] = useState<PickedTab | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<SessionStatus>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<SessionStatus>>(new Set());
  const [noteDraft, setNoteDraft] = useState<{ session: string; text: string } | null>(null);
  const [checkedSet, setChecked] = useState<Checked>(NONE_CHECKED);
  /** Where a Shift range starts: the row last clicked, checked, or moved to with Shift+↑↓. */
  const [anchor, setAnchor] = useState<string | null>(null);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const { change, failure, dismiss } = useStatusChange(host, update);
  const { move, toast } = useStatusMoves(change, dismiss, copy?.byId);

  const groups = groupByStatus(copy?.byId.values() ?? [], scope.id);
  const count = groups.active.length + groups["on-hold"].length + groups.done.length + groups["done-skip"].length;
  const candidate = selectedId === null ? undefined : copy?.byId.get(selectedId);
  const selected = candidate !== undefined && inScope(candidate, scope.id) ? candidate : null;
  const tab = selected === null ? null : openTab(selected, picked);
  // Only sessions the tab lists stay checked.
  const checked = pruned(checkedSet, (id) => {
    const session = copy?.byId.get(id);
    return session !== undefined && inScope(session, scope.id);
  });

  /** The rows shown, top to bottom: the table's, or the open status tab's. */
  const shownOrder = (): string[] =>
    selected === null || tab === null ? tableOrder(groups, collapsed, expanded) : listRows(tab, groups[tab], expanded.has(tab), selected.id).rows.map((s) => s.id);

  const onSelect = (id: string): void => {
    if (failure !== null && !failure.sessions.includes(id)) dismiss();
    setPicked(null);
    setAnchor(id);
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

  const clearChecks = (): void => setChecked(NONE_CHECKED);

  /** Set `status` on `ids` from the bulk bar, the row menu or a drag; the checks clear once a
   *  change of several went through. */
  const setStatusOf = (ids: readonly string[], status: SessionStatus): void => {
    void move(ids, status, "elsewhere").then((ok) => {
      if (ok && ids.length > 1) clearChecks();
    });
  };

  const drag = useStatusDrag(checked, setStatusOf);
  const closeMenu = useCallback(() => setMenu(null), []);

  /** The row a key acts on: the selected one in the list, the marked one in the table. */
  const keyRow = (): string | null => selected?.id ?? lastSelected;

  const events: RowEvents = {
    onClick: (id, event) => {
      if (event.metaKey || event.ctrlKey) {
        setChecked(toggledCheck(checked, id));
        setAnchor(id);
      } else if (event.shiftKey) {
        const from = anchor ?? keyRow() ?? id;
        setChecked(withRange(checked, shownOrder(), from, id));
        setAnchor(from);
      } else {
        onSelect(id);
      }
    },
    onCheck: (id, event) => {
      if (event.shiftKey && anchor !== null) {
        setChecked(withRange(checked, shownOrder(), anchor, id));
      } else {
        setChecked(toggledCheck(checked, id));
        setAnchor(id);
      }
    },
    onMenu: (id, at) => setMenu({ session: id, anchor: at }),
    ...drag.row,
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || menu !== null || inAField(event.target)) return;
      const keys = modifiers(event);
      if (event.key === "Escape" && keys === "none") {
        if (checked.size > 0) clearChecks();
        else if (selected !== null) close();
        else return;
        event.preventDefault();
        return;
      }
      if (event.key === "a" && keys === "command") {
        event.preventDefault();
        setChecked(withAll(checked, shownOrder()));
        return;
      }
      // Space on a focused button presses it.
      if (event.key === " " && keys === "none" && !(event.target instanceof HTMLButtonElement)) {
        const row = keyRow();
        if (row === null) return;
        event.preventDefault();
        setChecked(toggledCheck(checked, row));
        setAnchor(row);
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const order = shownOrder();
      if (keys === "shift") {
        const next = extended(checked, order, keyRow(), direction);
        if (next === null) return;
        event.preventDefault();
        setChecked(next.checked);
        setAnchor(next.at);
        if (selected === null) setLastSelected(next.at);
        else if (next.at !== selected.id) onSelect(next.at);
        return;
      }
      if (keys !== "none") return;
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

  const menuSession = menu === null ? undefined : copy?.byId.get(menu.session);

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
          checked={checked}
          menuOf={menu?.session ?? null}
          events={events}
          drop={drag.drop}
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
          workspaceRoots={workspaceRoots}
          byId={copy.byId}
          inTab={(id) => {
            const session = copy.byId.get(id);
            return session !== undefined && inScope(session, scope.id);
          }}
          onSelect={onSelect}
          onClose={close}
          onSetStatus={(id, status) => void move([id], status, "panel")}
          saveNote={async (id, note) => {
            const session = copy.byId.get(id);
            return session !== undefined && (await change([id], "note", statusOf(session), note)) === null;
          }}
          failure={failure}
          onDraftNote={(session, text) => setNoteDraft(text === null ? null : { session, text })}
        />
      </div>
    );
  } else {
    const order = tableOrder(groups, collapsed, expanded);
    const state = headerState(checked, order);
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
        checked={checked}
        allChecked={state === "mixed" ? "mixed" : state === "true"}
        onCheckAll={() => setChecked(headerClick(checked, order))}
        menuOf={menu?.session ?? null}
        events={events}
        drop={drag.drop}
      />
    );
  }

  return (
    <div className={styles.tab} data-checking={checked.size > 0 ? "" : undefined}>
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
      {checked.size > 0 && (
        <BulkBar
          count={checked.size}
          onSetStatus={(status) => {
            void move([...checked], status, "elsewhere").then((ok) => {
              if (ok) clearChecks();
            });
          }}
          onClear={clearChecks}
        />
      )}
      {body}
      {menu !== null && menuSession !== undefined && (
        <Menu
          label="Session"
          testId="row-menu"
          anchor={menu.anchor}
          onClose={closeMenu}
          entries={rowMenuEntries(menuSession, targetsOf(menuSession.id, checked), { setStatus: setStatusOf })}
        />
      )}
      {toast !== null && <Toast key={toast.key} toast={toast} />}
    </div>
  );
}
