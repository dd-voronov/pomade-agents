---
doc: docs/modules/interfaces/index.md
audience: engineers, product
holds: the app's surface towards Pomade, other apps and agents — the published API, the events it publishes and subscribes to, the shared types, the `pomade-agents` command, the format skill and the build check; and the pages that detail each
kind: reference
---

# interfaces

The app's surface towards the platform, other apps, its own UI frames and agents: 36 API methods
served through Pomade's broker, 8 published and 14 subscribed events, one command and one skill.
Shapes, params, errors and semantics are in [CONTRACTS](../../CONTRACTS.md); these pages say where
each lives in code, who reads it and the rules that are easy to break. The manifest
(`public/manifest.json`) is the single source of the method and event lists. It also names the
capabilities the app asks for: `project.read`, `agentTabs.read`, `agentTabs.write`, `tabs.open`,
`files.read` and `project.write` ([Manifest](../../CONTRACTS.md#manifest)).

Code: `src/backend/interfaces/` (`api.ts` the handlers, `platform.ts` what the backend learns from
Pomade), `src/shared/` (names, shapes, guards, events), `src/command/`, `public/` (manifest, icon,
`skills/`), and the wiring in `src/backend/core/backend.ts`. The roster's and the sessions' behaviour
behind the methods is described in [roster](../roster/index.md) and [sessions](../sessions/index.md).

| Page | What it covers |
|---|---|
| [api](api.md) | Every method with who reads it; the API layer: the three lists that must agree, the sources `createApi` reads, validation and error codes, the callers (no method is reserved to its caller); the session-of-a-tab read; what Pomade itself reads; the shared types in `src/shared/`; tests |
| [events](events.md) | The four change notices, `roster.creating` and events A, B and C the app publishes (for its own frames, for other apps), the events it subscribes to from Pomade, Runner and itself, who subscribes to which, the timing of B and C, the capabilities behind them |
| [command](command.md) | The `pomade-agents show` command (target, output, exit statuses, no write path), the `pomade-agents-sessions` format skill and the tests that hold it to the code, the build check that makes `dist/` installable |

## Rules that hold across the pages

- **One list.** The manifest's `api`, `API_METHODS` and the handlers `createApi` returns are the same
  methods in the same order; the manifest's `events` name the events the code publishes and
  subscribes to. `src/shared/manifest.test.ts` fails when the method lists differ and pins the
  manifest's events and capabilities.
- **No caller check.** A handler ignores who calls. Pomade's broker decides who may reach the app
  (the caller's `calls`), and the table in [api](api.md#the-methods) names who reads each method
  today: the app's frames, the command, Pomade, Runner, git.
- **Pomade's reads are checked by the kit.** `roster.list`, `sessions.forRepo` and `sessions.liveIn`
  answer what `pomade-kit/protocol`'s checks accept, unchanged; their shapes are the platform's,
  not this app's.
- **Notices carry no data.** `sessions.changed`, `roster.changed`, `liveNow.changed` and
  `skills.changed` carry `{ epoch, revision }`; a frame asks the read again.
- **The command and the skill answer from the backend and the code.** The command opens no file; the
  skill's tables equal the code's (`skill.test.ts`).

## Tests

By page: [api](api.md#tests), [command](command.md#tests); events B and C are tested in
`src/backend/sessions/session-events.test.ts` and `status-window.test.ts` (fake timers) and
`e2e/for-runner.spec.ts`, `e2e/runner-runs.spec.ts` (Runner's events through the fake Pomade).

Tickets: T-016, T-017, T-018, T-019, T-020, T-021, T-022, T-023, T-024, T-025, T-026, T-027, T-033, T-034, T-035.
