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
| `events` | publishes `sessions.changed`; subscribes to `pomade-agents:sessions.changed` (its own, for its UI frames) |
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
| `sessions.summaries` | `{ since?: { epoch, revision } }` | `SessionsAnswer` |

```ts
interface AppInfo {
  version: string;          // the manifest's
  startedAt: string;        // ISO 8601 — when this backend process started
  workspace: string | null; // the open workspace's root, absolute; null when none is open
  dataDir: string | null;   // <workspace>/Apps/pomade-agents; null without a workspace
  stateDir: string;         // <userData>/app-state/pomade-agents
}
```

### Session summaries

What the backend learns from the agents' transcript stores (DESIGN §2.2–2.3). The shapes are in
`src/shared/sessions.ts`. A summary holds only what the transcript says; the session record
(DESIGN §4) is a separate shape, joined to it by `id`.

```ts
type SessionSummary = {
  id: string;                         // the provider's session id
  provider: "claude-code" | "codex";
  agent: string;                      // roster id: claude, codex, or the folder agent's name
  transcript: string;                 // absolute path; unique per summary
  cwd: string | null;                 // start folder: the first recorded working folder
  branch: string | null;              // recorded at the start; null when none recorded
  startedAt: string | null;           // first record time, ISO 8601
  lastActiveAt: string | null;        // last record time
  model: string | null;               // the latest turn's
  effort: string | null;
  tokens: { input; output; cacheRead; cacheWrite };   // summed; input = uncached input
  context: { used: number; window: number } | null;   // latest turn's input-side tokens ÷ window
  costUsd: number | null;             // ~$ est.; null when any turn's model is not in the price table
  firstMessage: { text; at } | null;  // Daniil's first and last real messages
  lastMessage: { text; at } | null;
  lastAnswer: { text; at } | null;    // the agent's last text answer
  malformedLines: number;             // lines that were not JSON, skipped
};

type SessionsAnswer = {
  epoch: string;                      // one backend run; revisions count within it
  revision: number;
  full: boolean;                      // true: every summary — replace; false: changes since `since`
  summaries: SessionSummary[];
  removed: string[];                  // transcripts gone since `since` (empty when full)
  indexing: boolean;                  // the first walk of the stores is still running
};
```

- `since` omitted, from another epoch, or ahead of the backend → a full answer.
- Message texts are trimmed and capped at 4000 characters (a longer one ends in "…").
- Context: Claude — the latest turn's `input + cache read + cache write` ÷ the price table's
  window for its model (none for a model missing from the table); Codex — the latest request's
  input ÷ the `model_context_window` the rollout records.
- Codex sub-agent rollouts (`session_meta.source.subagent`) are not sessions, like Claude's
  `subagents/` transcripts.

**Change notice — `sessions.changed`.** The backend publishes `{ epoch, revision }` at most every
150 ms after summaries changed. The app's frames subscribe to it (the manifest declares the app's
own event in `events.subscribe`) and, when behind it, ask `sessions.summaries` with their `since`.
Events are not replayed, so a frame asks once its subscription stands, and again every second
while the backend does not answer; a restarted backend is another epoch and answers whole.

Adding a method: its name in the manifest's `api` and in `API_METHODS`, its shapes in
`src/shared/`, its handler in `src/backend/interfaces/api.ts`.

## Backend

- **Environment** — what Pomade gives a backend (HOST-API §2 "Backends"). The workspace is
  `POMADE_WORKSPACE`; Pomade's user-data folder is the parent of the folder holding `POMADE_SOCKET`
  (`<userData>/run/pomade.sock`). The agents' stores are under `HOME`.
- **Locations** (`src/backend/core/locations.ts`) — app data in `<workspace>/Apps/pomade-agents/`,
  machine-local state in `<userData>/app-state/pomade-agents/`, the built-in agents' stores under
  `HOME`.
- **Session stores** (`src/backend/stores/`) — `~/.claude/projects/<encoded-cwd>/*.jsonl`,
  `<workspace>/Agents/<name>/projects/<encoded-cwd>/*.jsonl` for every folder agent (a folder with
  a `CLAUDE.md`, not `_shared`, no "template" in its name), `~/.codex/sessions/**/rollout-*.jsonl`.
  One recursive `fs.watch` per store root (FSEvents on macOS: no descriptor per file); a root that
  does not exist yet, and roster changes, are checked every 2 s. Each transcript is read from the
  offset its last parse reached, opened and closed per read.
- **Parse index** — `<stateDir>/session-index.json`: `{ parser, prices, files: { <path>: { mark:
  { ino, offset }, state } } }`. Valid only for the same `PARSER_VERSION` and price-table
  fingerprint; anything else, or a corrupt file, is a cold start. Saved at most every 5 s while
  summaries change, and on stop; it stays when the backend stops.
- **Run record** — `<stateDir>/backend.json`: `{ pid, version, startedAt }`, written atomically at
  start and removed on a requested stop. A record left behind names a backend that crashed or was
  killed.
- **Stop** — on SIGTERM or SIGINT the backend closes its connection, removes its run record and
  exits with status 0.

## Test harness

- `createSandbox(appId)` (`harness/sandbox.ts`) — `{ root, home, workspace, userData, socketPath,
  appKey, backendEnv(), snapshot(folder), cleanup() }`. `home` and `workspace` start as copies of
  `harness/fixtures/`, their stores seeded with three of the synthetic transcripts in
  `harness/fixtures/transcripts/` (`SEEDED_TRANSCRIPTS`), which the unit tests read too.
- `startFakePomade({ manifest, socketPath, appKey, host })` (`harness/fake-pomade/server.ts`) —
  `{ fake, shellSocketUrl, backendCount(), close() }`: pomade-kit's fake host, reached by the
  backend over the unix socket and by frames through the shell page (`harness/shell/`).
- `spawnBackend(sandbox, { entry })` (`harness/backend-process.ts`) — `{ pid, output(), running(),
  stop() }`.
- Playwright fixtures (`e2e/fixtures.ts`): `manifest`, `sandbox`, `pomade`, `backend`, `openShell`.
