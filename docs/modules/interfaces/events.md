---
doc: docs/modules/interfaces/events.md
audience: engineers, product
holds: the events the app publishes and subscribes to — which are change notices for its own frames, which are for other apps, who subscribes to what, and the timing rules of events B and C
kind: reference
---

# Events

The manifest's `events.publish` and `events.subscribe` are the whole list; `src/shared/manifest.test.ts`
asserts both. Events are live only: a subscriber that is not connected misses the event, and so does
everyone while the backend is not connected to Pomade (logged as `events: could not publish ...`, or
`could not publish <name>: ...` for a change notice). Nothing is read from history after a
reconnect: a frame asks again once its subscription stands. Payloads and the full rules for B and
C: [Published events](../../CONTRACTS.md#published-events) and
[Subscribed events](../../CONTRACTS.md#subscribed-events).

## Published

Subscribers name them `pomade-agents:<name>`.

| Event | Payload | For | Published when |
|---|---|---|---|
| `sessions.changed` | `{ epoch, revision }` | the app's frames | sessions changed; coalesced to one notice per 150 ms (`NOTIFY_MS` in `stores/session-store.ts`) |
| `roster.changed` | `{ epoch, revision }` | the app's frames | `roster.agents` would answer differently |
| `liveNow.changed` | `{ epoch, revision }` | the app's frames | the Live now rows differ; at once |
| `skills.changed` | `{ epoch, revision }` | the app's frames | the list of skill folders (or `foldersOff`) changes, and after every link `skills.link` / `skills.unlink` makes or takes away |
| `roster.creating` | `{ createId, steps }` | the app's frames | each time a step of a `roster.create` starts or ends |
| `session.closed` (B) | `SessionClosedEvent` | other apps | a session's process ended |
| `session.statusChanged` (C) | `StatusChangedEvent` | other apps | a status changed, 5 s after the last change |
| `session.turnFinished` (A) | — | other apps | declared in the manifest, never published |

- **Change notices** (`sessions.changed`, `roster.changed`, `liveNow.changed`, `skills.changed`)
  carry only the revision, not data: a frame behind it asks the matching `sessions.list`,
  `roster.agents`, `liveNow.list` or `skills.catalog` again. `core/backend.ts` publishes them
  through whichever connection is up (dropped silently when none is), each from the `onChange` of
  its source.
  `sessions.agentCounts` names the sessions' `{ epoch, revision }` it is of, so `useAgentCounts` asks again
  on a `sessions.changed` past them.
  `roster.creating` is not a notice: it carries the steps as they are now, and the page takes the
  final ones from `roster.create`'s answer.
- **Events for other apps** are built in `src/backend/sessions/session-events.ts`. A session without
  a usable record is not told of (logged).
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

## Subscribed

| Event | By | For |
|---|---|---|
| `project.created`, `project.renamed`, `project.removed` | the backend (`followPomade`); the frames | the backend reads `project.list` again (only the latest answer lands); the frames refresh project names |
| `project.updated` | the frames only (`useProjects`, the Roster's `useRoster`, the agent page's `useVisibleAgents`) | a project's offered agents, group or name changed: names and Connected to are read again. The backend does not subscribe |
| `agentTab.changed`, `agentTab.exited` | the backend | live state, bound tabs, tab titles, event B |
| `pomade.ready` | the backend | tabs and projects read again, the Live now badge allowed |
| `pomade-runner:run.started`, `pomade-runner:run.finished` | the backend | live entries, placing, event B |
| `pomade-agents:sessions.changed`, `roster.changed`, `liveNow.changed`, `skills.changed`, `roster.creating` | the frames | the app's own notices, above |

- **From Pomade**, taken by `followPomade` (`interfaces/platform.ts`) on every connection and
  dropped with it. On connect it also reads `project.list` and `agentTabs.list`. Where each fact goes
  is the `PlatformFacts` mapping in `core/backend.ts`.
- **From Runner**, through the same bus, parsed by `readRunStarted` / `readRunFinished`
  (`shared/runner-events.ts`) and handled in `sessions/runner-runs.ts`. Only `kind: "agent"` runs
  count; a malformed one is logged and ignored. The app never calls Runner (PLATFORM rule 4).
- **Its own** (`pomade-agents:*`) are subscribed by the UI frames only; the frame subscribes with
  `host.welcome.appId` as the qualifier.
- On disconnect the backend lets go of every held run and tab (`onDisconnect`).

## Capabilities behind them

The manifest's `capabilities` (`project.read`, `agentTabs.read`, `agentTabs.write`, `tabs.open`,
`files.read`, `project.write`) bound what the app asks of Pomade; each is named in
[Manifest](../../CONTRACTS.md#manifest) with the call that needs it. `project.write` is used where a
project's visible agents are written (`project.setAgents`): by the backend's Create (the `projects`
step) and by the frame's Projects tab. `files.read` is the Settings page's folder picker.

Tickets: T-016, T-017, T-018, T-019, T-034, T-035.
