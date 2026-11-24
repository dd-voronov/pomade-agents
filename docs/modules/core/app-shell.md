---
doc: docs/modules/core/app-shell.md
audience: engineers, product
holds: how the app is put together as a Pomade app — manifest, surfaces and routing, the backend process, locations, look, and the shared UI pieces
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

`viewFor` (`routes.ts`) is the whole routing table: the **panel** is always Live now, whatever the
route; a **tab** shows Roster for `roster` and `roster/…`, else Sessions (including `""` and unknown
routes). `sessions/<id>` carries the selected session (`sessionsRoute`, `selectedSessionOf`; the id
is URI-encoded; anything not exactly `sessions/<one segment>` selects nothing). Table of surfaces,
routes and views: [CONTRACTS "Surfaces and routes"](../../CONTRACTS.md#surfaces-and-routes).

How a frame's route moves (`useRoute.ts`, `TabView.tsx`, `openTab.ts`):

- `useRoute(host)` starts at `welcome.route` and follows `host.onRouteChange` — the routes Pomade
  navigates the frame to (the panel's Sessions and Roster buttons, a restored tab).
- `navigate(route)` is the tab **navigating itself**: it sets the view at once and records the route
  with `tabs.setRoute`, so a reload or a Pomade restart reopens the tab there. Pomade sends no
  `route.changed` back; do not wait for one. The Sessions | Roster switch (`TabView`) and the
  session selection (`sessions/useSelection.ts`) both use it.
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
3. Build the live state, bound tabs, session data, Live now, badge, session events, Runner runs and
   tab titles. Their `onChange` hooks publish `sessions.changed`, `roster.changed`, `liveNow.changed`
   through whichever Pomade connection is up; with none, the notice is dropped (a UI frame lives only inside
   a running Pomade and reads everything when it loads).
4. `stayConnected` (`pomade-kit/node`): on every connection it serves the API
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

- **`Menu`** — the context menu: entries (`item`, `head`, `separator`) in a raised box over a
  transparent scrim, opened at a point (right-click) or under an element (⋯), kept inside the window.
  First item takes focus; ↑ ↓ Home End move, Enter or click runs and closes, Esc, Tab, a scrim click,
  window blur or resize closes. Items are `menu-item-<id>` in tests; a checked item is a
  `menuitemradio`.
- **`LiveMark`** — the live-state mark (spinner Working, red dot Needs you, grey dot Idle, nothing for
  Closed), always round so it never reads as a status's square. Words come from `live.ts`
  (`LIVE_LABELS`).
- **`StatePage`** — the one shape of every empty or unavailable state: glyph, title, one or two
  sentences, at most one button; `tone` (`neutral`, `warning`) and `size` (`regular`, `compact` for the
  panel). `NoHost` and `Rejected` are `StatePage`s.
- **`BackendStatus`** — the panel's "Background: running / connecting… / not answering" line.
- **`TabView`** — the tab's bar (Sessions | Roster switch) and its view area.
- **`icons.tsx`** — the app's inline SVG icons; a new glyph goes here, not in a feature folder.
- **Hooks** — `useRoute`, `useBackendInfo`, `useProjects` (project names and roots from `project.list`,
  refreshed on `project.created|renamed|removed`), `useActiveProject`, `useNow` (renews relative times
  such as "5m").

Tests that touch these: `routes.test.ts` (unit); the e2e specs `no-host`, `panel`, `tabs`, `look`,
`backend` ([Testing](testing.md)).

Tickets: T-002, T-029, T-031, T-032.
