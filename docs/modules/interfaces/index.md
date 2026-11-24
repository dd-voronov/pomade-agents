---
doc: docs/modules/interfaces/index.md
audience: engineers, product
holds: how the app's API and events reach Pomade and other apps — the broker handlers, the shared types, published and subscribed events, what Pomade reads, the `pomade-agents` command, the format skill and the build check
kind: reference
---

# interfaces

The app's surface towards the platform and other apps: a set of API methods served through Pomade's
broker, the events it publishes and the ones it subscribes to. Shapes, params, errors and
semantics are in [CONTRACTS](../../CONTRACTS.md); this page says where each lives in code and the
rules that are easy to break.

Code: `src/backend/interfaces/` (`api.ts`, `platform.ts`), `src/shared/`, the wiring in
`src/backend/core/backend.ts`. The `pomade-agents` command (`src/command/`) and the session-data
format skill (`public/skills/pomade-agents-sessions/`) are the app's two other surfaces for agents and
scripts; they are described under [The `pomade-agents` command](#the-pomade-agents-command) and
[The format skill](#the-format-skill).

## The API through the broker

- **Methods.** `public/manifest.json` `api` lists the methods; `API_METHODS` in `src/shared/api.ts`
  is the same list in the same order; `createApi` in `src/backend/interfaces/api.ts` returns one
  handler per method. `src/shared/manifest.test.ts` fails when the three differ. Adding a method
  means all three, plus its shapes in `src/shared/`
  ([CONTRACTS "Roster"](../../CONTRACTS.md#roster), last paragraph).
- **Serving.** On every Pomade connection `startBackend` calls `connected.api.serve(createApi(...))`
  (`core/backend.ts` `onConnect`). The handlers are built per connection because three of them
  need that connection: the project reads of `roster.projectsFor` / `roster.agentsFor`
  (`ProjectReads`), and `sessions.open` (`agentTabs.focus`, `agentTabs.resume`,
  `tabs.openAttached`). Everything else is answered from memory (`ApiSources`).
- **Callers.** The UI frames, Pomade and other apps all go through `apps.call`; there is no
  second path into the backend. A handler never trusts params: each is checked in `api.ts`, and a
  malformed one is `HostError("invalid-params")`; an unknown session or agent is `not-found`.
  `sessions.setStatus`, `rename` and `moveToProject` answer `SessionsUpdated` (the changed sessions as
  they are now), so a caller needs no second read.
- **Methods by family** (shapes: CONTRACTS):
  - `app.info` — [Manifest](../../CONTRACTS.md#manifest) and `AppInfo` in `src/shared/api.ts`.
  - `sessions.list` / `setStatus` / `rename` / `moveToProject` / `open` —
    [Sessions](../../CONTRACTS.md#sessions). `sessions.list` answers whole or as the changes
    since `{ epoch, revision }`; a malformed `since` reads as none (a full answer).
  - `sessions.get` / `lastMessage` / `find` — [Reads for Runner](../../CONTRACTS.md#reads-for-runner).
  - `sessions.ofTab` — [Session of a tab](../../CONTRACTS.md#session-of-a-tab); see below.
  - `sessions.forRepo`, `sessions.liveIn` — [The sessions contract (git)](../../CONTRACTS.md#the-sessions-contract-git).
  - `liveNow.list` — [Live now](../../CONTRACTS.md#live-now).
  - `roster.list` / `launchSpec` / `projectsFor` / `agentsFor` / `agents` — [Roster](../../CONTRACTS.md#roster).
- **Types the kit owns.** `sessions.forRepo` and `sessions.liveIn` take their method names, params
  and results from `pomade-kit/protocol`, and `roster.list` answers the kit's `RosterAgent`
  (`ROSTER_LIST_METHOD = ROSTER_METHOD`). The kit's `JsonValue` does not accept interfaces, hence the
  `json()` cast in `api.ts`. Changing any of these shapes is a change to the platform contract, not
  to this app.

## Session of a tab

`sessions.ofTab({ tabId })` answers `{ agentTab, session }`: the session bound to the agent tab Pomade
lists under that id. `createApi` takes `BoundTabs.ofTab` (`sessions/bound-tabs.ts`) as `tabs` and
reads the tab's `sessionId` through `sessions.get`. Three outcomes: no agent tab with that id (a plain
terminal's tab, or a tab that is gone) is `{ agentTab: false, session: null }`; an agent tab not
prompted yet, or one naming a session the app has no transcript of, is `{ agentTab: true, session: null }`;
a bound tab is `{ agentTab: true, session }`. An empty or non-string `tabId` is `invalid-params`.
`isSessionsOfTabResult` (`shared/sessions.ts`) rejects a session without an agent tab.
`bound-tabs.ts` holds an exited tab too, so a tab whose agent exited still answers its session.

## The `pomade-agents` command

A command for agents and scripts that prints one session. Contract (arguments, output, exit statuses):
[CONTRACTS "Command"](../../CONTRACTS.md#command).

- **Source and build.** `src/command/`: `main.ts` (the entry: connects as role `command` through the
  kit's `connectSocket`, reads `POMADE_TAB_ID`, `resolveWorkspace`), `cli.ts` (`runCli`, arguments,
  `SUB_COMMANDS`, failures, `EXIT`), `session-text.ts` (the text form). `vite.command.config.ts`
  bundles it, `pomade-kit` included, into `dist/cli/pomade-agents.mjs`, the path the manifest's
  `commands` names; `npm run build` runs it after the UI and backend builds. Pomade's shim runs the
  built module; the command has no `node_modules`.
- **It reads nothing itself.** Every answer comes from the backend through `apps.call` to the app's own
  API; the only other call is `project.list`, to name projects in the text form (a failure there leaves
  ids). `runCli` takes its streams, the tab id, the workspace and the connection as `CommandDeps`, so
  the unit tests drive it with no process.
- **Target.** `--session <id>` calls `sessions.get`; without it the tab in `POMADE_TAB_ID` calls
  `sessions.ofTab`. With neither, it fails before connecting, so a terminal outside Pomade fails the
  same with Pomade open or closed.
- **Output.** `--json` prints the `Session` exactly as `sessions.get` answers it; without it,
  `sessionText` prints the name and `label  value` lines in UTC, one line per message, no colour.
- **Exit statuses** (`EXIT` in `cli.ts`; one line on stderr, nothing on stdout): 0 printed, 1 failed
  (Pomade refused the command, no app identity because it was not started through Pomade's shim, an
  answer that fails its guard), 2 usage, 3 Pomade not running (the line names the records folder), 4
  the backend not answering (`app-absent`, `app-not-responding`; 5 s per call), 5 no `--session` and no
  `POMADE_TAB_ID`, 6 the tab has no session, 7 unknown session.
- **No write path.** There is no sub-command that sets a status; an unknown command is usage.

## The format skill

`public/skills/pomade-agents-sessions/SKILL.md` is the master copy. The manifest's `skills` lists its
folder; the UI build copies `public/` into `dist/`, so it ships at `skills/pomade-agents-sessions/` in
the build folder, and Pomade reports the installed folder in `host.info`'s `skills`. Pomade links it
nowhere: giving it to an agent is the user's step ([user guide](../../user-guide/agents-and-scripts.md)).
It teaches an agent with no other doc to read the record files (where, every key, the status values,
Done–skip left out of statistics, reading rules), to use `pomade-agents show` and to read its exit
statuses. `src/command/skill.test.ts` holds its tables to the code: the record keys
(`SESSION_RECORD_KEYS`) in the files' order, the statuses (`SESSION_STATUSES`), every `EXIT` status, the
records folder (`RECORDS_FOLDER`) and the command's usage line.

## The build check

`npm run build` ends with `scripts/check-build.ts`, which fails the build when `dist/` is not an
installable folder (`buildFolderProblems`, `scripts/build-folder.ts`): the manifest parses, every file it
names exists (UI entry, icon, backend, each command's entry), and each skill folder holds a `SKILL.md`
whose frontmatter `name` is the folder's name and whose `description` is present and at most 1024
characters (`skillProblems`). `src/shared/manifest.test.ts` applies `skillProblems` to the master copy,
checks the manifest's `commands` and `skills` entries, and checks that `vite.command.config.ts` builds
`src/command/main.ts` into `dist/cli/pomade-agents.mjs`.

## Shared types (`src/shared/`)

Everything the UI and the backend both know, with no Node or DOM imports.

| File | Holds |
|---|---|
| `api.ts` | `API_METHODS`, `app.info`, `AppInfo`, `isAppInfo` |
| `sessions.ts` | session method names and `sessions.changed`, `Session`, `SessionSummary`, `SessionRecord`, `Attribution`, params and answers, `SESSION_RECORD_KEYS`, `contextPercent`, guards |
| `live-now.ts` | `liveNow.list`, `liveNow.changed`, the row types, the strip icon `LIVE_NOW_ICON` |
| `roster.ts` | roster method names and `roster.changed`, `AgentProfile`, `RosterEntry`, `LaunchSpec`, guards |
| `session-events.ts` | events A, B and C: names, payloads, `STATUS_WINDOW_MS`, guards |
| `runner-events.ts` | Runner's run events: names, payloads, `readRunStarted` / `readRunFinished` |
| `test-sessions.ts` | builders for tests |

Shapes are type aliases, not interfaces, so they are JSON values to the broker as they are. Every
value that crossed the broker or came from disk has a guard (`isSession`, `isSessionsAnswer`,
`isRosterAgentsAnswer`, `isStatusChangedEvent`, ...); a consumer checks before it uses.

## Published events

Declared in the manifest's `events.publish`; subscribers name them `pomade-agents:<name>`. Payloads
and the full rules for B and C: [Published events](../../CONTRACTS.md#published-events).

- **For the app's own UI frames** — `sessions.changed`, `roster.changed`, `liveNow.changed`, each
  `{ epoch, revision }`. They are notices, not data: a frame asks the matching `*.list` / `*.agents`
  again. Published by `core/backend.ts` through whichever connection is up (dropped silently
  when none is). Session changes are coalesced to one notice per 150 ms
  (`NOTIFY_MS` in `stores/session-store.ts`).
- **For other apps** — `session.closed` (B) and `session.statusChanged` (C), built in
  `src/backend/sessions/session-events.ts`. `session.turnFinished` (A) is in the manifest and never
  published.
- **Timing of C.** Every status change goes through the status window
  (`sessions/status-window.ts`): the event goes out `STATUS_WINDOW_MS` = 5 s after the session's last
  change, each change restarts the window, `from` is the status before the first change and `to`
  the one after the last, and a status back at `from` publishes nothing (the Sessions tab's Undo
  relies on it). A requested stop (SIGTERM, SIGINT) publishes every pending change before the
  connection closes; a crash loses them.
- **Timing of B.** Published when the backend hears the end: `agentTab.exited` (reasons `exit`,
  `tab-closed`, `crash`; `quit` is a pause and publishes nothing) or Runner's run finished
  (`run-finished`). A session the app does not know yet is waited for `CLOSED_WAIT_MS` (5 s). One end
  is one B: a tab exit during a run, or within `RUN_END_GRACE_MS` (5 s) after it, publishes nothing.
- **No replay.** A subscriber that is not connected misses the event; so does everyone while the
  backend is not connected to Pomade (logged as `events: could not publish ...`). A session
  without a usable record is not told of (logged).

## Subscribed events

- **From Pomade**, taken by `followPomade` (`interfaces/platform.ts`) on every connection and
  dropped with it: `project.created` / `renamed` / `removed` (the project list is read again; only the
  latest answer lands), `agentTab.changed` / `agentTab.exited` (live state, bound tabs, tab titles,
  event B), and `pomade.ready` (tabs and projects read again, the Live now badge allowed). On
  connect it also reads `project.list` and `agentTabs.list`. Where each fact goes is the
  `PlatformFacts` mapping in `core/backend.ts`.
- **From Runner**, through the same bus: `pomade-runner:run.started` and `run.finished`, parsed by
  `readRunStarted` / `readRunFinished` (`shared/runner-events.ts`) and handled in
  `sessions/runner-runs.ts`. Only `kind: "agent"` runs count; a malformed one is logged and
  ignored. The app never calls Runner. Rules: [Subscribed events](../../CONTRACTS.md#subscribed-events).
- **Its own** (`pomade-agents:*changed`) are subscribed by the UI frames only.
- Events are live only; nothing is read from history after a reconnect, so on disconnect the
  backend lets go of every held run and tab (`onDisconnect`).

## What Pomade itself reads

Pomade calls three methods as the platform ("Platform reads of app APIs", Pomade's HOST-API §4); each
answer must pass the kit's own check unchanged (`checkRosterList`, `checkRepoSessions`,
`checkLiveIn`), which `for-git.test.ts` and `e2e/roster.spec.ts` assert:

- `roster.list` — builds the "+" menu. Answered from the in-memory roster; the backend reads the
  roster once before it connects, so the first call is whole. A hidden agent or an orphan is left out.
- `sessions.forRepo` — the sessions of a repo and branch, for Pomade's git views; limit 1.5 s.
- `sessions.liveIn` — the live sessions in a folder; limit 1.5 s.

`forRepo` and `liveIn` compare folders with symlinks resolved (`core/real-paths.ts`, 30 s cache).
They list a session the Sessions tab hides, as every read does.

## Invariants

- The manifest, `API_METHODS` and `createApi` list the same methods.
- Pomade's three reads return what the kit's checks accept, unchanged.
- A handler changes data only through the session data and the record store (the `sessions`
  module); the interfaces layer holds no state of its own.
- Event payloads carry only JSON; `at` is ISO 8601.
- The command answers only from the backend; it opens no record, transcript or store file.
- The skill's tables equal the code's record keys, statuses and exit statuses (`skill.test.ts`).

## Tests

Unit: `src/backend/interfaces/api.test.ts` (params, answers, the roster API);
`src/shared/manifest.test.ts` (manifest, `API_METHODS` and `createApi` agree, in order),
`api.test.ts`, `sessions.test.ts`, `runner-events.test.ts` (guards and readers);
`src/backend/sessions/session-events.test.ts` and `status-window.test.ts` (events B and C, fake
timers); `sessions/for-git.test.ts`; `sessions/bound-tabs.test.ts` (`ofTab`). The command:
`src/command/cli.test.ts` (arguments, targets, every exit status against a stub link),
`session-text.test.ts` (the text form), `skill.test.ts` (the skill against the code);
`src/shared/manifest.test.ts` (the manifest's command and skill entries, `skillProblems`). End to end through the fake Pomade:
`e2e/for-git.spec.ts`, `e2e/for-runner.spec.ts`, `e2e/roster.spec.ts`, `e2e/runner-runs.spec.ts`,
`e2e/command.spec.ts` (the built command as a child process); inside a real Pomade:
`e2e/pomade/command.spec.ts` ([testing](../core/testing.md#the-pomade-smoke)).

Tickets: T-016, T-017, T-018, T-019, T-027.
