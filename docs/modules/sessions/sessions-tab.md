---
doc: docs/modules/sessions/sessions-tab.md
audience: engineers, product
holds: the Sessions tab — layouts, selection and checks, work-session counts and sums, status changes and Undo, rename and move, search and filters (and the filters a route presets), hidden sessions, Open / Resume, live marks; the model files and the specs that cover them
kind: reference
---

# The Sessions tab

`SessionsTab.tsx` is the tab's one component: it owns the selection (the tab's route), the search, the
filters, the checks, the open menu and the toast, and hands them to presentational components. Every
rule lives in a pure `*-model.ts` file beside it; components only draw. The data comes from
`useSessions` (below); changes go out through `useStatusChange`, `useSessionEdits` and
`useOpenSession`, each an `apps.call` to the app's own backend ([CONTRACTS "Sessions"](../../CONTRACTS.md#sessions)).
Backend side: [session-data](session-data.md). The tab's route grammar (`sessions`, `sessions/<id>`,
`sessions?agent=<id>&project=<id>`) is in [CONTRACTS "Surfaces and routes"](../../CONTRACTS.md#surfaces-and-routes);
the layout intent is [ARCHITECTURE](../../ARCHITECTURE.md) §2.7, the counting rule §2.9.

## Data in the UI

`useSessions` asks `sessions.list` once its `sessions.changed` subscription stands, again on each
notice whose revision is ahead of its copy, and every second while the backend does not answer
(`ANSWER_TIMEOUT_MS` 5 s). `sessions-copy.ts` folds a whole answer (`full`) or a delta (`removed` + changed
sessions) into one `Map` by id. A change method's answer is folded in at once (`update`), so a row
moves before the next notice; nothing changes before the answer, so a refused change leaves every row
as it was. `copy === null` shows "Reading the session stores…"; an empty scope shows "No sessions in
… yet" (with "still being read" while `indexing`); `recordsOff` shows a line under the header.

## Scope, groups, counts

- **Scope** = the project the tab was opened in (`host.welcome.project`); it never changes. The
  Workspace's tab lists every session and adds a Project column and filter (`table-model.ts` `inScope`).
- **Groups** — `groupByStatus`: four status groups, newest `lastActiveAt` first, ties by id. A session
  without a record yet counts as Done (`statusOf`).
- **Header** — "Sessions", the scope name ("Workspace · all projects" in the Workspace's tab), and
  `N work sessions · ~$X est.` (`formatHeaderSum`; "1 work session"; the sum is left out when no
  session has a cost). The count and the sum are over the scope's **work sessions** (`Session.work`,
  [ARCHITECTURE](../../ARCHITECTURE.md) §2.9; `workSessions`, `workCost` in `table-model.ts`): every status but
  Done–skip/Failed, a session without a record yet included, a hidden session never. They ignore the
  search and the filters; the tooltip says "Work sessions: every session but Done–skip/Failed". The
  `data-count` of `sessions-count` is the count.
- **Group sums** — each group header shows the ~$ sum of the work sessions among its rows (`sumText` in
  `StatusGroup.tsx`; hidden rows too while they are shown),
  nothing when none of them has a cost, and "not in totals" when the group holds no work session — which is
  every Done–skip/Failed group, and no other. A group's and a status tab's *row count* is of its rows,
  every status alike. The detail panel's ~$ est. fact adds "not counted in totals" to a session that is
  not a work session (`DetailPanel.tsx` `Facts`).
- **Latest 10** — a Done or Done–skip/Failed group of more than 12 rows (`CUT_ABOVE`) shows its latest
  10 with "Show all N" / "Show the latest 10 only" (`isLong`, `shownRows`). A search shows every match.
- **Empty groups** show one line each (`EMPTY_GROUP_TEXT`).

## Two layouts

| Layout | When | Parts |
|---|---|---|
| Table (`SessionsTable`) | no session selected | sticky column header with a select-all checkbox; four collapsible `StatusGroup`s; `SessionRow`s of 28 px |
| List + detail panel (`SessionsList` + `DetailPanel`) | a session selected | four status tabs with counts (they take dropped rows); the open status's two-line `ListRow`s; the panel |

- **Selection is the tab's route** (`sessions/<id>`, `useSelection`): a click, ↑ ↓ and Esc navigate the
  tab by itself (`tabs.setRoute`; Pomade opens nothing), and a route Pomade sets selects what it names.
  While the selected session is not in the tab's list (moved out, hidden, gone) the table shows and no
  panel does.
- **Columns** leave as the table narrows, in `DROP_ORDER`: effort, model, ~$ est., context, agent. Name
  (min 240 px), Last active and the row's buttons stay (`columnsFor`, measured with a `ResizeObserver`).
- **Which status tab opens** (`openTab`): the selected session's status, unless the user picked another
  tab while that session was selected with that status; a new selection or a status change opens the
  session's own status again. A long tab shows every row when the selected session is past the latest 10.
- **Returning to the table** (`close`, `revealInTable`): the closed session's group is uncollapsed and
  expanded if the row was past the latest 10; the row stays marked (`data-last-selected`) and scrolled
  into view, and ↑ ↓ continue from it. The marked row is the keys' start in the table (`keyRow`).
- **Collapsed and expanded groups** are the tab's state: they survive data changes and the panel.
- **The agent page's Sessions tab** is not this table: it lists one agent's sessions across every
  project from the same `useSessions` copy and the same row formatters (`table-model.ts`), and its
  Project filter is the route `roster/<agent>/sessions?project=<id>` ([CONTRACTS "Surfaces and
  routes"](../../CONTRACTS.md#surfaces-and-routes)). Its **Open in Sessions** button opens this tab in
  the Workspace with the filters preset (below). The page itself is the roster module's.

## Checks

`check-model.ts`: `Checked` is a `Set` in the order checked. Click on the checkbox toggles; Shift+click a
box or a row checks the range from the anchor (`withRange`); Cmd/Ctrl+click toggles; Cmd+A checks every
row shown (`withAll`); the header checkbox checks all or clears (`headerState`: none / mixed / all);
Space checks the key row; Shift+↑↓ checks it and its neighbour and moves on (`extended`), also moving
the selection in the list. **Only listed sessions stay checked** — `pruned` drops ids that left the tab
or, while filtering, no longer match. While any row is checked the `BulkBar` takes the toolbar's row
(so the rows do not shift); Esc clears the checks first, the panel second. The single-selection
(`selected`) and the checks are independent.

## Changing status

One path: `useStatusMoves.move(ids, status, from)` → `useStatusChange.change` → `sessions.setStatus`.

- **Entry points** — panel status buttons (`from: "panel"`), bulk bar, row menu "Set status", drag onto a
  group header (table) or status tab (list) (`from: "elsewhere"`). The menu and a drag act on every
  checked row when the row is one of several checked, else on the row alone (`targetsOf`).
- **Only changes are sent** (`changing`): ids already at the status are skipped; nothing to change
  resolves `true`. Calls run one at a time in order (`queue` in `useStatusChange`).
- **Toast and Undo** — `"<name>" → <Status>` or `N sessions → <Status>`; names are cut at 44 characters.
  Undo sends one `sessions.setStatus` per earlier status (`undoCalls`). The toast shows `TOAST_MS` = 4 s,
  deliberately shorter than the backend's 5 s status window, so an Undo always lands before event C
  goes out and a status back where it was publishes nothing ([session-data](session-data.md) "Events").
- **Checks clear** after a change of several went through (bulk bar, menu, drag); they stay when it was refused.
- **Failures** — `failureText` maps the Host API error code to plain words ("The record file could not
  be written.", …) with the backend's own message as hover. A panel change shows it under the note
  (`Failure` state, cleared when a change of that session goes through or a row outside it is selected);
  any other change shows it in the toast.
- **Note** — one line, 500 characters (`SESSION_NOTE_MAX`); saved on Enter or blur, empty removes it, Esc
  reverts; saving the note re-sends the session's current status (`change([id], "note", status, note)`).
  A status change without `note` keeps it. The row shows the draft as it is typed (`draftNote`).

## Rename and Move to project

`edit-model.ts`, `useSessionEdits.ts`; backend side in [session-data](session-data.md).

- **Rename** — F2, the panel's Rename button, a click on the panel's name or the row menu turn the name
  into a field (`renaming`; `NameField`). Enter or blur saves, Esc keeps, an empty field makes the
  session unnamed (`nameToSave` returns `undefined` for no change). Max length `SESSION_NAME_MAX` = the tab
  title limit. Toast: "Renamed — the tab title follows: “…”" when an agent tab is bound (`inAgentTab`),
  else "Renamed to “…”".
- **Move to project** — menu under the panel's button (the row menu selects the row and asks the panel to
  open it, `moveAsked`): every project in Projects panel order, then "Workspace (no project)"
  (`WORKSPACE_TARGET`). The one it shows in now is checked; a shared-folder session has none checked.
  Toast "Moved to …" with Undo, which sends `moveBack`: the earlier override, or `null` (automatic
  placement) when there was none. A session moved out of the scope leaves the rows and closes the panel (`onMoved`).

## Search and filters

`search-model.ts`; `Toolbar`, `Highlight`.

- **Search** — one phrase, case-insensitive, any run of spaces matching any white space (`searchPattern`).
  Covers name, first message, last message (when different), last agent answer and note
  (`searchTexts`). The field is deferred (`useDeferredValue`) so typing stays quick on thousands of rows.
- **Snippet line** — a hit the row does not already show adds "First message / Last message / Agent: …"
  under it (`snippetOf`); an unnamed row's first message counts as shown for a hit in its first 48
  characters (`FIRST_SHOWN_CHARS`). Matches are marked with `<mark>` (`Highlighted`, via the
  `SearchPattern` context).
- **Filters** — Project (Workspace's tab only), Agent, Folder; each a menu "All …" + every value with
  a count computed over the search and the other filters (`filterMenu`). Folder keys: `p:<rel>` relative
  to the project, `w:<rel>` to the workspace, `a:<abs>`, `none` (`folderOf`; project-relative uses
  `Session.folderInProject`, workspace-relative the workspace root as named and symlink-resolved).
- **Preset by the route** — a route `sessions?agent=<id>&project=<id>` (`sessionsFilterRoute`,
  `sessionsPresetOf` in `src/ui/core/routes.ts`) starts the Agent and Project filters on those values
  (the Folder filter reset, the search untouched): in the tab's first state, and again whenever its
  `route` becomes such a route. A route that presets nothing — `sessions`, `sessions/<id>` — leaves the
  filters as the user has them, so selecting a session keeps them. The filters are state, not route:
  after a reload the tab shows the preset only while the route still is one, and a filter the user
  picked is lost. A preset Project filter applies in a project's own tab too, although that tab shows
  no Project button. Tests: `agent-page.spec.ts`.
- **While filtering** the table shows every match per group; the list drops its status tabs' selection
  (`aria-selected` false) and shows the matches in collapsible groups; opening a status tab clears the
  search and filters. Nothing matching shows "No sessions match" with "Clear search and filters".
  "Clear" and "N matches" show in the toolbar.
- **Keys in the field** — Esc clears, then blurs; ↓ blurs and selects the first row. Enter in the field
  opens nothing (the tab's keys ignore fields).

## Hidden sessions

`Session.hidden` (`"empty"`, from the backend, [session-data](session-data.md) "Hidden rule") leaves a
session out of the rows, counts, sums, search and filters. The header says "N hidden" (every hidden
session of the scope); the toggle (`showHidden`) lists them dimmed in their groups with a "hidden — no
messages" chip, still excluded from the header's count and sum. Hiding them again while one is selected deselects it. A hidden session cannot be
resumed: the panel hint and the toast say why (`openHint`, backend refusal); its bound tab, if any, is
still focused. Its first message or answer makes it a normal row.

## Open / Resume

`open-model.ts`, `useOpenSession.ts`; backend `sessions.open` ([session-data](session-data.md)).
`openKind` mirrors the backend's choice from `Session.tab` and `Session.live`: **Open tab** (bound
tab), **Open run terminal** (live with no tab: a Runner run), **Resume** (Closed). Entry points: the
panel's primary button, the row's hover button, the row menu's first item, Enter on the key row, a
double-click (the first click of a double-click turns the table into the list, so the second may land on
another row; `onTabClick` opens the row the first click was on). The toast names what was done
(`openedText`, "· status set to Active" when a resume changed the status) or why not (`notOpenedText`:
the backend's plain words, Pomade's own words after " — " as hover). The timeout is 10 s: a resume
waits for Pomade to start the agent's tab.

## Live marks

`LiveMark` (core): a spinner for Working, a red dot for Needs you, a grey dot for Idle, nothing for
Closed — round, so it never reads as a status's square. The row's mark title is "Working since 09:05"
(`liveTitle`); the panel's live line gives the state and since when, or, Closed, "last active …"
(`liveLine`). Marker notes in the panel (`markerNotes`): unattended run, fork (link to the parent when
the tab lists it), shared folder, outside Pomade; the same facts show as chips and a fork mark on the row.

## Model files

| File | Rules |
|---|---|
| `table-model.ts` | scope, groups, order, work sessions and their sums (`workSessions`, `workCost`), latest-10, columns, time formats (`formatAgo`, `formatStamp`), chips, labels |
| `selection-model.ts` | ↑ ↓ order and step, open status tab, list rows, reveal in table |
| `check-model.ts` | checks, ranges, header state, targets, toast texts, Undo calls |
| `edit-model.ts` | name to save, move targets, move back, rename and move toasts |
| `detail-model.ts` | panel texts, marker notes, started-in folder, note to save, failure texts |
| `search-model.ts` | search pattern, snippets, folders, filters and their menus |
| `open-model.ts` | open kind, labels, hint, toast texts |
| `sessions-copy.ts` | the UI's copy of the answers |
| `row-menu.tsx` | row menu and Move to project menu entries |

Keyboard shortcuts: [keyboard-shortcuts](../../user-guide/keyboard-shortcuts.md). Layout intent: [ARCHITECTURE](../../ARCHITECTURE.md) §2.7.

## Tests

Unit specs sit beside each model (`*-model.test.ts`, `sessions-copy.test.ts`); `src/shared/work-sessions.test.ts` holds the work-session rule and the counts; `src/ui/core/routes.test.ts` the route functions. End-to-end specs in `e2e/`:

| Spec | Covers |
|---|---|
| `sessions.spec.ts`, `sessions-table.spec.ts` | counts, sums, status groups, columns, latest 10, collapse, live data, empty state |
| `work-sessions.spec.ts` | a session set to Done–skip/Failed leaves the header count and every group sum and returns with its status; `sessions.agentCounts` follows Move to project |
| `session-detail.spec.ts` | panel facts and messages, clamping, status + note persistence, refused change, ↑ ↓ and Esc, route |
| `bulk-status.spec.ts` | checks, ranges, Cmd+A, bulk bar, row menu, drag, Undo, refused bulk change |
| `rename-move.spec.ts`, `move-shared-folder.spec.ts` | rename in place, Move to project and Undo, shared folder |
| `search-filters.spec.ts` | search, snippets, filters, grouped list, checks with a filter |
| `agent-page.spec.ts`, `agent-projects.spec.ts` | Open in Sessions presets the Agent and Project filters; the agent page's Project filter is the route |
| `hidden-sessions.spec.ts` | the "N hidden" toggle and the rule |
| `open-resume.spec.ts`, `pomade/open-resume.spec.ts` | Open tab / Resume / run terminal, Enter, double-click, refusals (fake host; real Pomade) |
| `live-marks.spec.ts` | live marks and the panel's live line |
| `look.spec.ts` | screenshots of every state |
| `tab-titles.spec.ts`, `pomade/tab-titles.spec.ts` | names = tab names |

Tickets: T-004, T-005, T-006, T-007, T-008, T-009, T-010, T-011, T-012, T-013, T-022, T-029, T-030, T-033, T-034.
