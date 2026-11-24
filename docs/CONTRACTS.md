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
| `capabilities` | `project.read` (projects, their stable ids, names and folders, their visible agents) · `agentTabs.read` (each agent tab's session, folder, title and live state) · `agentTabs.write` (an agent tab's title, the unnamed mark) — the backend's project attribution, live state, tab titles and the project ↔ agent connection; the Sessions tab's and Live now's project names · `tabs.open` — Live now focuses agent tabs (`agentTabs.focus`) and opens a Runner run's attached terminal (`tabs.openAttached`); the backend's `sessions.open` does the same and resumes sessions (`agentTabs.resume`) |
| `strip` | one icon, `agents` — action `panel` |
| `events` | publishes `sessions.changed`, `roster.changed` and `liveNow.changed` (for its own UI frames) and `session.turnFinished` (declared, never published), `session.closed`, `session.statusChanged` ("Published events" below); subscribes to `pomade-agents:sessions.changed`, `pomade-agents:roster.changed` and `pomade-agents:liveNow.changed` (its own, for its UI frames), `project.created`, `project.renamed` and `project.removed` (the backend, and the UI frames for project names) and, for the backend, `pomade.ready`, `agentTab.changed`, `agentTab.exited` and Runner's `pomade-runner:run.started`, `pomade-runner:run.finished` ("Subscribed events" below) |
| `backend` | `backend/main.mjs`, mode `with-pomade` |
| `api` | the methods of "Published API" below — `sessions.forRepo`, `sessions.liveIn` and `roster.list` among them, which Pomade reads (HOST-API §4, "Platform reads of app APIs") |
| `commands` | one, `pomade-agents` — entry `cli/pomade-agents.mjs` ("Command" below) |
| `skills` | one, `skills/pomade-agents-sessions` — the session-data format skill ("Command" below) |
| `outsideWorkspace` | `~/.claude/`, `~/.codex/`, `~/.zshrc` — the paths outside the workspace the backend uses; Pomade shows them at install (HOST-API §1) |

## Surfaces and routes

One UI bundle; `welcome.surface` and the frame's route pick the view (`src/ui/core/routes.ts`).

| Surface | Route | View |
|---|---|---|
| panel (the `agents` icon) | any | Live now |
| tab | `sessions`, `""`, anything else | Sessions — the table |
| tab | `sessions/<id>` | Sessions — the list with the detail panel, session `<id>` selected |
| tab | `roster`, `roster/…` | Roster |

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
- The app has one tab per project — Pomade's icon-less app tab. `tabs.openApp({ route })` opens it
  or navigates it (the panel's Sessions and Roster); the frame follows `route.changed`. The tab's
  Sessions | Roster switch is the tab navigating by itself (`navigate`, `tabs.setRoute`), as the
  selection is (`src/ui/core/TabView.tsx`).

## Published API

Served by the backend through Pomade's broker (`api.serve`); callers use `apps.call`. The UI calls
it the same way. Method names and shapes are in `src/shared/api.ts`, `src/shared/sessions.ts` and
`src/shared/roster.ts`; the sessions contract's and `RosterAgent` are `pomade-kit/protocol`'s.

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
};
type RosterAgentsAnswer = {
  epoch: string;                  // one backend run
  revision: number;
  agents: RosterEntry[];          // every agent, hidden ones and orphans included, roster order
  profilesOff: string | null;     // why no profiles are kept (no workspace open)
};
```

**Change notice — `roster.changed`** `{ epoch, revision }`: published whenever `roster.agents`
would answer differently. The roster is small: a frame behind it asks `roster.agents` again, whole.
A profile changed on disk is seen at once (the data folder's watch); agent folders,
`.pomade/agents.json` and the providers' configs are read again every 2 s.

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
  live state and since when, agent · provider · model effort, project(s) by name and id (from
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
  every key of `SESSION_RECORD_KEYS`), status semantics, this command and its exit statuses, and a
  worked example (Done sessions with their names, Done–skip left out, from the files alone).
  `src/command/skill.test.ts` fails when its key, status or exit-status tables drift from the code.
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
  - `settings.yaml` — `adoptedAt`: when the first run adopted the sessions that existed. The first
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
  (`provider-config.ts`), launch specs (`launch-spec.ts`) and the connection (`connections.ts`).
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
  tests read too. `workspaceReal` is where the workspace's files are; `workspace` is what Pomade
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
- Transcript helpers (`e2e/transcripts.ts`): `prompt` and `answer` (Claude Code lines; a prompt
  may record a git branch, an answer carries its model, effort, usage and text), `claudeSession(sandbox, id, lines)`, `projectFolder(sandbox,
  projectId)`, and `seedIntoProject(sandbox, projectId)`, which moves the seeded transcripts' start
  folders into a fixture project.
