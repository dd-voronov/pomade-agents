---
doc: docs/modules/interfaces/api.md
audience: engineers, product
holds: the published API — every method, who reads it, how the API layer is built, validates and dispatches, which sources it reads, the shared types, what Pomade itself reads
kind: reference
---

# The published API

The backend serves 36 methods through Pomade's broker. Shapes, semantics and error codes per method
are in [CONTRACTS "Published API"](../../CONTRACTS.md#published-api) and the sections it points to;
this page says where each lives in code, how the layer in front of the handlers behaves, and who calls
what.

## How the layer is built

- **Three lists, one order.** `public/manifest.json` `api`, `API_METHODS` (`src/shared/api.ts`) and
  the keys `createApi` returns (`src/backend/interfaces/api.ts`) are the same list in the same order.
  `src/shared/manifest.test.ts` fails when they differ. A method is added in all three, with its
  name constant and shapes in `src/shared/` (one file per family: `api.ts`, `sessions.ts`,
  `work-sessions.ts`, `live-now.ts`, `roster.ts`, `skills.ts`).
- **Serving.** On every Pomade connection `startBackend` calls `connected.api.serve(createApi(...))`
  (`core/backend.ts` `onConnect`). `createApi` takes `ApiSources`, narrowed with `Pick` to what the
  handlers use, so a test passes a fake of that size:

  | Source | Kind | Used by |
  |---|---|---|
  | `info` | the `AppInfo` built at start | `app.info`, `roster.checkAlias` (the workspace) |
  | `sessions` (`SessionData`) | memory | `sessions.*`, `sessions.agentCounts` |
  | `live` (`LiveState`), `liveNow`, `tabs` (`BoundTabs`) | memory | `sessions.liveIn`, `liveNow.list`, `sessions.ofTab` |
  | `realPath` | 30 s cache of resolved folders | `sessions.forRepo`, `liveIn`, `find` |
  | `roster` | memory for `list`, `agent`, `answer`; the provider's files and `agent.yaml` for `updateProfile`, `permissions`, `memory`, `modelConfig`, `setModel` and the orphan methods | `roster.*` |
  | `projects` (`ProjectReads`) | Pomade, through this connection (`project.list`, `project.getAgents`) | `roster.projectsFor`, `agentsFor`, `connections` |
  | `open` | Pomade, through this connection (`agentTabs.focus`, `agentTabs.resume`, `tabs.openAttached`) | `sessions.open` |
  | `skills` (`SkillsCatalogService`) | the disk, read on every call | `skills.catalog`, `settings.setSkillFolders`, `skills.link`, `skills.unlink` |
  | `creation` (`AgentCreationSource`) | the disk and a fresh `zsh`; `null` without a workspace, a data folder or a record store | `roster.checkName`, `create`, `checkAlias` |

  Only `projects` and `open` are built from the connection; `creation` reaches Pomade through the
  connection that is up when a step runs (`project.getAgents`, `project.setAgents`,
  `agentTabs.launch`) and fails the step when there is none.
- **Callers.** The UI frames, the `pomade-agents` command, other apps and Pomade all arrive as
  `apps.call`; there is no second path into the backend. Pomade's broker lets an app call
  another's method only when its manifest's `calls` names it, and refuses a method not in `api`
  (HOST-API §4 "`apps` — the broker"). A handler receives the caller's id as `context.from` and
  ignores it: **no method is reserved to its caller**. "The app's own frames" in the table below is
  who reads it, not who may.
- **Validation.** Params are checked in `api.ts` before a source is touched. `paramsOf` takes only a
  JSON object; each handler then reads its keys with `idOf`, `nameOf`, `textOf`, `timeOf`,
  `folderOf` or its own parser. A malformed value is `HostError("invalid-params")` naming the key;
  an unknown session or agent is `not-found`. Lenient by design: `sessions.list`'s `since` (a
  malformed one reads as none, a full answer). Rules the layer adds on top of the contracts:

  | Method | Checked here |
  |---|---|
  | `sessions.setStatus` | `ids` a non-empty list of non-empty strings (repeats collapse); `status` one of the four; `note` a one-line text of at most 500 characters (trimmed) or `null`, or absent |
  | `sessions.rename` | `name` required: a one-line text of at most 200 characters (trimmed) or `null` |
  | `sessions.moveToProject` | `project` required: a non-empty string or `null` |
  | `sessions.forRepo`, `liveIn`, `find` | `folder` / `cwd` absolute, no line break or NUL; `branch` and `agent` non-empty when given; `startedFrom` / `startedTo` ISO 8601 with a zone, in order |
  | `roster.launchSpec` | `resume` `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`; `sessionId` a UUID and not with `resume`; `prompt` non-blank, at most `AGENT_PROMPT_MAX` (16 384), no NUL; then `launchSpec` refuses an unknown or disabled mode |
  | `roster.checkName` | `name` a string of at most 256 characters; the name rules run in the service |
  | `roster.create` | `name` at most 256; `role` one line, at most 200; `tags` at most 20, one line, at most 40 each, trimmed and each once; `projects` at most 200 non-empty ids; `createId` at most 128; `clone` a non-empty id of at most 256 |
  | `roster.updateProfile` | `checkProfileEdit` (`roster/profile-edit.ts`): `role` one line of at most 200 or `null`; `tags` at most 20, at most 24 characters each, none repeated; `modes` one or more of `normal`, `full-autonomy` mapped to booleans, `normal: false` refused; `hidden` a boolean; at least one key |
  | `roster.setModel` | `model` a name of at most 128 characters (`[A-Za-z0-9][A-Za-z0-9._:@/[\]-]*`) or `null`; `effort` one of `EFFORT_LEVELS` or `null`; at least one |
  | `roster.undoRelink` | `agentText` a non-empty string, `profileText` a string or `null`, each at most `PROFILE_TEXT_MAX` (65 536) |
  | `sessions.agentCounts` | `weekFrom` and `projectsFrom` ISO 8601 with a zone |
  | `settings.setSkillFolders` | `folders` a list of strings; the folder rules are the service's (refusals answer `{ ok: false }`) |

  `roster.checkAlias` resolves the folder itself: the agent must be a non-orphan folder agent the
  roster holds (`not-found` otherwise), and its `configDir` is resolved against the workspace.
  `roster.connections` takes no params and asks `projectsFor`'s question for every agent that is
  not an orphan; without a workspace it answers every agent with `[]` and asks Pomade nothing.
  `creating()` makes the three creation methods `not-ready` while `creation` is absent.
- **Answers.** Every answer is plain JSON. Shapes are type aliases, so they are JSON values to the
  broker as they are; the kit's interface types (`SessionsForRepoResult`, `RosterAgent`) are not,
  hence the `json()` cast in `api.ts` and `as unknown as JsonValue` on the roster answers. The
  three change-writing session methods answer `SessionsUpdated` (the changed sessions as they are
  now), so a caller needs no second read.
- **Types the kit owns.** `sessions.forRepo` and `sessions.liveIn` take their method names, params
  and results from `pomade-kit/protocol`, and `roster.list` answers the kit's `RosterAgent`
  (`ROSTER_LIST_METHOD = ROSTER_METHOD`). Changing any of these shapes is a change to the platform
  contract, not to this app.

## The methods

Params are the caller's; the answer's shape is in CONTRACTS (section named per family). "Reads"
names who calls it today.

### App

| Method | Answer | Reads |
|---|---|---|
| `app.info` | `AppInfo`: version, start time, workspace as Pomade names it and resolved, data folder, state folder ([Published API](../../CONTRACTS.md#published-api)) | the app's frames (`useBackendInfo`) |

### Sessions ([Sessions](../../CONTRACTS.md#sessions))

| Method | What it answers | Reads |
|---|---|---|
| `sessions.list` | every session, or the changes since `{ epoch, revision }` (`SessionsAnswer`) | the Sessions tab |
| `sessions.setStatus` | sets one status on a list of sessions; `SessionsUpdated` | the Sessions tab |
| `sessions.rename` | names or unnames a session and retitles its tabs; `SessionsUpdated` | the Sessions tab |
| `sessions.moveToProject` | sets or clears the project override; `SessionsUpdated` | the Sessions tab |
| `sessions.open` | focuses the session's tab, opens its run's terminal, or resumes it (`SessionsOpenResult`) | the Sessions tab (Open / Resume) |
| `sessions.get` | one `Session` ([Reads for Runner](../../CONTRACTS.md#reads-for-runner)) | the command (`--session`), Runner, git |
| `sessions.lastMessage` | the agent's last answer, capped at 4000 characters | Runner (result cards) |
| `sessions.find` | sessions started exactly in a folder within a time window | Runner (runs without a pre-set id) |
| `sessions.forRepo` | sessions at or below a folder, optionally on a branch ([The sessions contract (git)](../../CONTRACTS.md#the-sessions-contract-git)) | Pomade (git views), git |
| `sessions.liveIn` | live agent tabs and Runner agent runs at or below a folder | Pomade (merge block, In progress), `pomade-git` |
| `sessions.ofTab` | the session bound to an agent tab ([Session of a tab](../../CONTRACTS.md#session-of-a-tab)) | the command (default target) |
| `sessions.agentCounts` | per-agent counts over work sessions in two caller-named windows ([Agent counts](../../CONTRACTS.md#agent-counts)) | the Roster's frames |

### Live now ([Live now](../../CONTRACTS.md#live-now))

| Method | What it answers | Reads |
|---|---|---|
| `liveNow.list` | one row per running agent tab and Runner agent run, whole | the Live now panel |

### Roster ([Roster](../../CONTRACTS.md#roster))

| Method | What it answers | Reads |
|---|---|---|
| `roster.list` | `{ agents: RosterAgent[] }`: agents neither hidden nor orphaned, with their enabled modes | Pomade ("+" menu, launches), Runner |
| `roster.launchSpec` | the command line for one launch (`LaunchSpec`) | Pomade, Runner, the agent page |
| `roster.projectsFor` | the projects an agent is connected to | Runner (job form) |
| `roster.agentsFor` | the agents connected to a project | Runner (job form) |
| `roster.agents` | every agent with its profile, hidden ones and orphans included | the Roster's frames |
| `roster.connections` | every agent's connected projects in one read | the Roster's frames |
| `roster.checkName` | whether a name can be had for a new agent (`NameVerdict`) | the New agent page |
| `roster.create` | creates a folder agent from the template or a clone, answering when every step has run (`CreateAgentResult`) | the New agent page |
| `roster.checkAlias` | whether a fresh zsh resolves the agent's alias (`AliasCheck`) | the New agent page |
| `roster.updateProfile` | edits role, tags, modes, hidden in `agent.yaml`; `{ profile }` | the agent page, the Roster's menus |
| `roster.permissions` | the permissions, MCP servers and plugins of the agent's provider config | the agent page |
| `roster.memory` | the project memory files a Claude Code agent keeps | the agent page |
| `roster.modelConfig` | the agent's default model and effort from its provider config | the agent page |
| `roster.setModel` | sets or removes `model` / `effortLevel` in a Claude Code `settings.json`; the config as written | the agent page |
| `roster.unclaimedFolders` | the agent folders an orphan can be re-linked to | the Roster's menus |
| `roster.relink` | points an orphan's profile at an unclaimed folder; `{ profile, undo }` | the Roster's menus |
| `roster.undoRelink` | takes a re-link back from its `undo`; `{ profile }` | the Roster's menus |
| `roster.removeOrphan` | removes an orphan's profile, never a folder; `{ agent }` | the Roster's menus |

### Skills ([Skills](../../CONTRACTS.md#skills))

| Method | What it answers | Reads |
|---|---|---|
| `skills.catalog` | the listed skill folders, their skills and every Claude Code agent's `skills/` entries | the Settings page, the agent page's Skills tab |
| `settings.setSkillFolders` | replaces the list of skill folders; the catalog or the folder refused | the Settings page |
| `skills.link` | makes a symlink in an agent's `skills/`; the catalog after the write | the Skills tab |
| `skills.unlink` | takes a symlink away; the catalog after the write | the Skills tab |

## Session of a tab

`sessions.ofTab({ tabId })` answers `{ agentTab, session }`: the session bound to the agent tab
Pomade lists under that id. `createApi` takes `BoundTabs.ofTab` (`sessions/bound-tabs.ts`) as
`tabs` and reads the tab's `sessionId` through `sessions.get`. Three outcomes: no agent tab with
that id (a plain terminal's tab, or a tab that is gone) is `{ agentTab: false, session: null }`; an
agent tab not prompted yet, or one naming a session the app has no transcript of, is
`{ agentTab: true, session: null }`; a bound tab is `{ agentTab: true, session }`. An empty or
non-string `tabId` is `invalid-params`. `isSessionsOfTabResult` (`shared/sessions.ts`) rejects a
session without an agent tab. `bound-tabs.ts` holds an exited tab too, so a tab whose agent exited
still answers its session.

## What Pomade itself reads

Pomade calls three methods as the platform ("Platform reads of app APIs", Pomade's HOST-API §4);
each answer must pass the kit's own check unchanged (`checkRosterList`, `checkRepoSessions`,
`checkLiveIn`), which `e2e/for-git.spec.ts` and `e2e/roster.spec.ts` assert:

- `roster.list` — builds the "+" menu. Answered from the in-memory roster; the backend reads the
  roster once before it connects, so the first call is whole. A hidden agent or an orphan is left
  out.
- `sessions.forRepo` — the sessions of a repo and branch, for Pomade's git views; limit 1.5 s.
- `sessions.liveIn` — the live sessions in a folder; limit 1.5 s.

`forRepo` and `liveIn` compare folders with symlinks resolved (`core/real-paths.ts`, 30 s cache).
They list a session the Sessions tab hides, as every read does. Runner reads `sessions.get`,
`lastMessage` and `find` (`e2e/for-runner.spec.ts` drives them as another app through the fake
Pomade), and `roster.launchSpec`, `projectsFor` and `agentsFor` (`e2e/roster.spec.ts`).

## Shared types (`src/shared/`)

Everything the UI, the backend and the command both know, with no Node or DOM imports. Every value
that crossed the broker or came from disk has a guard; a consumer checks before it uses.

| File | Holds |
|---|---|
| `api.ts` | `API_METHODS`, `app.info`, `AppInfo`, `isAppInfo` |
| `sessions.ts` | session method names, `sessions.changed`, `Session` (with `work`), `SessionSummary`, `SessionRecord`, `Attribution`, params and answers, `SESSION_RECORD_KEYS`, `SESSION_NAME_MAX`, `SESSION_NOTE_MAX`, `contextPercent`, guards |
| `work-sessions.ts` | `isWorkSession` (the one rule), `sessions.agentCounts`, `AgentCountsAnswer`, `agentCounts`, `agentsWithSessions`, guards |
| `live-now.ts` | `liveNow.list`, `liveNow.changed`, the row types, the strip icon `LIVE_NOW_ICON` |
| `roster.ts` | roster method names, `roster.changed`, `roster.creating`, `AgentProfile`, `RosterEntry`, `LaunchSpec`, the creation, edit, model, connection and orphan shapes, `CREATE_STEP_IDS`, `CLONED_ENTRIES`, limits (`ROLE_MAX`, `TAG_MAX`, `PROFILE_TEXT_MAX`), guards |
| `agent-name.ts` | the name rules (`nameRuleProblem`, `AGENT_NAME_MAX`, `NEW_AGENT_WORD`) the New agent page and the backend share |
| `model-choices.ts` | `CLAUDE_MODEL_CHOICES`, `EFFORT_LEVELS`, `isEffortLevel` |
| `skills.ts` | skill method names, `skills.changed`, the catalog shapes, `DEFAULT_SKILL_FOLDERS`, guards |
| `session-events.ts` | events A, B and C: names, payloads, `STATUS_WINDOW_MS`, guards |
| `runner-events.ts` | Runner's run events: names, payloads, `readRunStarted` / `readRunFinished` |
| `test-sessions.ts` | builders for tests |

Shapes are type aliases, not interfaces. Guards (`isSession`, `isSessionsAnswer`,
`isAgentCountsAnswer`, `isRosterAgentsAnswer`, `isCreateAgentResult`, `isSkillsCatalog`,
`isStatusChangedEvent`, ...) are what the UI and the command run on an answer before they use it.

## Invariants

- The manifest, `API_METHODS` and `createApi` list the same methods in the same order.
- Pomade's three reads return what the kit's checks accept, unchanged.
- A handler holds no state of its own: session data changes only through `SessionData`, profiles
  and settings only through the roster and the record store, links only through the catalog service.

## Tests

`src/backend/interfaces/api.test.ts` (params, answers, the roster API, the skills links API);
`src/shared/manifest.test.ts` (manifest, `API_METHODS` and `createApi` agree, in order);
`src/shared/api.test.ts`, `sessions.test.ts`, `work-sessions.test.ts`, `roster.test.ts`,
`agent-name.test.ts`, `runner-events.test.ts` (guards, readers, the work-session rule and the
counts, the name rules); `src/backend/sessions/for-git.test.ts`, `bound-tabs.test.ts` (`ofTab`).
End to end through the fake Pomade: `e2e/backend.spec.ts` (`app.info`, the backend's lifecycle),
`e2e/for-git.spec.ts`, `e2e/for-runner.spec.ts`, `e2e/roster.spec.ts`.

Tickets: T-016, T-017, T-018, T-020, T-021, T-022, T-023, T-024, T-025, T-026, T-033, T-035.
