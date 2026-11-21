---
doc: docs/CONTRACTS.md
audience: engineers
holds: the interfaces this app offers and the ones its parts share — manifest, surfaces and routes, published API, backend, test harness
kind: reference
---

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
| `capabilities` | `project.read` (projects, their stable ids, names and folders) · `agentTabs.read` (which session each agent tab is bound to) — the backend's project attribution; the Sessions tab's project names |
| `strip` | one icon, `agents` — action `panel` |
| `events` | publishes `sessions.changed`; subscribes to `pomade-agents:sessions.changed` (its own, for its UI frames), `project.created` and `project.renamed` (the backend, and the UI frames for project names) and, for the backend, `pomade.ready`, `agentTab.changed` |
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
- **A tab's scope** is the project it was opened in, `welcome.project`; the tab keeps it and ignores
  `project.changed`. The Workspace project's tab (`"__workspace__"`) shows every session, with a Project
  column. Project names come from `project.list`, asked again on `project.created` and
  `project.renamed`.
- The app has one tab per project — Pomade's icon-less app tab. `tabs.openApp({ route })` opens it
  or navigates it; the frame follows `route.changed`.

## Published API

Served by the backend through Pomade's broker (`api.serve`); callers use `apps.call`. The UI calls
it the same way. Method names and shapes are in `src/shared/api.ts`.

| Method | Params | Answer |
|---|---|---|
| `app.info` | — | `AppInfo` |
| `sessions.list` | `{ since?: { epoch, revision } }` | `SessionsAnswer` |
| `sessions.setStatus` | `{ ids: string[], status, note?: string \| null }` | `SessionsUpdated` |
| `sessions.rename` | `{ id, name: string \| null }` | `SessionsUpdated` |
| `sessions.moveToProject` | `{ id, project: string \| null }` | `SessionsUpdated` |

```ts
interface AppInfo {
  version: string;          // the manifest's
  startedAt: string;        // ISO 8601 — when this backend process started
  workspace: string | null; // the open workspace's root, absolute; null when none is open
  dataDir: string | null;   // <workspace>/Apps/pomade-agents; null without a workspace
  stateDir: string;         // <userData>/app-state/pomade-agents
}
```

### Sessions

A session joins three things (DESIGN §2.4, §2.6, §4), all shapes in `src/shared/sessions.ts`: what
its transcript says (the summary), the record the app keeps for it, and where it shows.

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
  firstMessage: { text; at } | null;  // the user's first and last real messages
  lastMessage: { text; at } | null;
  lastAnswer: { text; at } | null;    // the agent's last text answer
  malformedLines: number;             // lines that were not JSON, skipped
};

type SessionRecord = {                // the record file's keys (below); an absent key is absent here
  id; provider; agent; name?; status /* the kit's SessionStatus */; note?;
  project?; projectRoot?; projectOverride?: true; launchedFrom?; forkedFrom?;
  startedByRunner?: { job }; outsidePomade?: true; transcript?; cwd?; updated?;
};

type Attribution = {
  projects: string[];                 // stable project ids, sidebar order; [] = the Workspace bucket
  by: "override" | "launched" | "folder" | "remembered" | "workspace";
  sharedFolder: boolean;              // several projects share the start folder's root: shown in each
};

type Session = {
  id: string;
  summary: SessionSummary;            // the latest of the session's transcripts
  record: SessionRecord | null;       // null: no workspace, first run still indexing, or the file cannot be used
  recordProblem: string | null;       // why the record file cannot be used
  attribution: Attribution;
};

type SessionsAnswer = {
  epoch: string;                      // one backend run; revisions count within it
  revision: number;
  full: boolean;                      // true: every session — replace; false: changes since `since`
  sessions: Session[];
  removed: string[];                  // ids of sessions gone since `since` (empty when full)
  indexing: boolean;                  // the first walk of the stores is still running
  recordsOff: string | null;          // why records are not kept now (no workspace, settings.yaml unusable)
};

type SessionsUpdated = { sessions: Session[] };   // the changed sessions as they are now
```

- `since` omitted, from another epoch, or ahead of the backend → a full answer.
- A session is listed while a transcript of it exists. Its record stays on disk when the
  transcripts are gone, and joins again if one comes back.
- Message texts are trimmed and capped at 4000 characters (a longer one ends in "…").
- Context: Claude — the latest turn's `input + cache read + cache write` ÷ the price table's
  window for its model (none for a model missing from the table); Codex — the latest request's
  input ÷ the `model_context_window` the rollout records.
- Codex sub-agent rollouts (`session_meta.source.subagent`) are not sessions, like Claude's
  `subagents/` transcripts.

**Attribution** (`src/backend/sessions/attribution.ts`), in order: Move to project (`override`;
no project = the Workspace) → the project of the first Pomade tab seen bound to the session
(`launched`) → the deepest project folder holding the start folder, every project on it when
several share it (`folder`, `sharedFolder`) → the project the record names, when no project folder
holds the start folder any more — the project was renamed or moved (`remembered`) → the Workspace.
A project that no longer exists never holds a session; a Move to it is dropped. Project folders
are compared absolute with symlinks resolved. A tab in the Workspace scope records
`launchedFrom: "__workspace__"`: the session belongs to the Workspace, in no project.

**Changes.** `sessions.setStatus` sets one status on every id (all are checked first: an unknown id
is `not-found`); `note` — a string sets it (trimmed, one line, at most 500 characters), `null` or
empty removes it, omitted keeps it. `sessions.rename` — a name (trimmed, one line, at most 200
characters, the tab title's limit), `null` or empty for unnamed; it changes the record only (tab
titles are E-002). `sessions.moveToProject` — a project id, `"__workspace__"` for the Workspace
bucket, or `null` for the automatic project again; an unknown project is `not-found`. Errors:
`invalid-params` for malformed params, `not-ready` without a workspace or before the session has a
record, `io-error` when its record file cannot be used. Every status change goes through
`SessionData.changeStatus`.

**Change notice — `sessions.changed`.** The backend publishes `{ epoch, revision }` at most every
150 ms after sessions changed. The app's frames subscribe to it (the manifest declares the app's
own event in `events.subscribe`) and, when behind it, ask `sessions.list` with their `since`.
Events are not replayed, so a frame asks once its subscription stands, and again every second
while the backend does not answer; a restarted backend is another epoch and answers whole.

Adding a method: its name in the manifest's `api` and in `API_METHODS`, its shapes in
`src/shared/`, its handler in `src/backend/interfaces/api.ts`.

## Backend

- **Environment** — what Pomade gives a backend (HOST-API §2 "Backends"). The workspace is
  `POMADE_WORKSPACE`; Pomade's user-data folder is the parent of the folder holding `POMADE_SOCKET`
  (`<userData>/run/pomade.sock`). The agents' stores are under `HOME`.
- **App data** (`src/backend/records/`) — `<workspace>/Apps/pomade-agents/`:
  - `sessions/<session-id>.yaml` — one record per session (DESIGN §4), written when the app first
    sees the session and on every change. YAML 1.2 core schema (times stay strings); a key with no
    value, and `false` for `projectOverride` / `outsidePomade`, read as absent. A rewrite changes
    only the keys whose values change — comments, extra keys, order and quoting stay. New records
    are linked into place (never over a file that is there), changes are written to a temporary
    file and renamed, one at a time per file, each applied to the file as it is on disk then. A
    file that is not valid YAML, not a mapping, or not a record of its session is never written
    over; its session answers `record: null` with `recordProblem`. A record deleted by hand is
    written again with its session's first-sight values.
  - `settings.yaml` — `adoptedAt`: when the first run adopted the sessions that existed. The first
    run waits for the first walk of the stores, writes a Done record for every session found (no
    notice, no prompt), then sets `adoptedAt`, keeping anything else in the file. Afterwards a
    session without a record gets one: Done when it started before `adoptedAt`, else Active and
    `outsidePomade` until a tab is seen bound to it. An unusable `settings.yaml` stops new records
    (`recordsOff` says why) and is never written over.
  - The backend writes these files itself, not through the Host API's file methods (PLATFORM
    rule 3 allows either): records must be written whether or not the socket is up — the first
    run adopts the moment indexing ends — and one writer keeps one set of guarantees. One
    recursive `fs.watch` on the folder re-reads what changes on disk; a file that changed is read
    once more 500 ms later (FSEvents may swallow a second change to a path that just changed).
  - No workspace open: no records, `recordsOff` says so, the change methods are `not-ready`.
- **Pomade** (`src/backend/interfaces/platform.ts`) — on each connection the backend lists the
  projects (again on `project.created`, `project.renamed`, `pomade.ready`) and the agent tabs (again
  on `pomade.ready`), and takes every `agentTab.changed`: the first project each session is seen
  bound in is its `launchedFrom`. A rename refreshes `projectRoot` in the records of that project.
- **Locations** (`src/backend/core/locations.ts`) — app data in `<workspace>/Apps/pomade-agents/`,
  machine-local state in `<userData>/app-state/pomade-agents/`, the built-in agents' stores under
  `HOME`.
- **Session stores** (`src/backend/stores/`) — `~/.claude/projects/<encoded-cwd>/*.jsonl`,
  `<workspace>/Agents/<name>/projects/<encoded-cwd>/*.jsonl` for every folder agent (a folder with
  a `CLAUDE.md`, not `_shared`, no "template" in its name), `~/.codex/sessions/**/rollout-*.jsonl`.
  One recursive `fs.watch` per store root (FSEvents on macOS: no descriptor per file); a root that
  does not exist yet, and roster changes, are checked every 2 s. Each transcript is read from the
  offset its last parse reached, opened and closed per read, and read once more 500 ms after it
  changed.
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
- Playwright fixtures (`e2e/fixtures.ts`): `manifest`, `sandbox`, `pomade`, `backend`, `openShell`, and
  the option `seed` — `test.use({ seed: { into(sandbox) } })` writes into the sandbox before the
  backend starts (`null` by default).
- Transcript helpers (`e2e/transcripts.ts`): `prompt` and `answer` (Claude Code lines; an answer
  carries its model, effort and usage), `claudeSession(sandbox, id, lines)`, `projectFolder(sandbox,
  projectId)`, and `seedIntoProject(sandbox, projectId)`, which moves the seeded transcripts' start
  folders into a fixture project.
