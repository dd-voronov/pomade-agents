---
doc: docs/CONTRACTS.md
audience: engineers
holds: the interfaces this app offers and the ones its parts share — manifest, surfaces and routes, published API, published events, backend, test harness
kind: reference
---

# pomade-agents — Contracts

The interfaces this app offers and the ones its own parts share. Pomade's conventions apply
(`../Pomade/docs/CONTRACTS.md` "Conventions"); the protocol under all of it is the Host API
(`../Pomade/docs/HOST-API.md`).

## Manifest

`public/manifest.json` is the single source of the app's id, name, version and API list; every
build copies it into the app folder, with everything else in `public/` (the strip icon, the skill).
`src/shared/manifest.test.ts` keeps `package.json`'s version, the backend's handlers, the command's
build entry and the skill's master copy in step with it; `npm run build` ends with
`scripts/check-build.ts` (`scripts/build-folder.ts`), which fails when `dist/` is not installable:
an invalid manifest, a file it names (UI entry, icon, backend, command entry) missing, or a skill
folder without a `SKILL.md` whose frontmatter `name` is the folder's and whose `description` is set
(at most 1024 characters).

| Key | Value |
|---|---|
| `id` · `name` | `pomade-agents` · Agents |
| `hostApi` | `0` |
| `capabilities` | `project.read` (projects, their stable ids, names and folders, their visible agents) · `agentTabs.read` (each agent tab's session, folder, title and live state) · `agentTabs.write` (an agent tab's title, the unnamed mark) — the backend's project attribution, live state, tab titles and the project ↔ agent connection; the Sessions tab's and Live now's project names · `tabs.open` — Live now focuses agent tabs (`agentTabs.focus`) and opens a Runner run's attached terminal (`tabs.openAttached`); the backend's `sessions.open` does the same and resumes sessions (`agentTabs.resume`) · `files.read` — the Settings page's **Add folder…** asks Pomade's folder picker (`files.pickFolder`) · `project.write` — a new agent is connected to the projects chosen for it (`project.setAgents`, `roster.create`) |
| `strip` | one icon, `agents` — action `panel` |
| `events` | publishes `sessions.changed`, `roster.changed`, `liveNow.changed` and `roster.creating` (for its own UI frames) and `session.turnFinished` (declared, never published), `session.closed`, `session.statusChanged` ("Published events" below); subscribes to `pomade-agents:sessions.changed`, `pomade-agents:roster.changed`, `pomade-agents:liveNow.changed` and `pomade-agents:roster.creating` (its own, for its UI frames), `project.created`, `project.renamed` and `project.removed` (the backend, and the UI frames for project names), `project.updated` (the Roster's frame, for the agents each project offers) and, for the backend, `pomade.ready`, `agentTab.changed`, `agentTab.exited` and Runner's `pomade-runner:run.started`, `pomade-runner:run.finished` ("Subscribed events" below); publishes `skills.changed` and subscribes to `pomade-agents:skills.changed` (its own, for the Settings page and the Skills tab; "Skills" below) |
| `backend` | `backend/main.mjs`, mode `with-pomade` |
| `api` | the methods of "Published API" below — `sessions.forRepo`, `sessions.liveIn` and `roster.list` among them, which Pomade reads (HOST-API §4, "Platform reads of app APIs") |
| `commands` | one, `pomade-agents` — entry `cli/pomade-agents.mjs` ("Command" below) |
| `skills` | one, `skills/pomade-agents-sessions` — the session-data format skill ("Command" below) |
| `outsideWorkspace` | `~/.claude/`, `~/.codex/`, `~/.zshrc` — the paths outside the workspace the backend uses (`~/.zshrc`: a new agent's alias is appended there, "Creating an agent" below); Pomade shows them at install (HOST-API §1) |

## Surfaces and routes

One UI bundle; `welcome.surface` and the frame's route pick the view (`src/ui/core/routes.ts`).

| Surface | Route | View |
|---|---|---|
| panel (the `agents` icon) | any | Live now |
| tab | `sessions`, `""`, anything else | Sessions — the table |
| tab | `sessions/<id>` | Sessions — the list with the detail panel, session `<id>` selected |
| tab | `roster` | Roster |
| tab | `roster/new` | Roster — the New agent page (`NEW_AGENT_ROUTE`) |
| tab | `roster/<agent>`, `roster/<agent>/<tab>` | Roster — the agent's page on `<tab>` (below) |
| tab | any other `roster/…` | Roster |
| tab | `settings` | the app's Settings — the skill folders ("Skills" below) |
| tab | `sessions?agent=<id>&project=<id>` | Sessions — as `sessions`, with the Agent and Project filters preset (below) |

- **The Roster list's navigation** (`RosterActions`, `src/ui/roster/list/actions.ts`): the name and
  **Open ›** of a card or row navigate the tab to `agentRoute(agent, "overview")`, **Connected to** to
  `agentRoute(agent, "projects")`, **New agent** to `NEW_AGENT_ROUTE`.
- `sessions` is the route Pomade's History icon opens (HOST-API §4 `apps`, "Platform reads of app
  APIs").
- **The selection is the route.** `<id>` is the session id, URI-encoded (`sessionsRoute`,
  `selectedSessionOf`). Selecting a session, moving the selection and closing the panel are the
  tab navigating by itself (`useRoute`'s `navigate`, `src/ui/core/useRoute.ts`): the view changes at
  once and Pomade records the route for the tab (`tabs.setRoute(route)`), sending no `route.changed`
  back (`src/ui/sessions/useSelection.ts`). Every `route.changed` selects what its route names. A
  reload and a restart of Pomade open the tab at its last route, so the selection stays. An `<id>`
  the tab's scope does not hold shows the table.
- **A tab's scope** is the project it was opened in, `welcome.project`; the tab keeps it and ignores
  `project.changed`. The Workspace project's tab (`"__workspace__"`) shows every session, with a Project
  column. Project names and roots come from `project.list`, asked again on `project.created`,
  `project.renamed` and `project.removed`; the detail panel's "started in" is the start folder relative to the folder of
  the session's first project, as the backend resolves it (`Session.folderInProject`: symlinks in
  the start folder and in the project's root resolved), else relative to the workspace `app.info`
  names — with symlinks resolved (`workspaceReal`) or as Pomade names it (`workspace`) — else as
  recorded.
- **The agent's page** — `roster/<agent>/<tab>` (`agentRoute`, `agentPageOf`, `src/ui/core/routes.ts`),
  `<agent>` the roster id URI-encoded, `<tab>` one of `overview`, `skills`, `projects`, `model`,
  `permissions`, `memory`, `sessions` (`AGENT_TABS`, in the page's order). A route with no tab, or
  one this build does not know, opens `overview`; `roster/new` is not an agent. Switching tabs and
  ← Roster are the tab navigating by itself (`navigate`, `tabs.setRoute`), so a reload and a
  restart of Pomade open the same tab. An `<agent>` the roster does not hold shows "No such agent"
  with a way back. The page (`src/ui/roster/agent-page/`) reads `roster.agents` and
  `roster.changed` like the Roster, and `roster.permissions` / `roster.memory` /
  `roster.modelConfig` / `roster.launchSpec` for its tabs; each
  tab is one file under `tabs.tsx` that takes an `AgentContext` (`agent-context.ts`).
- **Open in the editor** — Open CLAUDE.md, Open agent.yaml, Open `settings.json` and a memory
  file are `tabs.openFile` in the project in front (HOST-API §4): the path is workspace-relative
  inside the workspace (as Pomade names it, or resolved), else absolute (`openPathOf`). A refusal
  (`not-found`, `outside-workspace`, …) is a toast naming the file.
- **Open in Sessions** — `tabs.openApp({ route: sessionsFilterRoute({ agent, project? }), projectId:
  "__workspace__" })`: the Workspace project's tab at `sessions?agent=<id>[&project=<id>]` (ids
  URI-encoded). The Sessions tab starts its Agent and Project filters on those values
  (`sessionsPresetOf`) — on mount, and again whenever the tab is navigated to such a route; every
  other Sessions route leaves the filters as they are.
- **Status and note** are set through `sessions.setStatus` ("Sessions" below) — a status from the
  detail panel, the bulk bar, the row menu or a drag onto a status, the note from the panel — one
  call at a time; a status change of several sessions is one call with every id whose status
  differs, without `note`. The frame takes the changed sessions from its answer, so the rows move
  at once, and a refused change leaves the rows as they were. The panel, or for a change made
  elsewhere the toast, says what was not done and why in plain words, by the error's code
  (`failureText`, `src/ui/sessions/detail-model.ts`: `io-error` "The record file could not be
  written.", `not-ready`, `not-found`, `app-absent`, `app-not-responding`, else "Something went
  wrong."); the backend's message is its hover text.
- **Undo.** Every status change shows a toast for 4 s (`TOAST_MS`,
  `src/ui/sessions/useToast.ts`) with Undo, which sets each session's earlier status back —
  one `sessions.setStatus` per earlier status. The toast leaves before the backend's 5 s window
  ("Published events", C) can close, so an Undo lands inside it and `session.statusChanged` is
  never published for the change taken back.
- **Name and project** are set through `sessions.rename` and `sessions.moveToProject` ("Sessions"
  below), one session at a time, from the detail panel (Rename, a click on the name, F2; Move to
  project) or the row menu (`src/ui/sessions/useSessionEdits.ts`). The frame takes the session from
  the answer; a toast says what was done, or what was not and why (`failureText`). A move's toast
  has Undo, which moves the session back where the record had it: the project or Workspace the user
  had chosen (`projectOverride`), else `null` — its automatic project.
- **Open / Resume** — the detail panel's primary button ("Open tab", "Open run terminal" or
  "Resume", with "Resume sets the status back to Active." under it for a session it will set
  Active), a table row's hover button before ⋯, the row menu's first entry (the menu on one
  session), Enter on the selected row (the marked one in the table), and a double-click — which
  opens the row its first click was on, since that click turns the table into the list. Each is
  one `sessions.open` ("Sessions" below; `src/ui/sessions/useOpenSession.ts`): the label follows
  `Session.tab` (bound: "Open tab"), else its live state (live with no tab: a Runner run), else
  "Resume". The frame takes the session from the answer; the toast says what was done ("Focused
  the open tab “…”", "Resumed in a new agent tab in <project> · status set to Active", "Opened
  the terminal of the run “…”"), or "The session was not opened." and the backend's plain words
  — what follows " — " in its message (Pomade's own words) shows on hover only.
- **Live now** (the panel) follows the project in front — `welcome.project`, then each
  `project.changed` — for its group order and "current" tag. A row's click is `agentTabs.focus` of
  its tab (Pomade switches to the tab's project); a group header's is `agentTabs.focus` of the
  group's first row, since the Host API has no call that only switches project. Its rows come from
  `liveNow.list` ("Live now" below).
- **`roster/new` wins over `roster/<agent>`**: no agent is ever named `new` (the name rules refuse
  it, "Creating an agent" below). The page's Roster crumb, Cancel and Back to Roster go to `roster`;
  Open its page goes to `roster/<agent>/overview` (`createdAgentRoute`). All are the tab navigating
  by itself.
- The app has one tab per project — Pomade's icon-less app tab. `tabs.openApp({ route })` opens it
  or navigates it (the panel's Sessions and Roster); the frame follows `route.changed`. The tab's
  Sessions | Roster switch is the tab navigating by itself (`navigate`, `tabs.setRoute`), as the
  selection is (`src/ui/core/TabView.tsx`).
- **Settings** — the gear at the right end of that bar navigates the tab to `settings` the same
  way; while it is open neither Sessions nor Roster is marked current and the gear is
  (`aria-current="page"`).

## Published API

Served by the backend through Pomade's broker (`api.serve`); callers use `apps.call`. The UI calls
it the same way. Method names and shapes are in `src/shared/api.ts`, `src/shared/sessions.ts`,
`src/shared/roster.ts` and `src/shared/work-sessions.ts`; the sessions contract's and `RosterAgent` are `pomade-kit/protocol`'s.

| Method | Params | Answer |
|---|---|---|
| `app.info` | — | `AppInfo` |
| `sessions.list` | `{ since?: { epoch, revision } }` | `SessionsAnswer` |
| `sessions.setStatus` | `{ ids: string[], status, note?: string \| null }` | `SessionsUpdated` |
| `sessions.rename` | `{ id, name: string \| null }` | `SessionsUpdated` |
| `sessions.moveToProject` | `{ id, project: string \| null }` | `SessionsUpdated` |
| `sessions.open` | `SessionsOpenParams` `{ id }` | `SessionsOpenResult` `{ opened, tabId, session }` |
| `sessions.forRepo` | `SessionsForRepoParams` `{ folder, branch? }` | `SessionsForRepoResult` `{ sessions: RepoSession[] }` |
| `sessions.liveIn` | `SessionsLiveInParams` `{ folder }` | `SessionsLiveInResult` `{ live, sessions: LiveSession[] }` |
| `sessions.get` | `SessionsGetParams` `{ id }` | `SessionsGetResult` `{ session: Session }` |
| `sessions.lastMessage` | `SessionsLastMessageParams` `{ id }` | `SessionsLastMessageResult` `{ message: { text, at } \| null }` |
| `sessions.find` | `SessionsFindParams` `{ cwd, startedFrom, startedTo, agent? }` | `SessionsFindResult` `{ sessions: FoundSession[] }` |
| `liveNow.list` | — | `LiveNowAnswer` (the app's own frames) |
| `roster.list` | `{}` | `{ agents: RosterAgent[] }` (the kit's) |
| `roster.launchSpec` | `LaunchSpecParams` `{ agent, mode, resume?, sessionId?, prompt? }` | `LaunchSpec` `{ command, args, line, sessionId, exit }` |
| `roster.projectsFor` | `RosterProjectsForParams` `{ agent }` | `RosterProjectsForResult` `{ projects: string[] }` |
| `roster.agentsFor` | `RosterAgentsForParams` `{ project }` | `RosterAgentsForResult` `{ agents: string[] }` |
| `roster.agents` | — | `RosterAgentsAnswer` (the app's own frames) |
| `sessions.ofTab` | `SessionsOfTabParams` `{ tabId }` | `SessionsOfTabResult` `{ agentTab, session: Session \| null }` (the command) |
| `sessions.agentCounts` | `AgentCountsParams` `{ weekFrom, projectsFrom }` | `AgentCountsAnswer` (the app's own frames) |
| `skills.catalog` | — | `SkillsCatalog` (the app's own frames) |
| `settings.setSkillFolders` | `SetSkillFoldersParams` `{ folders: string[] }` | `SetSkillFoldersResult` (the app's own frames) |
| `roster.checkName` | `{ name }` | `NameVerdict` `{ name, problem, detail }` (the app's own frames) |
| `roster.create` | `CreateAgentParams` `{ name, role, tags, projects, createId }` | `CreateAgentResult` (the app's own frames) |
| `roster.checkAlias` | `AliasCheckParams` `{ agent }` | `AliasCheck` `{ ok, aliasLine, rcFile, detail }` (the app's own frames) |
| `roster.updateProfile` | `RosterUpdateProfileParams` `{ agent, role?: string \| null, tags?: string[], modes?: { [mode]: boolean } }` | `RosterUpdateProfileResult` `{ profile: AgentProfile }` (the app's own frames) |
| `roster.permissions` | `{ agent }` | `AgentPermissions` (the app's own frames) |
| `roster.memory` | `{ agent }` | `AgentMemory` (the app's own frames) |
| `roster.modelConfig` | `{ agent }` | `AgentModelConfig` (the app's own frames) |
| `roster.setModel` | `RosterSetModelParams` `{ agent, model?: string \| null, effort?: string \| null }` | `AgentModelConfig` (the app's own frames) |
| `skills.link` | `SkillLinkParams` `{ agent, name, target }` | `SkillLinkResult` (the app's own frames) |
| `skills.unlink` | `SkillUnlinkParams` `{ agent, name }` | `SkillLinkResult` (the app's own frames) |
| `roster.connections` | — | `RosterConnectionsAnswer` `{ connections: { agent, projects }[] }` (the app's own frames) |

```ts
interface AppInfo {
  version: string;          // the manifest's
  startedAt: string;        // ISO 8601 — when this backend process started
  workspace: string | null; // the open workspace's root, absolute, as Pomade names it; null when none is open
  workspaceReal: string | null; // the same root with symlinks resolved (how transcripts record folders in it); workspace when it cannot be resolved
  dataDir: string | null;   // <workspace>/Apps/pomade-agents; null without a workspace
  stateDir: string;         // <userData>/app-state/pomade-agents
}
```

### Sessions

A session joins four things (DESIGN §2.4, §2.6, §4), all shapes in `src/shared/sessions.ts`: what
its transcript says (the summary), the record the app keeps for it, where it shows, and what it is
doing now (its live state).

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
  folderInProject: string | null;     // the start folder relative to the folder of attribution.projects[0], both
                                      // with symlinks resolved: "" at its root; null: no project, or it does not hold it
  live: SessionLiveState;             // the kit's: working · needs-you · idle · closed
  liveSince: string | null;           // when the backend saw it enter `live`; null: Closed, not seen live this run
  tab: { tabId: string; projectId: string } | null;  // the agent tab Pomade lists bound to it (a live one
                                      // first, then the first listed); null: none
  hidden: "empty" | null;             // why the Sessions tab hides it (`HiddenReason`); null: shown
  work: boolean;                      // a work session: it counts (`isWorkSession`, below)
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

type SessionsOpenResult = {
  opened: "tab" | "run" | "resumed";  // its tab focused · its Runner run's terminal opened · resumed in a new tab
  tabId: string | null;               // the agent tab in front now; null for a run's terminal
  session: Session;                   // as it is now: a resumed one Active
};
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
- **Hidden** (`src/backend/sessions/hidden.ts`) — why the Sessions tab leaves a session out,
  from its summary: `"empty"` when it holds no message of the user's and no answer
  (`firstMessage`, `lastMessage` and `lastAnswer` all `null`) — a file that holds only a `/clear`.
  The first message or answer makes it `null`, a change like any other. The field only marks the
  session: every read lists a hidden session as any other — `sessions.list`, `sessions.get`,
  `sessions.find`, `sessions.forRepo`, `sessions.liveIn`, Live now — and only the Sessions tab
  leaves it out (DESIGN §2.7).
- **Work session** (`isWorkSession` in `src/shared/work-sessions.ts`; DESIGN §2.9) — whether the
  session counts: every session is one unless its record's status is `done-skip`; a session
  without a record counts. The backend sets `work` from it whenever it builds a session, so a
  status change changes `work` like any other field. Every count and sum the app shows is over
  sessions with `work: true` — the Sessions tab's header count and ~$ sum (of its listed, unhidden
  sessions) and each status group's ~$ sum ("not in totals" for a group that holds none), and
  `sessions.agentCounts` ("Agent counts" below). A hidden session is a work session all the same;
  only the Sessions tab leaves it out of its own counts. A group's and a status tab's row count is
  of its rows, every status alike.

**Attribution** (`src/backend/sessions/attribution.ts`), in order: Move to project (`override`;
no project = the Workspace) → the project of the first Pomade tab seen bound to the session
(`launched`) → the deepest project folder holding the start folder, every project on it when
several share it (`folder`, `sharedFolder`) → the project the record names, when no project folder
holds the start folder any more — the project was renamed or moved (`remembered`) → the Workspace.
A project that no longer exists never holds a session; a Move to it is dropped. The start folder
and the project folders are compared absolute with symlinks resolved (the workspace's and the
project root's alike); each start folder is resolved once per backend run — until it is, the
session is placed by the folder as recorded and its record is not written — and one that does not
exist stands as it is. The record keeps the start folder as recorded (`cwd`). A tab in the Workspace scope records
`launchedFrom: "__workspace__"`: the session belongs to the Workspace, in no project.

**Changes.** `sessions.setStatus` sets one status on every id (all are checked first: an unknown id
is `not-found`); `note` — a string sets it (trimmed, one line, at most 500 characters), `null` or
empty removes it, omitted keeps it. `sessions.rename` — a name (trimmed, one line, at most 200
characters, the tab title's limit), `null` or empty for unnamed; the record changes, then every
agent tab bound to the session is retitled ("Tab titles" below). `sessions.moveToProject` — a project id, `"__workspace__"` for the Workspace
bucket, or `null` for the automatic project again; an unknown project is `not-found`. Errors:
`invalid-params` for malformed params, `not-ready` without a workspace or before the session has a
record, `io-error` when its record file cannot be used. Every status change goes through
`SessionData.changeStatus`.

**Open / Resume — `sessions.open`** (`src/backend/sessions/open.ts`; DESIGN §2.1), through the
connection the API is served on:

- `Session.tab` set → `agentTabs.focus` of that tab (`opened: "tab"`); no status change. A tab
  that left the list meanwhile (`not-found`) is passed over.
- No tab, and a Runner agent run of the session is live → `tabs.openAttached` of the run's
  terminal (its job name as the title, in its project; `opened: "run"`): a resume would put a
  second agent on the transcript. A run whose terminal Runner did not name is `not-ready`.
- Otherwise → `agentTabs.resume` with the session's agent, its id, the first project it shows in
  (`"__workspace__"` when none) and its start folder workspace-relative (as recorded, else with
  symlinks resolved; omitted when none is recorded), then a status other than Active becomes
  Active through `SessionData.changeStatus` (a failure there is logged; the resume stands).
- Refusals change nothing: an unknown id `not-found` ("Its transcript is gone."); a session with
  no messages (`hidden: "empty"`) and no tab `not-found` ("It holds no messages, so there is
  nothing to resume." — its bound tab, a fresh `/clear`, is focused as any); an agent the
  roster does not answer for, or an orphan, `not-found`; a start folder outside the workspace
  `outside-workspace`; no workspace `not-ready`; Pomade's own refusal of the resume keeps its code,
  its message "Pomade did not find it in its agent's store — <Pomade's words>" for `not-found`,
  else "Pomade could not resume it — <Pomade's words>". Malformed params are `invalid-params`.

**Change notice — `sessions.changed`.** The backend publishes `{ epoch, revision }` at most every
150 ms after sessions changed. The app's frames subscribe to it (the manifest declares the app's
own event in `events.subscribe`) and, when behind it, ask `sessions.list` with their `since`.
Events are not replayed, so a frame asks once its subscription stands, and again every second
while the backend does not answer; a restarted backend is another epoch and answers whole.

**Tab titles** (`src/backend/sessions/tab-titles.ts`) — a session's name is its agent tab's title,
both ways (DESIGN §2.5). The backend keeps every agent tab as Pomade last listed or changed it:

- **A rename** (`SessionData.rename` — the UI, the API, the command) calls
  `agentTabs.setTitle(tabId, name)` for every tab bound to the session; `null` for an unnamed one
  (Pomade shows the agent's name in italics with the unnamed dot).
- **The user renaming a tab** (`agentTab.changed` with `titleSource: "user"`) renames its session.
- **A tab bound to a session** — its first session, a new one after `/clear` or `/fork`, the one an
  in-session `/resume` adopts, a tab a resume opens, and every listed tab the backend did not know
  (the tabs Pomade restored) — gets the session's name, or the unnamed mark. The user's title
  names the session instead when the user titled the tab before its first session, or when a listed
  tab carries a title of the user's and its session is unnamed.
- A tab waits for its session's record before either way applies; a tab already showing the name
  (or the mark) is left alone; the tabs are forgotten when the connection ends, and listed afresh
  on the next one.

**Bound tabs** (`src/backend/sessions/bound-tabs.ts`) — `Session.tab`: every agent tab Pomade
lists (`agentTabs.list` on each connection and on `pomade.ready`, then every `agentTab.changed`;
forgotten when the connection ends) and the session it names. A tab stays bound while it is
listed, `exited` included (a tab restored from an earlier run revives when focused). A change of
it is a session change: a new revision, and `sessions.changed`.

**Live state** (`src/backend/sessions/live-state.ts`) — detected, never set. The backend keeps one
entry per live thing, each from its live source. Two sources:

- **Agent tabs** (`agentTabs.list` on each connection and on `pomade.ready`, then every
  `agentTab.changed`; the tabs are dropped when the connection ends). A tab is live while its
  `state` is `working`, `needs-you` or `idle`; `exited`, or a tab that left the list, runs nothing.
- **Runner's agent runs** (`src/backend/sessions/runner-runs.ts`, "Subscribed events" below). A
  run is `working` from its run started to its run finished, bound to its session once that is
  known.

A session's `live` is the state of the entry bound to it — a tab bound to it over a run of it (the
tab sees the agent wait or ask; a run only that it runs), else the most urgent of several:
`needs-you`, `working`, `idle` — else `closed`. `liveSince` is when the backend saw the session enter that state: one already there
at a listing is dated then, a state that stays across listings keeps its date, a session that
stops running is `closed` since that moment, and one never seen live this run is `closed` since
`null`. A live-state change is a session change like any other: a new revision, and
`sessions.changed`.

### Live now

The Live now panel's rows (DESIGN §2.8), shapes in `src/shared/live-now.ts`, built by
`src/backend/sessions/live-now.ts` from the live state above.

```ts
type LiveTabRow = {
  kind: "tab";
  tabId: string;              // the agent tab: what a click focuses (agentTabs.focus)
  project: string;            // the tab's project id; "__workspace__" for the Workspace
  sessionId: string | null;   // null before the tab's first prompt
  agent: string;              // roster id
  agentName: string;          // the roster's name for it (roster.agents); its id when the roster has none
  state: "working" | "needs-you" | "idle";
  since: string;              // ISO 8601: when the backend saw the tab enter `state`
  name: string | null;        // the session record's name; null: unnamed, or no session
  firstMessage: string | null; // the session's first message, whitespace folded to one line
};
type LiveRunRow = {
  kind: "run";
  job: string;                // the job's id
  run: string;                // the run's id, within its job
  name: string;               // the job's name: the row's title
  project: string;            // the job's project id; "__workspace__" for a workspace job
  sessionId: string | null;   // the session it runs; null while not known
  agent: string;              // roster id
  agentName: string;          // as LiveTabRow's
  state: "working";           // a run is Working from its run started to its run finished
  since: string;              // ISO 8601: when the backend heard it start
  terminal: string | null;    // its session in Runner's keeper: what a click attaches to; null: not named
};
type LiveRow = LiveTabRow | LiveRunRow;
type LiveNowAnswer = { epoch: string; revision: number; rows: LiveRow[] };  // every row, whole
```

- **Rows** — one per live agent-tab entry (a tab whose `state` is not `exited`), bound to a
  session or not, and one per Runner agent run from its run started to its run finished ("Subscribed
  events" below). The answer is unordered; the panel groups and orders
  (`src/ui/sessions/live-now-model.ts`); runs count in "N running" and never in Needs you.
- **Clicks** — a tab row: `agentTabs.focus`. A run row: `tabs.openAttached({ session: { app:
  "pomade-runner", session: terminal }, title: name, projectId: project })`; a run whose `terminal`
  is `null` is not clickable. A group header: its first tab row's click, else its first run row with
  a terminal.
- **Change notice — `liveNow.changed`** `{ epoch, revision }`: the rows are built again whenever the
  live entries, the sessions (`sessions.changed`) or the roster change; an answer that differs is a
  new revision, published at once. A frame behind it asks `liveNow.list` again; it asks once its
  subscription stands, and every second while the backend does not answer.
- **The badge** (`keepBadge`) — the backend sets the `agents` icon's badge (`strip.setBadge`, `urgent:
  true`) to the number of `needs-you` rows whenever it changes, `0` clearing it. It runs from
  Pomade's start, so the badge is right before the panel's frame exists. A new connection starts from
  no badge (Pomade clears an app's badges when the app restarts); on `pomade.ready` a non-zero badge is
  set again, for a window that came up after the backend first set it.

### The sessions contract (git)

`sessions.forRepo` and `sessions.liveIn` follow `pomade-kit/protocol` `agent-sessions` (DESIGN §5
"The sessions contract"): types and constants imported from the kit; every answer passes the
kit's `checkRepoSessions` / `checkLiveIn` unchanged. Pomade asks them as the caller `pomade`, with a
1.5 s limit (`src/backend/sessions/for-git.ts`).

- **Folders** — the caller's `folder` (absolute, else `invalid-params`) and every recorded folder
  are compared absolute with symlinks resolved; each folder is resolved once and kept 30 s
  (`src/backend/core/real-paths.ts`); one that does not exist stands as it is. Every read that
  matches folders compares this form: `forRepo`, `liveIn` and `find` here, and the attribution
  that gives `RepoSession.project` ("Sessions" above), so a session matches its repo and its
  project however its folder was reached. "At or below" is
  the folder itself or a path inside it — never a sibling sharing its name's start.
- **`forRepo`** — the sessions whose start folder (resolved) is `folder` or inside it, and with
  `branch` (a non-empty string) whose recorded branch is exactly that one; newest `lastActiveAt`
  first. `RepoSession` from the session: `name` and `status` from its record, `live`, `cwd`
  resolved, `branch`, `project` = the first project of its attribution (`null`: the Workspace),
  `startedAt` / `lastActiveAt` from the summary. A session without a start folder, without both
  activity times or without a usable record is left out.
- **`liveIn`** — one `LiveSession` per live entry whose folder is `folder` or inside it: an agent
  tab is `{ sessionId (null before its first prompt), agent: the tab's agentId, cwd, source: "tab",
  job: null }`, a tab whose folder is not known yet left out; a running Runner agent run is
  `{ sessionId (null while not known), agent: the run's agent, cwd: the run's cwd, source: "run",
  job: the job's name }` — one per run, beside a tab attached to the same session. Script, git and
  service runs are never listed. `live` is true exactly when `sessions` is not empty.

### Reads for Runner

`sessions.get`, `sessions.lastMessage` and `sessions.find` (DESIGN §5), shapes in
`src/shared/sessions.ts`; `src/backend/sessions/for-runner.ts` answers `find`. The `Session`
`get` answers carries `tab` — the agent tab bound to it, or `null` ("Sessions" above).

```ts
type SessionsGetResult = { session: Session };          // "Sessions" above

type SessionsLastMessageResult = {
  message: { text: string; at: string | null } | null;  // the agent's last text answer; null while it has not answered
};

type SessionsFindParams = {
  cwd: string;          // absolute
  startedFrom: string;  // ISO 8601 date and time with a zone (Z or ±hh:mm)
  startedTo: string;
  agent?: string;       // roster id
};

type FoundSession = {
  id: string;
  provider: "claude-code" | "codex";
  agent: string;
  cwd: string;          // the start folder, absolute, symlinks resolved
  startedAt: string;    // ISO 8601, as the transcript records it
  lastActiveAt: string;
};
type SessionsFindResult = { sessions: FoundSession[] };  // earliest start first
```

- `Session` carries `hidden` ("Sessions" above): a hidden session is answered like any other.
- `Session` carries `work` ("Sessions" above): `true` for a work session — one that counts. A
  reader that counts or sums sessions takes only those.
- **`get` and `lastMessage`** — an `id` (a non-empty string) no transcript of which is known is
  `not-found`. `lastMessage` is the summary's `lastAnswer`: the text as the agent wrote it
  (Markdown, line breaks kept), trimmed, capped at 4000 characters (a longer one ends in "…"), from
  the session's latest transcript; `at` is the answer's record time (`null` only when the record
  has none).
- **`find`** — the sessions whose start folder, resolved, is exactly `cwd`, resolved (a folder
  inside it does not match), whose `startedAt` lies between `startedFrom` and `startedTo` compared
  as instants, both ends included, and, with `agent`, whose agent is that one. A session without a
  start folder or both activity times is left out. Ties in `startedAt` go by id. Errors:
  `invalid-params` for a `cwd` that is not absolute, a time that is not ISO 8601 with a zone,
  `startedFrom` after `startedTo`, or an empty `agent`.

### Roster

The agents and their profiles (DESIGN §3.1, §3.2, §3.5), all shapes in `src/shared/roster.ts`;
`src/backend/roster/` keeps them.

**Agents.** The built-ins `claude` and `codex`; one folder agent per `<workspace>/Agents/<name>/`
holding a `CLAUDE.md` (not `_shared`, nothing with "template" in its name; a folder named `claude`
or `codex` is the built-in) — the same definition the session stores use (`folderAgentNames`,
`src/backend/stores/roots.ts`); and every profile in `agents/`, whose agent may be gone. A folder
whose name cannot name a file (`[A-Za-z0-9][A-Za-z0-9._-]*`, at most 128 characters) is left out
and logged. Order: `claude`, `codex`, then by id. **Name**: `Claude`, `Codex`, a folder agent's id.

**The profile file** — `<workspace>/Apps/pomade-agents/agents/<id>/agent.yaml`:

```ts
type AgentProfile = {
  id: string;                     // the folder's name; a file whose id differs cannot be used
  provider: "claude" | "codex";   // Pomade's provider names
  kind: "builtin" | "folder";
  configDir: string;              // "~/…" under the home folder; relative: under the workspace; or absolute
  command: string;                // one line: the alias the shell runs
  role?: string;                  // one line
  tags: string[];                 // absent in the file: []
  hidden: boolean;                // absent in the file: false
  modes: { normal?: { enabled: boolean }; "full-autonomy"?: { enabled: boolean } };
};                                // a mode absent from `modes` is not enabled; other mode keys are ignored
```

- Read and written like the session records ("Backend" below): YAML 1.2 core, only changed keys
  rewritten, comments and extra keys kept, a new file linked into place, an unusable one never
  written over.
- **First sight.** An agent with no file gets one, keys in the order above:
  - built-ins: `configDir: ~/.claude` / `~/.codex`, `kind: builtin`
  - folder agents: `configDir: Agents/<name>`, `kind: folder`, `provider: claude`, `role` = the
    first sentence (up to `.`, `!` or `?` before a space or the end) of the first paragraph under
    `## Role` in its `CLAUDE.md`, absent when there is none
  - all: `command` = `.pomade/agents.json` `commands[id]`, else the id; `hidden` = whether its
    `hidden` list names the id; `tags: []`; both modes `enabled: true`
  - A folder some profile already names as its `configDir` is that profile's agent: it gets no
    second profile.
- **An unusable file** (not YAML, not a mapping, a key missing or malformed) is left as it is;
  `roster.agents` reports it (`profile: null`, `problem`), and its agent — when the scan finds it
  — answers `roster.list`, launches and connections from its first-sight values.
- **Orphan**: a `kind: folder` profile whose `configDir` folder does not exist. Kept; left out of
  `roster.list`; `launchSpec` answers `not-found`. A built-in is never an orphan.

**`roster.list`** — Pomade's read (HOST-API §4 "Platform reads of app APIs"); every answer passes
the kit's `checkRosterList` unchanged:

```ts
interface RosterAgent {           // pomade-kit/protocol
  id: string;
  name: string;
  command: string;                // the profile's
  provider: "claude" | "codex";
  configDir?: string;             // the profile's, absolute; absent only when it cannot be resolved (no HOME)
  modes?: { id: string; name: string; args: string[] }[];
}
```

- Every agent that is neither hidden nor an orphan, in roster order.
- `modes` — the enabled ones, in the order `normal`, `full-autonomy`, each with the kit's
  `providerModes` name and arguments: Normal `[]`; Full autonomy `["--dangerously-skip-permissions"]`
  (claude) or `["--dangerously-bypass-approvals-and-sandbox"]` (codex). No mode enabled → `[]`.
- Answered from memory: Pomade's 1.5 s limit is never near. Pomade applies its own
  `.pomade/agents.json` overrides on top.

**`roster.launchSpec`** — the command line for one launch (DESIGN §3.5):

```ts
type LaunchSpecParams = {
  agent: string;                  // roster id
  mode: string;                   // "normal" | "full-autonomy"
  resume?: string;                // a session id: [A-Za-z0-9][A-Za-z0-9._:-]*, at most 128
  sessionId?: string;             // a UUID: the new session's id; not with resume
  prompt?: string;                // not blank, at most 16384 characters, no NUL
};
type LaunchSpec = {
  command: string;                // the profile's command, as typed
  args: string[];                 // unquoted
  line: string;                   // command + args quoted, one line
  sessionId: string | null;       // the id the launched session will have
  exit: string;                   // what to type to end the agent: "/exit"
};
```

| Params | Claude Code `args` | Codex `args` | `sessionId` |
|---|---|---|---|
| — | `<mode args>` | `<mode args>` | `null` |
| `sessionId` | `<mode args> --session-id <uuid>` | `<mode args>` (Codex cannot pre-assign one) | Claude: the uuid · Codex: `null` (find it with `sessions.find`) |
| `resume` | `<mode args> --resume <id>` | `<mode args> resume <id>` | the resumed id |
| `prompt` | then `<prompt>` as the last argument — `-- <prompt>` when it starts with `-` | same | as above |

- `<mode args>`: the mode's arguments as `roster.list` gives them. The forms are the CLIs' own
  (`claude --help`, `codex --help`, `codex resume --help`) and Pomade's (`buildAgentCommand`:
  command, mode arguments, then the resume arguments).
- `line`: `command` as is (the alias, never resolved or run here), then each argument: as is when
  it is only `A-Za-z0-9_@%+=:,./-`; ANSI-C quoted `$'…'` when it holds a control character (line
  break, tab, …), with `\`, `'`, `!` and every control character escaped (`\n`, `\t`, `\r`,
  `\xHH`); else in single quotes (`'` written `'\''`). So `line` is one printable line: `/bin/sh -c`
  and `zsh -c` read it back to exactly `args`, and typed into an interactive shell it meets no line
  break, tab completion or history expansion.
- Errors: `invalid-params` for malformed params, `resume` with `sessionId`, an unknown mode or one
  the profile does not enable; `not-found` for an agent the roster does not hold, or an orphan. A
  hidden agent gets its spec.

**`roster.projectsFor` · `roster.agentsFor`** — the project ↔ agent connection (pomade:E-030),
read from Pomade on every call (`project.list`, `project.getAgents`), never kept:

- A project's visible agents, as Pomade stores them: roster ids; `["*"]` every agent (also a project
  that never set a list); `[]` none. The Workspace (`"__workspace__"`) offers every agent.
- An agent is connected to a project when the project offers it and it is in `roster.list`.
- `agentsFor({ project })` → `{ agents }`: the connected agents, in roster order. An unknown project
  is `not-found` (Pomade's).
- `projectsFor({ agent })` → `{ projects }`: stable project ids in the Projects panel's order, the
  Workspace not among them. An agent the roster does not hold is `not-found`; a hidden agent or an
  orphan has `[]`.

**`roster.agents`** — every agent for the app's own frames (the Roster tab):

```ts
type RosterEntry = {
  id: string;
  name: string;
  profile: AgentProfile | null;   // null: the file cannot be used (problem), or none yet / no workspace
  problem: string | null;
  orphan: boolean;
  configDir: string | null;       // the profile's, absolute
  model: string | null;           // from the provider's config: settings.json `model` (Claude Code),
  effort: string | null;          // `effortLevel`; config.toml top-level `model`, `model_reasoning_effort` (Codex)
  provider: "claude" | "codex";   // what answers for the agent: its usable profile, else its first-sight
  kind: "builtin" | "folder";     // values — so a file that cannot be used still gives the three
  hidden: boolean;
};
type RosterAgentsAnswer = {
  epoch: string;                  // one backend run
  revision: number;
  agents: RosterEntry[];          // every agent, hidden ones and orphans included, roster order
  profilesOff: string | null;     // why no profiles are kept (no workspace open)
};
```

**`roster.connections`** — every agent's connected projects in one read, for the Roster tab's
**Connected to** (DESIGN §3.3); read from Pomade on every call like `projectsFor`, never kept:

```ts
type RosterConnectionsAnswer = { connections: { agent: string; projects: string[] }[] };
```

- One entry per agent the roster answers for, in roster order, an orphan and an agent that
  neither a profile nor the scan answers for left out; `projects` are stable project ids in the
  Projects panel's order (the Workspace not among them), the projects whose visible agents list the
  agent or are `["*"]`.
- A hidden agent is answered by the project setting all the same (`projectsFor` answers `[]` for
  it, being the "+" menu's reading); an agent no project offers has `[]`.
- No workspace open: every entry has `[]`.

**The Roster's reading** (`src/ui/roster/useRoster.ts`, shared by the list and the agent's page, which takes `patchProfile` from it): `roster.agents` and
`roster.connections` asked together, and again on `roster.changed` and on `project.created`,
`project.renamed`, `project.removed` and `project.updated`; the agents' counts are `useAgentCounts`
("Agent counts" below). Every card and row reads from these: the order and the hidden section
(`sections`), the model line, **Connected to** (`rankConnected` over the connected projects and the
agent's `ProjectCounts`, `fitCount` for how many names a field's width holds, `src/ui/roster/list/`).
The view (cards or list) is kept in the frame's `localStorage` under `pomade-agents.roster.view`.

**Change notice — `roster.changed`** `{ epoch, revision }`: published whenever `roster.agents`
would answer differently. The roster is small: a frame behind it asks `roster.agents` again, whole.
A profile changed on disk is seen at once (the data folder's watch); agent folders,
`.pomade/agents.json` and the providers' configs are read again every 2 s.

**Creating an agent** (DESIGN §3.6) — `roster.checkName`, `roster.create`, `roster.checkAlias` and
the `roster.creating` notice; the shapes in `src/shared/roster.ts`, the name rules in
`src/shared/agent-name.ts`, the work in `src/backend/roster/create-agent.ts` and
`src/backend/roster/shell.ts`. Without a workspace (no profiles kept) all three are `not-ready`.

- **The name** is checked in this order; the first problem found answers:

  | `problem` | When |
  |---|---|
  | `empty` | `""` |
  | `leading-dash` | starts with `-` |
  | `characters` | anything but `[a-z0-9-]` |
  | `too-long` | more than 64 characters (`AGENT_NAME_MAX`) |
  | `reserved` | `new` (the New agent route), or holding `template` (the agent scan skips such folders) |
  | `folder` | `<workspace>/Agents/<name>` exists (any entry), or a Create of the name is running |
  | `agent` | the roster holds the id, or a profile of it exists (a built-in; a profile whose folder is elsewhere) |
  | `shell` | a fresh `zsh -ilc` resolves it (`whence -v`): `detail` is zsh's line, `ls is /bin/ls` |
  | `shell-error` | zsh could not be run or gave no answer within 15 s: `detail` says which |

  The first five need only the name; the page applies them as typed and asks `roster.checkName`
  after a 300 ms pause in typing, dropping any answer whose `name` is no longer the one typed.

  ```ts
  type NameVerdict = { name: string; problem: NameProblem | null; detail: string | null };
  ```

- **`roster.create`** runs the steps `CREATE_STEP_IDS` in order and answers when all have run
  (the caller's `apps.call` waits up to 60 s). It checks the name again first: a refused name
  answers `outcome: "refused"` with `refused` set and every step `todo` — nothing is written.

  | Step | What it does |
  |---|---|
  | `folder` | copies `Agents/Claude Agent Template` (symlinks as they are) into a staging folder `Agents/.<name>.creating-from-template` (the scan skips it: "template"); the template must hold a `CLAUDE.md` |
  | `skills` | in the staging folder's `skills/`, a symlink `../../_shared/skills/<skill>` for every folder (or link to one) in `Agents/_shared/skills/` it lacks; dot-entries skipped |
  | `profile` | writes `agent.yaml` (`id`, `provider: claude`, `kind: folder`, `configDir: Agents/<name>`, `command: <name>`, `role`, `tags`, `hidden: false`, both modes enabled), then renames the staging folder to `Agents/<name>` and reads the roster again |
  | `projects` | per project id, in order: `project.getAgents`; a list holding `"*"` offers every agent already; else `project.setAgents` with the name appended. `skip` with no projects |
  | `alias` | appends `alias <name>='CLAUDE_CONFIG_DIR="<workspace>/Agents/<name>" claude'` to the rc file, on its own line, unless a line of the file is exactly that; creates the file when missing |
  | `verify` | a fresh `zsh -ilc` defines the alias with exactly that command |

  - **Outcomes:** `created` (every step `done` or `skip`); `failed` — `folder`, `skills` or
    `profile` failed: the staging folder and the `agent.yaml` this Create wrote are removed, so the
    roster never sees half an agent; `incomplete` — the agent exists and `projects`, `alias` or
    `verify` failed (each failure marks its step; the steps after it still run).
  - **The rc file** is `$ZDOTDIR/.zshrc`, else `$HOME/.zshrc`, of the backend's own environment;
    every zsh runs with exactly that environment. A workspace path holding `'`, `"`, `$`, `` ` ``
    or `\` cannot go into the alias line: the `alias` step fails.
  - Params: `name` a text of at most 256 characters; `role` one line of at most 200; `tags` at
    most 20 one-line tags of at most 40 (trimmed, each once); `projects` project ids; `createId`
    the caller's id, at most 128 characters. Else `invalid-params`.

  ```ts
  type CreateStep = { id: CreateStepId; state: "todo" | "run" | "done" | "skip" | "fail"; detail: string | null };
  type CreateAgentResult = {
    createId: string; name: string;
    outcome: "created" | "incomplete" | "failed" | "refused";
    steps: CreateStep[];             // CREATE_STEP_IDS order
    refused: NameVerdict | null;     // set for "refused"
    folder: string;                  // <workspace>/Agents/<name>, absolute
    aliasLine: string;               // the line the rc file gets
    rcFile: string | null;           // absolute; null when neither ZDOTDIR nor HOME is set
  };
  ```

- **`roster.creating`** `{ createId, steps }` — published, unqualified, each time a step of a
  Create starts or ends; the page shows the steps ticking from it and takes the final ones from
  `roster.create`'s answer.
- **`roster.checkAlias({ agent })`** → `AliasCheck` `{ ok, aliasLine, rcFile, detail }`: whether a
  fresh zsh defines `agent` as the alias of its config folder; never writes. `not-found` for an id
  that is not a folder agent the roster holds (or is an orphan). The page's **Check again**.

**`roster.updateProfile`** — the page's edit of an agent's role line, tags and modes in its `agent.yaml`:

```ts
type RosterUpdateProfileParams = { agent: string; role?: string | null; tags?: string[]; modes?: Partial<Record<ModeId, boolean>> };
type RosterUpdateProfileResult = { profile: AgentProfile };   // as written
```

- Each key present is set; `role: null` removes the role line; a key absent is left alone, and so is
  every other key of the file (comments and extra keys included) — the rewrite rules of "Backend"
  below. At least one of `role`, `tags` and `modes` is required.
- `modes`: one or more of `normal`, `full-autonomy` mapped to `true` / `false`; each sets
  `modes.<id>.enabled`, the other modes are left alone. Normal is always on: `normal: false` is
  `invalid-params`. A mode switched off leaves `roster.list` and `roster.launchSpec` refuses it
  (`invalid-params`, "the agent's Full autonomy mode is not enabled").
- `role`: one line, at most `ROLE_MAX` (200) characters, trimmed, not blank. `tags`: at most 20,
  each one line of at most `TAG_MAX` (24) characters, trimmed, none repeated. Anything else is
  `invalid-params`.
- An agent the roster found whose first-sight file is not written yet gets it first. Errors:
  `not-ready` (no workspace is open, so no profiles are kept); `not-found` (no such agent, or an
  orphan); `io-error` (the file cannot be used — it is never written over — or cannot be written).
- The change is in the file when the call answers; `roster.changed` follows from the data folder's
  watch.

**`roster.permissions`** — what an agent's provider config grants, for its page's Permissions tab:

```ts
type AgentPermissions = {
  provider: "claude" | "codex";
  file: string;            // absolute: Claude Code's settings.json (<configDir>/settings.json), Codex's config.toml
  exists: boolean;         // false: every list below is empty
  problem: string | null;  // why the file cannot be read
  defaultMode: string | null; // Claude Code: permissions.defaultMode · Codex: approval_policy
  sandbox: string | null;     // Codex: sandbox_mode · Claude Code: null
  allow: string[]; ask: string[]; deny: string[];   // Claude Code: permissions.allow / ask / deny · Codex: []
  mcp: { name: string; type: string | null }[];     // by name; type: stdio, http, sse…
  plugins: string[];       // Claude Code: the enabledPlugins set to true, by name · Codex: []
};
```

- Claude Code MCP servers are the top-level `mcpServers` of `.claude.json`: `<configDir>/.claude.json`
  for a folder agent, `~/.claude.json` for the built-in `claude`. Codex's are the `[mcp_servers.<name>]`
  tables of `config.toml`. A server's type is its `type`, else `stdio` when it has a `command`
  (`http` for a Codex one with a `url`).
- Read on each call, nothing cached; an unreadable `.claude.json` is no servers. `not-found` for an
  agent the roster does not hold and for an orphan.

**`roster.memory`** — the project memory a Claude Code agent keeps, for its page's Memory tab:

```ts
type AgentMemory = { folders: { folder: string; files: { name: string; path: string }[] }[] };
```

- One entry per `<configDir>/projects/<folder>/memory/` holding at least one Markdown file (a
  symlink to one counts), by `folder`; `files`: `MEMORY.md` first, then by name; `path` absolute.
  Codex has none: `{ folders: [] }`. `not-found` as `roster.permissions`.
- `folder` is the project's folder with every character but letters and digits written as `-`
  (`claudeFolderName`); the page names the folder after the workspace project whose folder (under
  the workspace as Pomade names it, or resolved) encodes to it, and shows the folder's own name for
  the rest.

**`roster.modelConfig`** / **`roster.setModel`** — an agent's default model and effort, for its
page's Model & modes tab. The provider's config is their one truth (DESIGN §3.2):

```ts
type AgentModelConfig = {
  provider: "claude" | "codex";
  file: string;            // absolute: <configDir>/settings.json (Claude Code) · <configDir>/config.toml (Codex)
  exists: boolean;
  problem: string | null;  // why the file cannot be used: unreadable, not valid JSON, not a JSON object
  model: string | null;    // settings.json model · config.toml model; null: the provider's default
  effort: string | null;   // settings.json effortLevel · config.toml model_reasoning_effort
  writable: boolean;       // Claude Code with a file that is absent or a JSON object
};
type RosterSetModelParams = { agent: string; model?: string | null; effort?: string | null };
```

- `roster.setModel` writes Claude Code's `settings.json` only: each key present is set, `null`
  removes it (the provider's default applies). Only those keys' text changes — every other key,
  the key order, the indentation, the spacing and the trailing newline stay byte for byte
  (`json-keys.ts`); a new key goes after the last one, laid out like it. A missing file is created
  holding just the keys set. A symlinked file is written through and stays a symlink.
- `model`: a model name (`[A-Za-z0-9][A-Za-z0-9._:@/[\]-]*`, at most 128); `effort`: one of
  `EFFORT_LEVELS` (`low`, `medium`, `high`, `xhigh`); at least one is required. The page offers
  `CLAUDE_MODEL_CHOICES` (`opus`, `sonnet`, `haiku`) and the file's own model when it names another
  (`src/shared/model-choices.ts`).
- Writes to one file run one at a time, each from the file as it is on disk then. The roster is read
  again before the call answers, so `roster.changed` carries the new `model` / `effort` of
  `roster.agents`.
- Errors: `not-ready` (no workspace is open — the built-ins are read-only then); `not-found` as
  `roster.permissions`; `invalid-params` (a Codex agent: read-only here); `io-error` (a file that
  cannot be used — never written over — or cannot be written). `roster.modelConfig` reads on each
  call, nothing cached; `not-found` as `roster.permissions`.

Adding a method: its name in the manifest's `api` and in `API_METHODS`, its shapes in
`src/shared/`, its handler in `src/backend/interfaces/api.ts`.

### Session of a tab

`sessions.ofTab` — the session bound to an agent tab, by the tab's lasting id (`POMADE_TAB_ID` in
its terminal); what the `pomade-agents` command asks for its default target. Answered from the
agent tabs Pomade lists ("Bound tabs" above).

```ts
type SessionsOfTabParams = { tabId: string };
type SessionsOfTabResult = {
  agentTab: boolean;        // Pomade lists an agent tab with this id; false: a plain terminal's tab, or one that is gone
  session: Session | null;  // the session the tab names; null: no agent tab, the agent not prompted yet,
                            // or its transcript not read yet
};
```

An empty or non-string `tabId` is `invalid-params`.

### Agent counts

`sessions.agentCounts` — each agent's counts over work sessions ("Sessions" above), for the
Roster's frames (DESIGN §3.3, §3.4); shapes and the counting (`agentCounts`) in
`src/shared/work-sessions.ts`. The windows are the caller's: the rule knows none.

```ts
type AgentCountsParams = {
  weekFrom: string;      // ISO 8601 with a zone: `week` counts the work sessions active from then on
  projectsFrom: string;  // ISO 8601 with a zone: `ProjectCounts.sessions` counts those active from then on
};

type AgentCountsAnswer = {
  epoch: string;         // the sessions' epoch and revision the counts are of ("Change notice" above)
  revision: number;
  indexing: boolean;     // the first walk of the stores is still running: the counts are partial
  agents: AgentCounts[]; // every agent with a work session; one missing has none
};

type AgentCounts = {
  agent: string;                                      // roster id
  lastActiveAt: string | null;                        // its latest work session's last activity
  week: { sessions: number; costUsd: number | null }; // work sessions active in the week; the sum of their
                                                      // known ~$ estimates, null when none has one
  projects: ProjectCounts[];                          // every project it has a work session in, ever
};

type ProjectCounts = {
  project: string;       // stable project id; "__workspace__" for the Workspace bucket
  sessions: number;      // its work sessions in the project active in the window
  lastAt: string | null; // the last activity of its latest work session in the project, ever
};
```

- **Active in a window:** a session's last activity — its `lastActiveAt`, else its `startedAt` —
  at or after the window's start. A session with neither is in no window, and leaves times `null`.
  A session's whole ~$ counts in the week it was last active.
- **Projects** are the session's `attribution.projects` (`[]`: the Workspace bucket), so a
  session follows Move to project; a shared-folder session counts in each of its projects, and
  once in `week`. `projects` is ordered by `sessions`, most first, then by `lastAt`, latest first.
- **Kept current:** the answer names the sessions' `{ epoch, revision }`; a frame asks again when
  `sessions.changed` is past them, and when its windows change. `useAgentCounts`
  (`src/ui/roster/useAgentCounts.ts`) does both; `rosterWindows` (`agent-counts-model.ts`) gives
  the Roster's windows — the local calendar week from Monday 00:00, and the last 90 days from 00:00
  local — the same all day.
- Errors: `invalid-params` when either time is missing or not ISO 8601 with a zone.
### Skills

The skill folders and the skills catalog (DESIGN §3.4, §3.8), all shapes in
`src/shared/skills.ts`; `src/backend/settings/` keeps the folder list, `src/backend/roster/skills-catalog.ts`
reads the catalog, `src/backend/roster/skill-links.ts` makes and takes away links. The agent
page's Skills tab and **Add skill** read `skills.catalog` and switch links with `skills.link` /
`skills.unlink`; the Settings page (`src/ui/settings/`) reads it and changes the list.

**The folder list** — `settings.yaml`'s `skillFolders` ("Backend" below): workspace-relative POSIX
folders, each read with its subfolders. No key (or no file): `Agents/_shared/skills`,
`Knowledge/_skills` (`DEFAULT_SKILL_FOLDERS`); `[]` is no folders.

```ts
type SkillFolder = {
  path: string;                   // as listed
  state: "ok" | "missing";        // missing: no folder at the path
  skills: number;                 // the skills it holds, at any depth
  nested: boolean;                // some sit in a subfolder ("and its subfolders")
  links: number;                  // agents' skills/ links whose target lies in it
  agents: string[];               // whose links those are, roster order
};
type CatalogSkill = {
  name: string;                   // SKILL.md frontmatter `name`, else the folder's name
  folder: string;                 // the listed folder holding it
  path: string;                   // the skill's folder, workspace-relative
  description: string | null;     // SKILL.md frontmatter `description`
  agents: string[];               // agents whose skills/ links point at it, roster order
};
type AgentSkillEntry = {
  name: string;                   // the entry's name in skills/
  kind: "link" | "own";           // a symlink (on/off) or a real folder (the agent's own)
  target: string | null;          // a link's target, absolute, as the link names it; null: own
  targetPath: string | null;      // the target, symlinks resolved: workspace-relative inside it, else absolute; null: own, broken
  broken: boolean;                // nothing at the target
  folder: string | null;          // the listed folder the target lies in; null: own, or not listed
  listed: boolean;                // folder !== null
  targetFolder: string | null;    // the target's parent, as targetPath is written: where a link into a folder no longer listed groups
  description: string | null;     // SKILL.md frontmatter `description` of the own skill or the link's target; null: none, broken
};
type AgentSkills = { agent: string; dir: string; entries: AgentSkillEntry[] };   // dir: <config folder>/skills, absolute; entries by name
type SkillsCatalog = {
  epoch: string;                  // one backend run
  revision: number;               // counts changes of the folder list and the links made or taken away here
  folders: SkillFolder[];         // the list's order
  skills: CatalogSkill[];         // by folder, then path
  agents: AgentSkills[];          // every Claude Code agent that is not an orphan, roster order (built-in claude: ~/.claude/skills)
  foldersOff: string | null;      // why the list cannot be changed now; null while it can
};
type SetSkillFoldersResult = { ok: true; catalog: SkillsCatalog } | { ok: false; folder: string; reason: string };
type SkillLinkParams = { agent: string; name: string; target: string };   // target: workspace-relative or absolute
type SkillUnlinkParams = { agent: string; name: string };
type SkillLinkResult = { ok: true; target: string; catalog: SkillsCatalog } | { ok: false; reason: string };
                                  // target: absolute — the link made, or the one taken away (what Undo links again)
```

- **A skill** is a folder holding `SKILL.md`, at any depth of a listed folder (at most 8 deep);
  its own subfolders are not searched. Folders starting with `.` and `node_modules` are skipped;
  a symlinked folder is followed once (by real path). A skill reached through two listed
  folders belongs to the first.
- **Links** are matched by real path: a link points at a skill when both resolve to the same
  folder, and into a listed folder when its target resolves inside it — a broken one when the
  path it names lies inside it. Only folders and symlinks in `skills/` are entries; names
  starting with `.` are skipped. Codex has no `skills/`.
- **Read on request.** Every `skills.catalog` walks the listed folders and the agents' `skills/`
  folders anew: a skill or a link added or removed on disk shows on the next read. The frames
  read again on `skills.changed` and when the tab comes back into view.
- **`settings.setSkillFolders({ folders })`** replaces the whole list (Add, Remove and their Undo
  are each one call) and answers the catalog it makes. A folder is refused — nothing written,
  `{ ok: false, folder, reason }` — when it is the workspace itself, outside it (`..`, an
  absolute path elsewhere), `.pomade`, listed twice, inside a listed folder or around one; a
  folder new to the list also when it is not a folder now, or leads outside the workspace by
  its real path. An absolute path inside the workspace is taken workspace-relative. A folder
  already listed may be missing. `not-ready` with `foldersOff`'s words while the list cannot be
  changed; `io-error` when the file cannot be written. Removing a folder never touches a link.
- **`foldersOff`**: no workspace open, the app data folder unreadable, or `settings.yaml`
  unusable (not YAML, not a mapping, a malformed `adoptedAt` or `skillFolders`) — then the
  catalog reads the default folders and the file is never written over.

- **`skills.link({ agent, name, target })`** makes `<agent's skills/>/<name>` a symlink to
  `target`; **`skills.unlink({ agent, name })`** takes that symlink away. Both answer the catalog
  after the write. The rules (`skill-links.ts`): the write is only ever a direct child of the
  agent's own `skills/` — `name` is one path segment, not starting with `.`, at most 255
  characters; a `skills/` that is a symlink or not a folder is refused; a missing `skills/` is
  made by `link` (its parent must exist). Only symlinks: `unlink` refuses a real folder (an own
  skill) or a file, and never follows a link, so its target is untouched; `link` never replaces
  an entry. **The link's form:** relative to `skills/` when both it and the target lie in the
  workspace as Pomade names it (`../../_shared/skills/grill-me`, as the template's), else
  absolute (`~/.claude/skills/grill-me` → `<workspace>/Agents/_shared/skills/grill-me`). A
  refusal is `{ ok: false, reason }` with nothing written; `not-found` for an agent that is not
  a Claude Code agent of the roster (Codex, an orphan); `not-ready` without a workspace;
  `io-error` when the disk refuses.

**Change notice — `skills.changed`** `{ epoch, revision }`: published whenever the folder list
(or `foldersOff`) changes — through the app or by hand in `settings.yaml` — and after every link
`skills.link` / `skills.unlink` makes or takes away, so every open frame reads again. A link made
or removed by hand on disk is not announced: it shows on the next read.

## Command

`pomade-agents` (manifest `commands`; DESIGN §7), source `src/command/` — `main.ts` (the entry:
the kit's `connectSocket` as role `command`, `resolveWorkspace`), `cli.ts` (arguments, sub-commands,
failures), `session-text.ts` (the text form); built by `vite.command.config.ts` into
`dist/cli/pomade-agents.mjs`, one self-contained module. Pomade's shim runs it (HOST-API §2
"Commands"). It reads no file: every answer is the backend's, through the broker (`apps.call` to
the app itself).

```
pomade-agents show [--session <id>] [--json]
pomade-agents --help · pomade-agents show --help
```

- **Target:** `--session <id>` (or `--session=<id>`) → `sessions.get`; otherwise the tab in
  `POMADE_TAB_ID` → `sessions.ofTab`. Without either, it fails before connecting.
- **`--json`:** the `Session` ("Sessions" above) — exactly what `sessions.get` answers in
  `session` — as one JSON document (2-space indent, a trailing newline) on stdout.
- **Text:** the name (`Unnamed session` when none), then `label  value` lines — status and note,
  whether it is a work session, live state and since when, agent · provider · model effort, project(s) by name and id (from
  `project.list`; the Workspace when none), start folder, branch, start and last activity, first and
  last message and last answer (one line, at most 100 characters), tokens, ~$ cost, context, Runner
  job, transcript, id. Times in UTC; no colour or escape sequence. A line whose value is unknown is
  left out. For people: its layout is not a contract.
- **Failures:** one line on stderr, `pomade-agents: <what happened> — <what to do>`, nothing on
  stdout, and an exit status per case (`EXIT` in `cli.ts`):

| Exit | Case |
|---|---|
| 0 | printed (also `--help`) |
| 1 | Pomade refused the hello (`unauthorized`, a version); no app identity in the environment (not started by the shim); any other refusal of the call; an answer that fails its guard |
| 2 | usage: no command, an unknown command (`set-status` among them) or option, `--session` twice or without an id, an argument `show` does not take |
| 3 | Pomade not running (`connectSocket` → `not-running`); the line names `<workspace>/Apps/pomade-agents/sessions/` (the workspace from `resolveWorkspace`) and the skill |
| 4 | the backend not answering: the broker's `app-absent` or `app-not-responding` (5 s) |
| 5 | no `--session`, and no `POMADE_TAB_ID` |
| 6 | the tab has no session: `agentTab: false`, or an agent tab with `session: null` |
| 7 | `--session` names no session `sessions.get` knows (`not-found`) |

- **Sub-commands** are a table in `cli.ts` (`SUB_COMMANDS`); each parses its own options and
  resolves its target with `targetOf` / `sessionOf`.
- **The format skill** — `public/skills/pomade-agents-sessions/SKILL.md`, shipped at
  `skills/pomade-agents-sessions/` in the build (manifest `skills`): the record files (DESIGN §4,
  every key of `SESSION_RECORD_KEYS`), status semantics, work sessions and their rule, this command
  and its exit statuses, and a worked example (Done sessions with their names, from the files alone).
  `src/command/skill.test.ts` fails when its key, status or exit-status tables, or the work-session
  rule it states, drift from the code.
  Pomade links the skill nowhere; `host.info`'s `skills` gives its installed folder.

## Published events

Events B and C (DESIGN §6) go out on Pomade's bus (HOST-API §4 `events`); a subscriber declares
`pomade-agents:session.closed` and `pomade-agents:session.statusChanged` in its manifest's
`events.subscribe`. Names and payloads are in `src/shared/session-events.ts`, which also has
the guards `isSessionClosedEvent` and `isStatusChangedEvent`. `session.turnFinished` (A) is
declared and never published. Events are not replayed: a subscriber that is not connected when
one goes out misses it, and so does every subscriber when the backend is not connected to
Pomade then (the backend logs it).

```ts
type SessionEventBase = {
  sessionId: string;
  provider: "claude-code" | "codex";
  agent: string;                                // roster id
  project: { id: string; root: string } | null; // the project it shows in — the first, on a shared
                                                // folder; root workspace-relative; null: the Workspace bucket
  cwd: string | null;                           // start folder, absolute, symlinks resolved
  transcript: string;                           // the latest transcript file, absolute
  name: string | null;                          // null: unnamed
  status: "active" | "on-hold" | "done" | "done-skip";
  startedByRunner: boolean;                     // the record has startedByRunner
  job: string | null;                           // its job name when startedByRunner, else null
  at: string;                                   // ISO 8601: when it happened
};

type SessionClosedEvent = SessionEventBase & { reason: "exit" | "tab-closed" | "crash" | "run-finished" };
type StatusChangedEvent = SessionEventBase & { from: SessionStatus; to: SessionStatus }; // status = to
```

A session is told of only with a usable record (it has the status); one without is logged and
left out.

**B `session.closed`** — from Pomade's `agentTab.exited` (HOST-API §4 `events`), which fires once
per end of an agent process in a tab and names the session bound to the tab then, and from
Runner's run finished of an agent run ("Subscribed events" below); `at` is when the backend heard
it. `reason` is the platform's, or `run-finished`:

| `reason` | Pomade's `agentTab.exited` reason means |
|---|---|
| `exit` | the agent quit with status 0 — `/exit`, or interrupted with Ctrl+C (status 130); the two are not told apart |
| `tab-closed` | the tab was closed with the agent running — by the user or a bulk action; also an agent a bulk "exit all agents" had to kill |
| `crash` | it ended with any other status, or the tab's shell died under it; the cause is not told |
| `run-finished` | a Runner agent run of the session finished — whatever its `result` (`done`, `failed`, `stopped-by-you`); `startedByRunner: true` and `job` the job's name, whether or not the record holds the mark yet |

- Pomade's `quit` (it quit or closed the workspace, and resumes the session at its next launch)
  is a pause, not an end: no event.
- An exit with no session bound (an agent never prompted, or a binding Pomade was unsure of) has
  no session to tell of: no event.
- A session the app does not know yet (its transcript is still being read) is waited for up to
  5 s (`CLOSED_WAIT_MS`), then left out.
- **One end, one B.** A run's session ends when the run finishes: an `agentTab.exited` of a tab
  bound to it (the user attached) while the run runs, or within 5 s after its run finished
  (`RUN_END_GRACE_MS`), publishes nothing. A session resumed in a tab after that ends as a tab's.
- A run finished whose session the app cannot name (none in the payload, none placed, none found
  by its folder and start) publishes nothing; the backend logs it.
- `agentTab.changed` alone does not tell these apart: `closed` is both a closed tab and an agent
  handing the shell back, and `state: "exited"` carries no cause.
- Subscribers treat a `reason` they do not know as an end too.

**C `session.statusChanged`** — every status change `SessionData.changeStatus` makes (the UI's,
another app's `sessions.setStatus`), per session, published **5 s after the session's last
change** (`STATUS_WINDOW_MS`, `src/backend/sessions/status-window.ts`):

- A setting that leaves the status as it was is no change.
- Changes inside the window are one event: `from` is the status before the first, `to` the
  status after the last; each change restarts the window. A status back at `from` when the
  window ends publishes nothing — that is how the Sessions tab's Undo takes a change back.
- A bulk change is one window per session: three sessions set Done are three events.
- `at` is when the last change was written.
- A requested stop (SIGTERM, SIGINT) publishes every pending change at once, before the backend
  lets go of Pomade; a backend killed or crashed loses them.

## Subscribed events

Runner's run events (`src/shared/runner-events.ts`: `RUN_STARTED_EVENT`, `RUN_FINISHED_EVENT`, the
readers `readRunStarted` / `readRunFinished`), declared in the manifest's `events.subscribe` and
taken by the backend (`src/backend/sessions/runner-runs.ts`). The app never calls Runner (PLATFORM
rule 4). Events are live only: one published while the backend is not connected is never heard.

```ts
// pomade-runner:run.started
type AgentRunStarted = {
  job: string;             // the job's id, non-empty
  name: string;            // the job's name, non-empty: startedByRunner.job and LiveSession.job
  run: string;             // the run's id, non-empty; job + run name one run
  kind: "agent";
  folder: string;          // workspace-relative
  project: string | null;  // stable project id, non-empty; null: a workspace job
  trigger: string;
  sessionId: string | null; // non-empty; null while Runner does not know it (Codex)
  agent: string;           // roster id, non-empty
  mode: string;            // non-empty
  cwd: string;             // absolute, symlinks resolved
  startedByRunner: true;
  startedAt: string;       // ISO 8601 with a zone (Z or ±hh:mm): when the run's session started
  terminal?: string | null; // optional: the run's session in Runner's keeper (`run:<encoded job>:<run>`),
                            // what Live now's click attaches to; absent, null or not a keeper session id: none
};
// pomade-runner:run.finished
type AgentRunFinished = AgentRunStarted & {
  result: string;          // non-empty: done · failed · stopped-by-you
  exitCode: number | null; // an integer
};                         // sessionId: the one Runner found by then, else null
```

- **Which payloads count.** Only `kind: "agent"` with every field above well-formed (`terminal` is optional and never refuses a payload); extra fields
  are ignored. Another `kind` (script, service, git) is not the app's: ignored silently. A payload
  with no `kind`, or an agent run missing a field, is logged (one line per event, naming the
  field) and ignored.
- **Run started** — a live entry for the run ("Live state" above) and a Live now row, and the session's record gets
  `startedByRunner: { job: name }` through the record machinery (only that key and `updated`
  change; a later job's run of the same session takes its name). With `sessionId`, at once, or
  when the session's record is written — a session whose transcript is not read yet is marked on
  first sight. Without it, the run is **placed**: the earliest session of the run's `agent`
  started exactly in `cwd` (symlinks resolved) from 5 s before `startedAt` to 60 s after
  (`PLACE_BEFORE_MS`, `PLACE_AFTER_MS`, the `sessions.find` matching), that no other run and no
  agent tab holds — tried again whenever the sessions change, until the run is placed or finishes.
- **Run finished** — its live entry goes; B with `reason: "run-finished"` ("Published events"
  above) for the payload's `sessionId`, else the session the app placed, else one placed now by
  the same rule; that session gets the mark too. A run finished the app never heard start (it
  started while the backend was not connected) ends its session the same way.
- **Runs held** live in the backend's memory only: all of them are let go of when the connection
  to Pomade ends (no run finished can be heard while it is down) and when the backend stops — no
  live entry stays and no B is published for them. `pomade.ready` drops nothing. A record's
  `startedByRunner` stays.

## Backend

- **Environment** — what Pomade gives a backend (HOST-API §2 "Backends"), and what the backend
  needs of it:
  - `POMADE_APP_STATE` — the machine-local state folder, absolute. Required: without it the
    backend refuses to start (`POMADE_APP_STATE is not set: the backend is started by Pomade`,
    exit status 1); a relative path is refused the same way.
  - `POMADE_WORKSPACE` — the open workspace's root, absolute; unset or empty: no workspace open.
  - `POMADE_SOCKET`, `POMADE_APP_ID`, `POMADE_APP_KEY_FILE`, `POMADE_CLIENT` — the connection to Pomade,
    taken by the kit's `stayConnected` (`pomade-kit/node`).
  - `HOME` — where the built-in agents' stores are.
  - `ZDOTDIR`, else `HOME` — where the rc file a new agent's alias goes into is; with `SHELL` (a
    zsh, else `/bin/zsh`) and `PATH`, the environment every zsh the backend asks runs with.
- **App data** (`src/backend/records/`) — `<workspace>/Apps/pomade-agents/`; session records and
  agent profiles are two sets of files kept by one machinery (`FileSet`), with one set of
  guarantees:
  - `sessions/<session-id>.yaml` — one record per session (DESIGN §4), written when the app first
    sees the session and on every change. YAML 1.2 core schema (times stay strings); a key with no
    value, and `false` for `projectOverride` / `outsidePomade`, read as absent. A rewrite changes
    only the keys whose values change — comments, extra keys, order and quoting stay. New records
    are linked into place (never over a file that is there), changes are written to a temporary
    file and renamed, one at a time per file, each applied to the file as it is on disk then. A
    write the system refuses fails naming the file it was for, never the temporary one, and the
    system's reason (`<path> could not be written (EACCES: permission denied)`). A
    file that is not valid YAML, not a mapping, or not a record of its session is never written
    over; its session answers `record: null` with `recordProblem`. A record deleted by hand is
    written again with its session's first-sight values.
  - `agents/<id>/agent.yaml` — one profile per agent ("Roster" above), written at first sight and on
    every change, under the same rules as a record: keys changed one by one, linked into place, never
    over an unusable file. A profile deleted by hand is written again with its first-sight values
    while its agent exists.
  - `settings.yaml` — `skillFolders`: the skill folders ("Skills" above), written through the
    same document model, so the file's other keys, comments and order stay; a settings write
    is one at a time with the first run's, starts from the file on disk, and is never made over
    an unusable file. `adoptedAt`: when the first run adopted the sessions that existed. The first
    run waits for the first walk of the stores, writes a Done record for every session found (no
    notice, no prompt), then sets `adoptedAt`, keeping anything else in the file. Afterwards a
    session without a record gets one: Done when it started before `adoptedAt`, else Active and
    `outsidePomade` until a tab is seen bound to it. An unusable `settings.yaml` stops new records
    (`recordsOff` says why) and is never written over.
  - The backend writes these files itself, not through the Host API's file methods (PLATFORM
    rule 3 allows either): records must be written whether or not the socket is up — the first
    run adopts the moment indexing ends — and one writer keeps one set of guarantees. One
    recursive `fs.watch` on the folder re-reads what changes on disk (a record, a profile, the
    settings; an agent's folder appearing or going away re-reads every profile); a file that changed is read
    once more 500 ms later (FSEvents may swallow a second change to a path that just changed).
  - No workspace open: no records and no profiles; `recordsOff` and `profilesOff` say so, the change
    methods are `not-ready`, and the roster answers the built-ins from their first-sight values.
- **Pomade** (`src/backend/interfaces/platform.ts`) — on each connection the backend lists the
  projects (again on `project.created`, `project.renamed`, `project.removed`, `pomade.ready`) and the agent tabs (again
  on `pomade.ready`), and takes every `agentTab.changed`: the first project each session is seen
  bound in is its `launchedFrom`; every tab's binding feeds `Session.tab` ("Bound tabs" above), its state and folder the live state; its session and
  title feed the tab titles ("Tab titles" above), retitled through `agentTabs.setTitle`. Every
  `agentTab.exited` feeds event B. Runner's `run.started` / `run.finished` come in on the same
  connection ("Subscribed events" above). A rename refreshes `projectRoot` in the records of that project.
  A removed project leaves the list at once; its sessions fall to their next attribution step
  (DESIGN §2.6): a project that no longer exists holds no session.
- **Roster** (`src/backend/roster/`) — the agents (`roster.ts`), their first-sight values
  (`first-sight.ts`: the scan, `.pomade/agents.json`, the role line), default model and effort
  (`provider-config.ts`), launch specs (`launch-spec.ts`), the connection (`connections.ts`), the
  edit of a profile's role and tags (`profile-edit.ts`) and the reads of an agent's permissions and
  memory (`agent-files.ts`).
  The backend reads the roster once before it connects, so Pomade's first `roster.list` is whole,
  then again on every profile change and every 2 s; each change publishes `roster.changed`.
- **Locations** (`src/backend/core/locations.ts`) — app data in `<workspace>/Apps/pomade-agents/`,
  machine-local state in `POMADE_APP_STATE` (`<userData>/app-state/pomade-agents/`), the built-in agents' stores under
  `HOME`.
- **Session stores** (`src/backend/stores/`) — `~/.claude/projects/<encoded-cwd>/*.jsonl`,
  `<workspace>/Agents/<name>/projects/<encoded-cwd>/*.jsonl` for every folder agent (a folder with
  a `CLAUDE.md`, not `_shared`, no "template" in its name), `~/.codex/sessions/**/rollout-*.jsonl`.
  One recursive `fs.watch` per store root (FSEvents on macOS: no descriptor per file), walked when
  its watch starts and once more 1 s later (the stream misses what changes before it runs); a root
  that does not exist yet, and roster changes, are checked every 2 s. Each transcript is read from the
  offset its last parse reached, opened and closed per read, and read once more 500 ms after it
  changed.
- **Parse index** — `<stateDir>/session-index.json`: `{ parser, prices, files: { <path>: { mark:
  { ino, offset }, state } } }`. Valid only for the same `PARSER_VERSION` and price-table
  fingerprint; anything else, or a corrupt file, is a cold start. Saved at most every 5 s while
  summaries change, and on stop; it stays when the backend stops.
- **Run record** — `<stateDir>/backend.json`: `{ pid, version, startedAt }`, written atomically at
  start and removed on a requested stop. A record left behind names a backend that crashed or was
  killed.
- **Stop** — on SIGTERM or SIGINT the backend publishes the status changes still inside their
  window, closes its connection, removes its run record and exits with status 0.

## Test harness

- `createSandbox(appId, { workspaceLink? })` (`harness/sandbox.ts`) — `{ root, home, workspace,
  workspaceReal, userData, socketPath, appKey, backendEnv(), snapshot(folder), cleanup() }`. `home`
  and the workspace start as copies of `harness/fixtures/`, their stores seeded with three of the
  synthetic transcripts in `harness/fixtures/transcripts/` (`SEEDED_TRANSCRIPTS`), which the unit
  tests read too. The fixtures are copied with their symlinks as they are. The fixture workspace
  holds a look-alike `Agents/Claude Agent Template` (`CLAUDE.md`, `settings.json`, an own skill and
  a link to a shared one) and `Agents/_shared/skills/` (two skills); both are skipped by the agent
  scan. `workspaceReal` is where the workspace's files are; `workspace` is what Pomade
  and the backend are given — the same folder, or with `workspaceLink` a symlink to it.
- `startFakePomade({ manifest, socketPath, appKey, host })` (`harness/fake-pomade.ts`) —
  `{ fake, shellSocketUrl, env(role?), backendCount(), close() }`: pomade-kit's fake host, reached
  by the backend over the kit's socket side (`serveFakeHost` from `pomade-kit/fake-host/node`, at
  the sandbox's `socketPath` with its `appKey`) and by frames through the shell page
  (`harness/shell/`) and its WebSocket relay (`harness/shell/relay.ts`). `env()` is the
  environment the kit gives a backend. The app's tabs are the fake host's own (`fake.appTabs`,
  `fake.onAppTab`): `tabs.openApp` opens, focuses or navigates them, `tabs.setRoute` records a
  tab's route; the shell shows each open tab with a frame attached to it (`{ tabId }`), so a frame
  reload opens at the tab's recorded route.
- `spawnBackend(sandbox, { entry, nodeArgs?, echo?, pomade?, env? })` (`harness/backend-process.ts`) —
  `{ pid, output(), running(), stop() }`. It runs with `sandbox.backendEnv()` — Pomade's backend
  environment, with `POMADE_APP_STATE` at `<userData>/app-state/<appId>` — then `pomade.env()` over
  it when given, then `env` (`undefined` unsets a variable).
- `shimHome(sandbox)`, `shimEnv(sandbox, appId, pomadeHome, terminal)`, `runCommand(entry, args, env)`
  (`harness/command-process.ts`) — the built command (`BUILT_COMMAND` in `harness/app.ts`) run as
  Pomade's shim runs it: `shimHome` writes `<root>/pomade-home/` with `host.json` (the sandbox's
  socket) and the workspace pointer; `shimEnv` is the shim's environment (`POMADE_HOME`,
  `POMADE_APP_ID`, `POMADE_APP_KEY_FILE`, `POMADE_CLIENT=command`, `POMADE_APP_STATE`) plus, for a
  `terminal` `{ tabId, projectId }`, a Pomade terminal's (`POMADE_WORKSPACE`, `POMADE_TAB_ID`,
  `POMADE_PROJECT_ID`) — no `POMADE_SOCKET`, as with the real shim; `runCommand` resolves
  `{ code, stdout, stderr }`.
- Playwright fixtures (`e2e/fixtures.ts`): `manifest`, `sandbox`, `pomade`, `backend`, `openShell`, and
  the options `seed` — `test.use({ seed: { into(sandbox) } })` writes into the sandbox before the
  backend starts (`null` by default) — `workspaceLink` (`false` by default) and `pomadeSeed` — what
  the fake Pomade has at start besides the fixture projects: its agent tabs, the sessions
  `agentTabs.resume` finds and its workspace files (folders a resume runs in),
  `test.use({ pomadeSeed: { agentTabs: [...], sessions: [...], files: {...} } })` (nothing by default).
- The Pomade smoke (`e2e/pomade/`, `npm run e2e:pomade`): `e2e/pomade/pomade.ts` launches a built
  Pomade on a sandbox (`launchPomade(sandbox, devApps?, pomadeHome?)` — with `pomadeHome` its
  commands are on: shims in `<pomadeHome>/bin`, first on its terminals' `PATH`; `pomadeApps`), connects Pomade's own client
  (`platformClient`) and holds the stand-in agent (`STAND_IN_AGENT`): a zsh script mapped onto the
  fixture folder agent that writes a Claude-shaped transcript on its first prompt, takes
  `--resume <id>` as Pomade's resume starts it, and on the prompt `/show` runs
  `pomade-agents show --json` from its `PATH` into `<store>/show.json`.
- Fixture files the agent page reads (`harness/fixtures/`): the folder agent's `settings.json` (permissions, an
  enabled and a disabled plugin) and `.claude.json` (one MCP server), the built-in Claude's
  `settings.json` permissions and the home `.claude.json` (two MCP servers), Codex's approval policy,
  sandbox and MCP server in `config.toml`. Memory folders are named after the sandbox's own path, so a
  spec writes them (`e2e/agent-page.spec.ts`).
- Transcript helpers (`e2e/transcripts.ts`): `prompt` and `answer` (Claude Code lines; a prompt
  may record a git branch, an answer carries its model, effort, usage and text), `claudeSession(sandbox, id, lines)`, `projectFolder(sandbox,
  projectId)`, and `seedIntoProject(sandbox, projectId)`, which moves the seeded transcripts' start
  folders into a fixture project.
