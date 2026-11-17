# pomade-agents — Contracts

The interfaces this app offers and the ones its own parts share. Pomade's conventions apply
(`../Pomade/docs/CONTRACTS.md` "Conventions"); the protocol under all of it is the Host API
(`../Pomade/docs/HOST-API.md`).

## Manifest

`public/manifest.json` is the single source of the app's id, name, version and API list; every
build copies it into the app folder. `src/shared/manifest.test.ts` keeps `package.json`'s version
and the backend's handlers in step with it.

| Key | Value |
|---|---|
| `id` · `name` | `pomade-agents` · Agents |
| `hostApi` | `0` |
| `capabilities` | none |
| `strip` | one icon, `agents` — action `panel` |
| `backend` | `backend/main.mjs`, mode `with-pomade` |
| `api` | the methods of "Published API" below |
| `outsideWorkspace` | `~/.claude/`, `~/.codex/`, `~/.zshrc` — the paths outside the workspace the backend uses. The Host API defines no key for them; Pomade lists this one as not supported yet |

## Surfaces and routes

One UI bundle; `welcome.surface` and the frame's route pick the view (`src/ui/core/routes.ts`).

| Surface | Route | View |
|---|---|---|
| panel (the `agents` icon) | any | Live now |
| tab | `sessions`, `""`, anything else | Sessions |
| tab | `roster`, `roster/…` | Roster |

- `sessions` is the route Pomade's History icon opens (HOST-API §4 `apps`, "Platform reads of app
  APIs").
- The app has one tab per project — Pomade's icon-less app tab. `tabs.openApp({ route })` opens it
  or navigates it; the frame follows `route.changed`.

## Published API

Served by the backend through Pomade's broker (`api.serve`); callers use `apps.call`. The UI calls
it the same way. Method names and shapes are in `src/shared/api.ts`.

| Method | Params | Answer |
|---|---|---|
| `app.info` | — | `AppInfo` |

```ts
interface AppInfo {
  version: string;          // the manifest's
  startedAt: string;        // ISO 8601 — when this backend process started
  workspace: string | null; // the open workspace's root, absolute; null when none is open
  dataDir: string | null;   // <workspace>/Apps/pomade-agents; null without a workspace
  stateDir: string;         // <userData>/app-state/pomade-agents
}
```

Adding a method: its name in the manifest's `api` and in `API_METHODS`, its shapes in
`src/shared/api.ts`, its handler in `src/backend/interfaces/api.ts`.

## Backend

- **Environment** — what Pomade gives a backend (HOST-API §2 "Backends"). The workspace is
  `POMADE_WORKSPACE`; Pomade's user-data folder is the parent of the folder holding `POMADE_SOCKET`
  (`<userData>/run/pomade.sock`). The agents' stores are under `HOME`.
- **Locations** (`src/backend/core/locations.ts`) — app data in `<workspace>/Apps/pomade-agents/`,
  machine-local state in `<userData>/app-state/pomade-agents/`.
- **Run record** — `<stateDir>/backend.json`: `{ pid, version, startedAt }`, written atomically at
  start and removed on a requested stop. A record left behind names a backend that crashed or was
  killed.
- **Stop** — on SIGTERM or SIGINT the backend closes its connection, removes its run record and
  exits with status 0.

## Test harness

- `createSandbox(appId)` (`harness/sandbox.ts`) — `{ root, home, workspace, userData, socketPath,
  appKey, backendEnv(), snapshot(folder), cleanup() }`. `home` and `workspace` start as copies of
  `harness/fixtures/`.
- `startFakePomade({ manifest, socketPath, appKey, host })` (`harness/fake-pomade/server.ts`) —
  `{ fake, shellSocketUrl, backendCount(), close() }`: pomade-kit's fake host, reached by the
  backend over the unix socket and by frames through the shell page (`harness/shell/`).
- `spawnBackend(sandbox, { entry })` (`harness/backend-process.ts`) — `{ pid, output(), running(),
  stop() }`.
- Playwright fixtures (`e2e/fixtures.ts`): `manifest`, `sandbox`, `pomade`, `backend`, `openShell`.
