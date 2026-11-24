// The Sessions tab: the header (the scope, its work sessions' count and ~$ sum), the toolbar (search and
// filters) or, while rows are checked, the bulk bar in its row, then — while no session is
// selected — the table of the scope's sessions, or — once one is — the list with the detail panel
// (DESIGN §2.7). A state page shows while the stores are read, when the scope has none, or in the
// table when nothing matches the search and filters. The scope is the project the tab was opened in
// (`welcome.project`); a tab keeps it. The selection is the tab's route (`useSelection`); the
// search, the filters, the checked rows, the menus (a row's, Move to project, a filter's) and the
// toast are the tab's own. A session moved out of the scope leaves the rows, and the panel closes.
//
// While a search or filter is on, the rows are its matches, each group showing all of them, and the
// list shows them grouped instead of one status tab; only matches stay checked.
//
// Hidden sessions (`Session.hidden`) are left out of the rows, the counts, the sums, the search and
// the filters; the header says how many the scope hides, and clicking that shows them in their
// groups, dimmed, until clicked again. The header's count and sum never take them; they count the
// work sessions (`Session.work`) of the rest. A group's ~$ sum is of its work sessions too.
//
// Keys: ↑ ↓ move the selection in both layouts; Shift+↑↓ check a range from the selected row (the
// list) or the marked one (the table); Space checks that row; Enter opens or resumes it; Cmd+A
// checks every row shown; F2 renames that row in the panel; `/` focuses the search; Esc clears the
// checks, then closes the panel.

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactElement } from "react";
import { SESSION_STATUSES, WORKSPACE_PROJECT_ID, type ProjectRef, type SessionStatus } from "pomade-kit/protocol";
import type { HostClient } from "pomade-kit/sdk";

import { SearchIcon, SessionsIcon } from "../core/icons.tsx";
import { sessionsPresetOf } from "../core/routes.ts";
import { Menu, type MenuAnchor, type MenuEntry } from "../core/Menu.tsx";
import { StatePage } from "../core/StatePage.tsx";
import { useBackendInfo } from "../core/useBackendInfo.ts";
import { useNow } from "../core/useNow.ts";
import { useProjects } from "../core/useProjects.ts";
import type { Session } from "../../shared/sessions.ts";
import { BulkBar } from "./BulkBar.tsx";
import { NONE_CHECKED, extended, headerClick, headerState, pruned, targetsOf, toggled as toggledCheck, withAll, withRange, type Checked } from "./check-model.ts";
import { draftNote } from "./detail-model.ts";
import { DetailPanel } from "./DetailPanel.tsx";
import { WORKSPACE_TARGET, moveTargets, nameToSave } from "./edit-model.ts";
import { SearchPattern } from "./Highlight.tsx";
import { isDoubleClick, type RowEvents } from "./row-events.ts";
import { moveMenuEntries, rowMenuEntries } from "./row-menu.tsx";
import { listRows, openTab, revealInTable, step, tableOrder, type PickedTab } from "./selection-model.ts";
import { SessionsList } from "./SessionsList.tsx";
import { SessionsTable } from "./SessionsTable.tsx";
import { NO_FILTERS, filterMenu, folderLabel, folderOf, isFiltering, matches, searchPattern, type Criteria, type FilterKind, type Filters } from "./search-model.ts";
import { formatHeaderSum, groupByStatus, inScope, isListed, statusOf, workCost, workSessions } from "./table-model.ts";
import { Toolbar } from "./Toolbar.tsx";
import { Toast } from "./Toast.tsx";
import styles from "./SessionsTab.module.css";
import { useSelection } from "./useSelection.ts";
import { useOpenSession } from "./useOpenSession.ts";
import { useSessionEdits } from "./useSessionEdits.ts";
import { useSessions } from "./useSessions.ts";
import { useStatusChange } from "./useStatusChange.ts";
import { useStatusDrag } from "./useStatusDrag.ts";
import { useStatusMoves } from "./useStatusMoves.ts";
import { useToast } from "./useToast.ts";

/** Relative times ("5m") are renewed this often. */
const CLOCK_MS = 30_000;

const NO_PROJECTS: ReadonlyMap<string, ProjectRef> = new Map();
const NO_ROOTS: readonly string[] = [];
const NO_SESSIONS: readonly Session[] = [];
/** Every group shows all its rows: a search's or filter's matches are never cut to the latest. */
const EVERY_STATUS: ReadonlySet<SessionStatus> = new Set(SESSION_STATUSES);

const ALL_LABELS: Record<FilterKind, string> = { project: "All projects", agent: "All agents", folder: "All folders" };
const FILTER_MENU_LABELS: Record<FilterKind, string> = { project: "Project filter", agent: "Agent filter", folder: "Folder filter" };

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

/** The menu open now: a row's, Move to project under the detail panel's button, or a filter's
 *  under its button. */
type OpenMenu = { kind: "row" | "move"; session: string; anchor: MenuAnchor } | { kind: "filter"; filter: FilterKind; anchor: MenuAnchor };

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
  /** The session whose name shows as a field in the panel. */
  const [renaming, setRenaming] = useState<string | null>(null);
  /** The session the row menu asked to move: the panel opens Move to project once it shows. */
  const [moveAsked, setMoveAsked] = useState<string | null>(null);
  const toasts = useToast();
  const { toast } = toasts;
  const { change, failure, dismiss } = useStatusChange(host, update);
  const { move } = useStatusMoves(change, dismiss, copy?.byId, toasts);
  const edits = useSessionEdits(host, update, toasts);
  const openSession = useOpenSession(host, update, names, toasts);
  const openById = (id: string): void => {
    const session = copy?.byId.get(id);
    if (session !== undefined) openSession(session);
  };

  const [query, setQuery] = useState("");
  // A route may preset the agent and project filters (`sessions?agent=…`, the agent page's Open in Sessions).
  const [filters, setFilters] = useState<Filters>(() => ({ ...NO_FILTERS, ...sessionsPresetOf(route) }));
  useEffect(() => {
    const preset = sessionsPresetOf(route);
    if (preset !== null) setFilters({ ...NO_FILTERS, ...preset });
  }, [route]);
  const [showHidden, setShowHidden] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const pattern = useMemo(() => searchPattern(query), [query]);
  // Typing stays quick over thousands of sessions: the rows follow the field when React has time.
  const rowsPattern = useDeferredValue(pattern);

  const inTab = useCallback((session: Session) => isListed(session, scope.id, showHidden), [scope.id, showHidden]);
  const inScopeAll = useMemo(() => (copy === null ? NO_SESSIONS : [...copy.byId.values()].filter((session) => inScope(session, scope.id))), [copy, scope.id]);
  /** The sessions the tab lists: the scope's, the hidden ones only while they are shown. */
  const scoped = useMemo(() => inScopeAll.filter(inTab), [inScopeAll, inTab]);
  const groups = groupByStatus(scoped, scope.id);
  /** The work sessions the header counts and sums: never a hidden one. */
  const counted = useMemo(() => workSessions(inScopeAll.filter((session) => session.hidden === null)), [inScopeAll]);
  const count = counted.length;
  const hiddenCount = inScopeAll.filter((session) => session.hidden !== null).length;
  const criteria: Criteria = useMemo(
    () => ({ pattern: rowsPattern, filters, folder: (session) => folderOf(session, workspace, workspaceRoots) }),
    [rowsPattern, filters, workspace, workspaceRoots],
  );
  const filtering = isFiltering(criteria);
  /** The rows the tab shows: the scope's sessions, or a search's or filter's matches. */
  const shown = useMemo(
    () => (isFiltering(criteria) ? groupByStatus(scoped.filter((session) => matches(session, criteria)), scope.id) : null),
    [scoped, criteria, scope.id],
  ) ?? groups;
  const matchTotal = shown.active.length + shown["on-hold"].length + shown.done.length + shown["done-skip"].length;
  const shownExpanded = filtering ? EVERY_STATUS : expanded;
  const candidate = selectedId === null ? undefined : copy?.byId.get(selectedId);
  const selected = candidate !== undefined && inTab(candidate) ? candidate : null;
  const tab = selected === null ? null : openTab(selected, picked);
  // Only sessions the tab lists stay checked.
  const checked = pruned(checkedSet, (id) => {
    const session = copy?.byId.get(id);
    return session !== undefined && inTab(session) && (!filtering || matches(session, criteria));
  });

  /** The rows shown, top to bottom: the table's, the matches in the list, or the open status tab's. */
  const shownOrder = (): string[] =>
    selected === null || tab === null || filtering
      ? tableOrder(shown, collapsed, shownExpanded)
      : listRows(tab, shown[tab], expanded.has(tab), selected.id).rows.map((s) => s.id);

  const clearSearchAndFilters = (): void => {
    setQuery("");
    setFilters(NO_FILTERS);
  };

  const onSelect = (id: string): void => {
    if (failure !== null && !failure.sessions.includes(id)) dismiss();
    if (renaming !== id) setRenaming(null);
    setPicked(null);
    setAnchor(id);
    select(id);
  };

  /** Select the session and show its name as a field. */
  const startRename = (id: string): void => {
    onSelect(id);
    setRenaming(id);
  };

  /** Select the session and open Move to project in its panel. */
  const askMove = (id: string): void => {
    onSelect(id);
    setMoveAsked(id);
  };

  const close = (): void => {
    if (selected === null) return;
    setLastSelected(selected.id);
    const revealed = revealInTable(shown, selected.id, collapsed, shownExpanded);
    setCollapsed(revealed.collapsed);
    if (!filtering) setExpanded(revealed.expanded);
    dismiss();
    setRenaming(null);
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
  const openMove = useCallback((session: string, anchor: DOMRect) => {
    setMoveAsked(null);
    setMenu({ kind: "move", session, anchor });
  }, []);

  /** A moved session that left the scope takes the selection with it — the selection as it is
   *  when the backend answers. */
  const selectedNow = useRef(selectedId);
  selectedNow.current = selectedId;
  const onMoved = (moved: Session): void => {
    if (inScope(moved, scope.id)) return;
    setLastSelected((id) => (id === moved.id ? null : id));
    if (selectedNow.current === moved.id) {
      setRenaming(null);
      select(null);
    }
  };

  /** The row a key acts on: the selected one in the list, the marked one in the table. */
  const keyRow = (): string | null => selected?.id ?? lastSelected;

  /** The row the last single click was on: what a double-click opens (`onTabClick`). */
  const clicked = useRef<string | null>(null);

  /** A double-click opens the row its first click was on. The first click turns the table into the
   *  list, so the second may land on another row, or beside the list. */
  const onTabClick = (event: MouseEvent<HTMLElement>): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (event.detail <= 1) {
      if (target?.closest('[data-testid="session-row"]') == null) clicked.current = null;
      return;
    }
    if (!isDoubleClick(event) || clicked.current === null || target?.closest("button, input, textarea, a") != null) return;
    openById(clicked.current);
  };

  const events: RowEvents = {
    onClick: (id, event) => {
      if (event.detail <= 1) clicked.current = id;
      // The second click of a double-click: `onTabClick` opens the session.
      if (isDoubleClick(event)) return;
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
    onMenu: (id, at) => setMenu({ kind: "row", session: id, anchor: at }),
    onOpen: openById,
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
      if (event.key === "/" && keys === "none") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (event.key === "F2" && keys === "none") {
        const row = keyRow();
        if (row === null) return;
        event.preventDefault();
        startRename(row);
        return;
      }
      // Enter on a focused button presses it.
      if (event.key === "Enter" && keys === "none" && !(event.target instanceof HTMLButtonElement)) {
        const row = keyRow();
        if (row === null) return;
        event.preventDefault();
        openById(row);
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

  const menuSession = menu === null || menu.kind === "filter" ? undefined : copy?.byId.get(menu.session);

  /** A filter's menu: "All …", then every value the tab's sessions hold, each with its count. */
  const filterEntries = (kind: FilterKind): MenuEntry[] => {
    const { all, options } = filterMenu(kind, scoped, criteria, names);
    const set = (value: string | null) => () => setFilters((on) => ({ ...on, [kind]: value }));
    return [
      { kind: "item", id: `filter-${kind}-all`, label: ALL_LABELS[kind], checked: filters[kind] === null, trail: String(all), run: set(null) },
      { kind: "separator" },
      ...options.map(
        (option): MenuEntry => ({ kind: "item", id: `filter-${kind}-${option.key}`, label: option.label, checked: filters[kind] === option.key, trail: String(option.count), run: set(option.key) }),
      ),
    ];
  };

  const filterLabels: Record<FilterKind, string | null> = {
    agent: filters.agent,
    folder: filters.folder === null ? null : folderLabel(filters.folder),
    project: filters.project === null ? null : filters.project === WORKSPACE_PROJECT_ID ? WORKSPACE_TARGET : (names.get(filters.project) ?? filters.project),
  };

  const noMatches = (
    <StatePage
      icon={<SearchIcon size={20} />}
      title="No sessions match"
      testId="sessions-no-match"
      action={{ label: "Clear search and filters", run: clearSearchAndFilters, testId: "no-match-clear" }}
    >
      {rowsPattern !== null
        ? `Nothing in names, messages or notes contains “${query.trim()}”${filters.agent !== null || filters.folder !== null || filters.project !== null ? " with these filters" : ""}.`
        : "No session has this combination of filters."}
    </StatePage>
  );

  let body: ReactElement;
  if (copy === null) {
    body = (
      <StatePage icon={<SessionsIcon size={20} />} title="Reading the session stores…" testId="sessions-reading">
        The agents' sessions show here once their stores are read.
      </StatePage>
    );
  } else if (scoped.length === 0) {
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
          groups={shown}
          tab={tab}
          onOpenTab={(status) => {
            if (filtering) clearSearchAndFilters();
            setPicked({ status, session: selected.id, sessionStatus: statusOf(selected) });
          }}
          selected={selected.id}
          checked={checked}
          menuOf={menu?.kind === "row" ? menu.session : null}
          events={events}
          drop={drag.drop}
          expanded={expanded}
          onToggleExpanded={(status) => setExpanded((set) => toggled(set, status))}
          workspace={workspace}
          names={names}
          byId={copy.byId}
          now={now}
          noteOf={noteOf}
          filtered={filtering}
          collapsed={collapsed}
          onToggleCollapsed={(status) => setCollapsed((set) => toggled(set, status))}
          noMatches={noMatches}
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
            return session !== undefined && inTab(session);
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
          renaming={renaming === selected.id}
          onStartRename={() => setRenaming(selected.id)}
          onSaveName={(text) => {
            setRenaming(null);
            const name = nameToSave(text, selected.record?.name);
            if (name !== undefined) edits.rename(selected, name);
          }}
          onCancelRename={() => setRenaming(null)}
          moveOpen={menu?.kind === "move" && menu.session === selected.id}
          askMove={moveAsked === selected.id}
          onOpenMove={(anchor) => openMove(selected.id, anchor)}
          onOpen={() => openSession(selected)}
        />
      </div>
    );
  } else if (filtering && matchTotal === 0) {
    body = noMatches;
  } else {
    const order = tableOrder(shown, collapsed, shownExpanded);
    const state = headerState(checked, order);
    body = (
      <SessionsTable
        groups={shown}
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
        menuOf={menu?.kind === "row" ? menu.session : null}
        events={events}
        drop={drag.drop}
        filtered={filtering}
      />
    );
  }

  return (
    <div className={styles.tab} data-checking={checked.size > 0 ? "" : undefined} onClick={onTabClick}>
      <header className={styles.head}>
        <h1 className={styles.title}>Sessions</h1>
        <span className={styles.scope} data-testid="sessions-scope">
          {scopeName}
        </span>
        {copy !== null && (
          <span
            className={styles.sum}
            title="Work sessions: every session but Done–skip/Failed"
            data-testid="sessions-count"
            data-count={count}
            data-revision={copy.since.revision}
            data-indexing={copy.indexing ? "" : undefined}
          >
            {copy.indexing && <span className={styles.indexing}>Indexing… </span>}
            {formatHeaderSum(count, workCost(counted))}
          </span>
        )}
        {hiddenCount > 0 && (
          <button
            type="button"
            className={styles.hiddenToggle}
            aria-pressed={showHidden}
            title={showHidden ? "Hide them again" : "Show the sessions hidden from the tab: those with no message and no answer"}
            data-testid="sessions-hidden"
            onClick={() => {
              if (showHidden && selected?.hidden != null) select(null);
              setShowHidden(!showHidden);
            }}
          >
            {hiddenCount} hidden
          </button>
        )}
      </header>
      {copy?.recordsOff != null && (
        <p className={styles.recordsOff} data-testid="sessions-records-off">
          {copy.recordsOff}
        </p>
      )}
      {checked.size > 0 ? (
        <BulkBar
          count={checked.size}
          onSetStatus={(status) => {
            void move([...checked], status, "elsewhere").then((ok) => {
              if (ok) clearChecks();
            });
          }}
          onClear={clearChecks}
        />
      ) : (
        copy !== null &&
        scoped.length > 0 && (
          <Toolbar
            searchRef={searchRef}
            query={query}
            onQuery={setQuery}
            onLeaveDown={() => {
              const first = shownOrder()[0];
              if (first !== undefined) onSelect(first);
            }}
            workspace={workspace}
            labels={filterLabels}
            openFilter={menu?.kind === "filter" ? menu.filter : null}
            onOpenFilter={(filter, anchor) => setMenu({ kind: "filter", filter, anchor })}
            matches={filtering ? matchTotal : null}
            onClear={clearSearchAndFilters}
          />
        )
      )}
      <SearchPattern.Provider value={rowsPattern}>{body}</SearchPattern.Provider>
      {menu?.kind === "row" && menuSession !== undefined && (
        <Menu
          label="Session"
          testId="row-menu"
          anchor={menu.anchor}
          onClose={closeMenu}
          entries={rowMenuEntries(menuSession, targetsOf(menuSession.id, checked), { open: openSession, setStatus: setStatusOf, rename: startRename, move: askMove })}
        />
      )}
      {menu?.kind === "move" && menuSession !== undefined && (
        <Menu
          label="Move to project"
          testId="move-menu"
          anchor={menu.anchor}
          onClose={closeMenu}
          entries={moveMenuEntries(menuSession, moveTargets(projects.values()), (target) => edits.moveTo(menuSession, target, onMoved))}
        />
      )}
      {menu?.kind === "filter" && <Menu label={FILTER_MENU_LABELS[menu.filter]} testId="filter-menu" anchor={menu.anchor} onClose={closeMenu} entries={filterEntries(menu.filter)} />}
      {toast !== null && <Toast key={toast.key} toast={toast} />}
    </div>
  );
}
