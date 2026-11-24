---
doc: docs/modules/interfaces/index.md
audience: engineers, product
holds: how the app's API and events reach Pomade and other apps — the broker handlers, the shared types, published and subscribed events, what Pomade reads
kind: reference
---

# interfaces

The app's surface towards the platform and other apps: a set of API methods served through Pomade's
broker, the events it publishes and the ones it subscribes to. Shapes, params, errors and
semantics are in [CONTRACTS](../../CONTRACTS.md); this page says where each lives in code and the
rules that are easy to break.

Code: `src/backend/interfaces/` (`api.ts`, `platform.ts`), `src/shared/`, the wiring in
`src/backend/core/backend.ts`. The `pomade-agents` command and the session-data format skill are not
built.

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
  - `sessions.forRepo`, `sessions.liveIn` — [The sessions contract (git)](../../CONTRACTS.md#the-sessions-contract-git).
  - `liveNow.list` — [Live now](../../CONTRACTS.md#live-now).
  - `roster.list` / `launchSpec` / `projectsFor` / `agentsFor` / `agents` — [Roster](../../CONTRACTS.md#roster).
- **Types the kit owns.** `sessions.forRepo` and `sessions.liveIn` take their method names, params
  and results from `pomade-kit/protocol`, and `roster.list` answers the kit's `RosterAgent`
  (`ROSTER_LIST_METHOD = ROSTER_METHOD`). The kit's `JsonValue` does not accept interfaces, hence the
  `json()` cast in `api.ts`. Changing any of these shapes is a change to the platform contract, not
  to this app.

## Shared types (`src/shared/`)

Everything the UI and the backend both know, with no Node or DOM imports.

| File | Holds |
|---|---|
| `api.ts` | `API_METHODS`, `app.info`, `AppInfo`, `isAppInfo` |
| `sessions.ts` | session method names and `sessions.changed`, `Session`, `SessionSummary`, `SessionRecord`, `Attribution`, params and answers, `contextPercent`, guards |
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

## Tests

Unit: `src/backend/interfaces/api.test.ts` (params, answers, the roster API);
`src/shared/manifest.test.ts` (manifest, `API_METHODS` and `createApi` agree, in order),
`api.test.ts`, `sessions.test.ts`, `runner-events.test.ts` (guards and readers);
`src/backend/sessions/session-events.test.ts` and `status-window.test.ts` (events B and C, fake
timers); `sessions/for-git.test.ts`. End to end through the fake Pomade: `e2e/for-git.spec.ts`,
`e2e/for-runner.spec.ts`, `e2e/roster.spec.ts`, `e2e/runner-runs.spec.ts`.

Tickets: T-016, T-017, T-018, T-019.
