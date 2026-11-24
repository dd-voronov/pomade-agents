---
doc: docs/modules/core/app-shell.md
audience: engineers, product
holds: how the app is put together as a Pomade app — manifest, surfaces and routing, the backend process, locations, look, the shared UI pieces, and the app's Settings
kind: reference
---

# App shell

The app is one UI bundle and one Node backend, both built on `pomade-kit`. Pomade hosts the bundle in
frames and starts the backend; the two meet only through Pomade's broker and events. This page is the
map of the parts that belong to no single feature.

## Manifest and capabilities

`public/manifest.json` is the single source of the app's id, name, version, API list and events. The
build copies it into `dist/`; the backend imports the same file for its id and version
(`src/backend/main.ts`); the harness reads it too (`harness/app.ts`). `src/shared/manifest.test.ts`
fails when `package.json`'s version, the `api` list or the handlers `createApi` serves drift from it.
Key by key, with the capability rationale: [CONTRACTS "Manifest"](../../CONTRACTS.md#manifest).

Rules easy to break:

- **Adding an API method, event or capability is a manifest edit first.** The test pins the exact
  lists (`capabilities`, `events.publish`, `events.subscribe`, `api` in handler order).
- **The backend is `with-pomade`** (`backend.entry: backend/main.mjs`): Pomade starts it with the app
  and stops it with the app.
- Capabilities: `project.read`, `agentTabs.read`, `agentTabs.write`, `tabs.open`, `files.read`
  (opening an agent's files in Pomade's editor) and `project.write` (connecting an agent to a
  project: the project's own agents setting).
- `outsideWorkspace` lists `~/.claude/`, `~/.codex/`, `~/.zshrc`, the paths outside the workspace the
  backend reads; Pomade shows them at install. A new path outside the workspace goes here.
- One strip icon, `agents`, action `panel`. There is no tab icon: the tab is opened by the app.

## Surfaces and routing

`src/ui/main.tsx` runs the handshake (`connect()`) once, before React mounts, then renders `App`
(`src/ui/core/App.tsx`), which switches on its outcome:

| Handshake | Renders |
|---|---|
| `no-host` (opened outside Pomade) | `NoHost` — "No Pomade host" |
| `rejected` (`needs-newer-pomade`, `app-too-old`, `unauthorized`) | `Rejected` — one title and sentence per reason (`Unavailable.tsx`) |
| `connected` | `Hosted`: the view `viewFor(welcome.surface, route)` names |

`viewFor` (`routes.ts`) picks the view from the route's first segment: the **panel** is always Live
now, whatever the route; a **tab** shows Settings for `settings`, Roster for `roster` and `roster/…`,
else Sessions (including `""` and unknown routes). `routes.ts` also builds and reads every route
below a view, so no feature parses a route itself:

| Route | Shows | Built / read by |
|---|---|---|
| `sessions` | the Sessions tab | `SESSIONS_ROUTE` |
| `sessions/<id>` | the Sessions tab with that session selected; the id is URI-encoded, and anything not exactly one segment selects nothing | `sessionsRoute`, `selectedSessionOf` |
| `sessions?agent=<id>&project=<id>` | the Sessions tab with its Agent and Project filters preset; either key may be absent | `sessionsFilterRoute`, `sessionsPresetOf` |
| `roster` | the Roster | `ROSTER_ROUTE` |
| `roster/new`, `roster/new?clone=<id>` | the New agent page, empty or as a clone; `new` never names an agent | `newAgentRoute`, `isNewAgentRoute`, `cloneSourceOf` |
| `roster/<agent>/<tab>` | an agent's page on one of `AGENT_TABS` (`overview`, `skills`, `projects`, `model`, `permissions`, `memory`, `sessions`); no tab or an unknown one opens Overview | `agentRoute`, `agentPageOf` |
| `roster/<agent>/sessions?project=<id>` | the agent's Sessions tab filtered to one project | `agentSessionsRoute`, `agentProjectOf` |
| `settings` | the app's Settings page | `SETTINGS_ROUTE` |

Table of surfaces, routes and views: [CONTRACTS "Surfaces and routes"](../../CONTRACTS.md#surfaces-and-routes).

How a frame's route moves (`useRoute.ts`, `TabView.tsx`, `openTab.ts`):

- `useRoute(host)` starts at `welcome.route` and follows `host.onRouteChange` — the routes Pomade
  navigates the frame to (the panel's Sessions and Roster buttons, a restored tab).
- `navigate(route)` is the tab **navigating itself**: it sets the view at once and records the route
  with `tabs.setRoute`, so a reload or a Pomade restart reopens the tab there. Pomade sends no
  `route.changed` back; do not wait for one. The Sessions | Roster switch and the gear (`TabView`),
  the session selection (`sessions/useSelection.ts`) and every link inside the Roster use it.
- `openTab(host, route)` is the panel opening or focusing **the project's one app tab** at a route
  (`tabs.openApp`). Pomade keeps one such tab per project, so both views live in it and the frame
  stays loaded while the route changes.
- A tab's scope is the project it was opened in (`welcome.project`). A panel has none; it follows
  the project in front (`useActiveProject`: the welcome's, then each `project.changed`).

## The backend process

`src/backend/main.ts` is the entry: it calls `startBackend` (`src/backend/core/backend.ts`) and stops
on `SIGTERM`/`SIGINT`. `startBackend` wires the parts in this order and returns `stop()`:

1. Resolve locations; write the run record; log the start.
2. Start the session store (indexing the agents' stores), open the record store, start the roster and
   read it once before connecting — Pomade asks for `roster.list` the moment the backend serves, and
   the first answer must be whole.
3. Start the skill-folder settings (`settings/settings.ts`, on the record store's `settings.yaml`)
   and the skills catalog on top of them and the roster; build agent creation (`roster/create-agent.ts`)
   when a workspace and its app data are there — it connects projects and launches the first tab
   through whichever Pomade connection is up.
4. Build the live state, bound tabs, session data, Live now, badge, session events, Runner runs and
   tab titles. The `onChange` hooks publish `sessions.changed`, `roster.changed`, `liveNow.changed`,
   `skills.changed` and `roster.creating` through whichever Pomade connection is up; with none, the
   notice is dropped (a UI frame lives only inside a running Pomade and reads everything when it
   loads).
5. `stayConnected` (`pomade-kit/node`): on every connection it serves the API
   (`createApi`, `interfaces`), sets the tab-title writer, the badge and `followPomade` (projects,
   agent tabs, Runner's runs). On disconnect it forgets the tabs and runs (Pomade's agents end with
   it) and waits; a returning Pomade lists its tabs again. A refused connection is logged.

Lifecycle with Pomade: Pomade starts the backend with the app (and restarts one that crashed),
stops it on quit and on an update with `SIGTERM`, and kills it after 3 s. A requested stop
publishes the status changes still inside their window first, closes the connection, removes the
run record and exits 0. The backend outlives a Pomade restart: it logs "Pomade went away; reconnecting"
and serves again when the socket is back. Details: [CONTRACTS "Backend"](../../CONTRACTS.md#backend).

The UI side of the same life: `useBackendInfo` asks the app's own `app.info` through the broker
(`apps.call`, 2 s timeout), every 15 s while it answers and every 1 s while it does not; `BackendStatus`
(the panel's footer line) and the Sessions tab show it. `down` carries the broker's error code
(`app-absent`, `app-not-responding`, …) as the hover text.

The backend build is one self-contained ES module (`vite.backend.config.ts`: `ssr.noExternal`,
`dist/backend/main.mjs`), because an installed copy has no `node_modules`. Every import — the kit
included — is bundled; a dependency that cannot be bundled breaks the installed app, which only
the Pomade smoke's "installed" run catches.

## Locations

`resolveLocations` (`src/backend/core/locations.ts`) reads the environment Pomade gives a backend:

| Place | Source | Holds |
|---|---|---|
| State folder | `POMADE_APP_STATE` — `<userData>/app-state/pomade-agents/`. Required and absolute; without it the backend refuses to start (exit 1) | machine-local: the run record `backend.json` (`run-record.ts`), the parse index `session-index.json` |
| Data folder | `<POMADE_WORKSPACE>/Apps/pomade-agents/`; `null` when no workspace is open | synced with the workspace: `sessions/<id>.yaml`, `agents/<id>/agent.yaml`, `settings.yaml` |
| Home | `HOME` | the built-in agents' stores (`~/.claude`, `~/.codex`) and `~/.zshrc` |

Rules: caches never go in the data folder (it syncs across devices); the app writes the data folder
through the backend itself, not the Host API's file methods (files, formats and guarantees: [CONTRACTS "Backend"](../../CONTRACTS.md#backend),
"App data"); with no workspace there are no records and no profiles, and the answers say why
(`recordsOff`, `profilesOff`). The run record names the live process; a record left behind names a
backend that crashed. `removeRunRecord` removes only its own pid's record. `app.info` reports these
locations plus `workspaceReal`; `createRealPaths` (`real-paths.ts`) is the 30 s cache that resolves
start folders' symlinks for every module.

## Look: tokens and theme

The UI takes every color, size and font from the kit's `pomade-kit/tokens.css` (`--bg`, `--text`,
`--accent-active`, `--danger`, …); `src/ui/core/base.css` is the base layer on top (box model, body
font, focus ring, selection). Feature CSS uses the tokens, never literals. `data-surface` on `<html>`
(`panel` or `tab`) picks the background: the panel sits on Pomade's side-panel background, the tab on its pane
background. The theme is Pomade's, via `followTheme(host)`, never the system appearance; with no host
the frame is light. The frame stays blank until the handshake answers (or 1.5 s pass).

## Shared UI pieces (`src/ui/core/`)

Used by `sessions` and `roster`; change one here and every surface changes.

- **`Menu`** — the context menu: entries in a raised box over a transparent scrim, opened at a
  point (right-click) or under an element (⋯, a ▾ button), kept inside the window. Entry kinds:
  `item` (with an optional glyph, tick, trailing key or count, second `detail` line, and `disabled`
  with its reason as the tooltip), `head`, `separator`, `note` (a faint line, such as why a list is
  empty), `search` (a field at the top; the caller filters the entries by its value) and `segment`
  (a row of options of which one is on, picked without closing the menu — a launch's mode).
  The first item takes focus, or the search field when there is one; ↑ ↓ Home End move over enabled
  items, Enter or click runs and closes, Esc, Tab, a scrim click, window blur or resize closes.
  Items are `menu-item-<id>` in tests; a checked item is a `menuitemradio`.
- **`Switch`** — an on/off switch (`role="switch"`); locked, it shows its state, takes no clicks
  and its tooltip says why.
- **`LiveMark`** — the live-state mark (spinner Working, red dot Needs you, grey dot Idle, nothing for
  Closed), always round so it never reads as a status's square. Words come from `live.ts`
  (`LIVE_LABELS`).
- **`StatePage`** — the one shape of every empty or unavailable state: glyph, title, one or two
  sentences, at most one button; `tone` (`neutral`, `warning`) and `size` (`regular`, `compact` for the
  panel). `NoHost` and `Rejected` are `StatePage`s.
- **`BackendStatus`** — the panel's "Background: running / connecting… / not answering" line.
- **`TabView`** — the tab's bar (the Sessions | Roster switch, and the gear that opens Settings)
  and its view area.
- **`copyText`** (`clipboard.ts`) — copies a text from a frame: `navigator.clipboard`, else the
  browser's copy of a selected field.
- **`icons.tsx`** — the app's inline SVG icons; a new glyph goes here, not in a feature folder.
- **Hooks** — `useRoute`, `useBackendInfo`, `useProjects` (each project's name, root and sidebar group
  from `project.list`, refreshed on `project.created|renamed|removed|updated`), `useActiveProject`, `useNow` (renews relative times
  such as "5m").

## Settings

The app's own settings are one page (`src/ui/settings/SettingsPage.tsx`, route `settings`) and one
file, `<workspace>/Apps/pomade-agents/settings.yaml`. The page lists the **skill folders** — the
workspace folders the skills catalog reads, subfolders included — each with its skill count and
the links that point into it ("5 links from 3 agents"). **Add folder…** goes through Pomade's
folder picker; **Remove** first warns, naming the agents, when links depend on the folder, and
keeps the links; every change offers Undo.

- **Backend:** `src/backend/settings/skill-folders.ts` reads and writes the `skillFolders` key
  through the `yaml` document model, so the file's other keys, comments and order stay. An absent
  key is `DEFAULT_SKILL_FOLDERS`; an empty list is a list. `settings.ts` serves the list from the
  record store's copy of the file, follows a hand edit, and writes one change at a time.
- **A folder** is workspace-relative, a folder now, inside the workspace also by its real path,
  never the workspace itself, never `.pomade`, and never inside or around another listed folder —
  each skill belongs to one folder. A listed folder that is gone shows as missing.
- **An unusable `settings.yaml`** is never written over: the catalog reads the default folders and
  `foldersOff` says why the list cannot be changed. The same with no workspace or no app data.
- **UI:** `useSkillsCatalog` asks `skills.catalog`, again on `skills.changed` and whenever the tab
  comes back into view, and every second while the backend does not answer; a change made in the
  frame takes the catalog its answer carries. The agent page's Skills tab uses the same hook
  ([roster](../roster/index.md)).

Interfaces: [CONTRACTS "Skills"](../../CONTRACTS.md#skills). Design: [DESIGN](../../DESIGN.md) §3.8.

Tests that touch this page's parts: `routes.test.ts`, `skill-folders.test.ts`,
`settings-copy.test.ts` (unit); the e2e specs `no-host`, `panel`, `tabs`, `look`, `backend`,
`settings` ([Testing](testing.md)).

Tickets: T-002, T-029, T-031, T-032, T-035.
