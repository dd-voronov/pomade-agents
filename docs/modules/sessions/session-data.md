---
doc: docs/modules/sessions/session-data.md
audience: engineers, product
holds: the backend side of sessions — record files, first run, how a session is joined (work flag included), attribution and symlinks, live state, bound tabs, tab titles, the hidden rule, the work-session rule, sessions.open, events B and C, Runner runs, reads for other apps
kind: reference
---

# Session data (backend)

`src/backend/sessions/` joins what the stores know (`SessionSummary`, from the `stores` module) with
what the app keeps (the record) and what Pomade says (projects, agent tabs, Runner runs) into one
`Session` per id ([CONTRACTS "Sessions"](../../CONTRACTS.md#sessions)); `src/backend/records/` is the
files. Wiring and lifetime: `src/backend/core/backend.ts` ([CONTRACTS "Backend"](../../CONTRACTS.md#backend)).
UI side: [sessions-tab](sessions-tab.md), [live-now](live-now.md).

## Records on disk

`<workspace>/Apps/pomade-agents/sessions/<id>.yaml`, plus `agents/<id>/agent.yaml` (profiles, the
`roster` module) and `settings.yaml` (`adoptedAt`, and keys other modules keep there, written through
`rewriteSettings`); one machinery (`record-store.ts`) serves sessions and profiles. The file is the truth (PLATFORM rule 8); the backend writes it itself, not through the Host
API, so records are kept whether or not Pomade's socket is up.

- **Atomic and ordered** — written to a temp file and renamed; a new record is hard-linked into place so
  it never replaces a file that appeared meanwhile; one write at a time per file, each applied to the
  file as it is on disk then (a hand edit made before it stays).
- **Hand edits survive** — `record-file.ts` rewrites by YAML document model, key by key: comments, extra
  keys, key order and quoting stay; only keys whose values change are touched. Values read with the
  YAML 1.2 core schema; a valueless key and a `false` flag read as absent.
- **Unreadable stays untouched** — a file that is not valid YAML or not a record is held as a problem
  (`Session.recordProblem`, session shown without a record) and refused for writes until fixed or
  deleted; changes to it answer `io-error`.
- **Re-read on change** — one recursive watch on the data folder (40 ms settle), plus a read of each
  changed file 500 ms later, repeated while a read still finds it changed (FSEvents may swallow a
  second change); the watch is set up again 2 s after it fails. A `git pull` of the data folder reaches the UI like any edit.
- **`recordsOff`** — no workspace or an unopenable data folder: sessions show without records and changes
  answer `not-ready`. An unreadable `settings.yaml`: existing records work, new sessions get none. The
  reason shows under the Sessions tab's header.

## Record fields

`SESSION_RECORD_KEYS` (`src/shared/sessions.ts`) lists them in file order. The user's: `name`, `status`,
`note`, `projectOverride` with `project` (Move to project). The app keeps current (`refreshRecord`,
`rules.ts`): `transcript`, `cwd`, `launchedFrom` (the project of the first tab seen bound to it;
`"__workspace__"` for a Workspace-scope tab), `startedByRunner: { job }`, `outsidePomade`, and the
effective `project` with its `projectRoot` (as Pomade names it now). `forkedFrom` is read, never written
by the app.

## First sight and the first run

`newRecord` (`rules.ts`): a session starting after the first run's `adoptedAt` is Active and
`outsidePomade` until a tab is seen bound to it; one that started before it is Done (an old record went
missing, or it ran on another Mac). The **first run** (`adoptOnFirstRun`, no `adoptedAt` in
`settings.yaml`) waits for the stores' first walk to finish, resolves start folders, writes a Done
record for every session found in batches of 16, and only then writes `adoptedAt` — one cut short starts
over and keeps the records it wrote. Record ids must be file-name safe (`isRecordId`); one that is not
shows with the problem "its session id cannot name a file".

## Joining and revisions

`session-data.ts` keeps an entry per session id: the latest transcript's summary (`latestSummary`: last
active, then path), the record, attribution, `folderInProject`, live state, bound tab, hidden reason and
the work flag (`Session.work`, below). Work
is marked dirty and reconciled in one pass; an entry whose JSON did not change keeps its revision.
`answer(since)` gives the changes after the caller's revision (or all, `full`, for another epoch);
change notices go out at most every 150 ms. A session whose transcripts are gone leaves the answer; its
record stays on disk and joins again if a transcript returns. Writes of the app's own are one per
session at a time, reconsidered once done.

## A session's agent

`summary.agent` is the agent whose profile holds the session's store, not the name of the folder
the transcript is in ([CONTRACTS "Sessions"](../../CONTRACTS.md), "A session's agent"). Each store
root carries its config folder and the folder's own agent (`StoreRoot.configDir`, `.folderAgent`,
`stores/roots.ts`); the roster answers `storeAgent(root)` from every agent's answering profile's
resolved `configDir` (absolute, normalized): the folder's own agent when it is among those naming
the folder or when none does, else the first in roster order. The session store takes that answer
as `StoreAgents` and, on a roster change, re-stamps only the summaries whose agent changed — each
gets a new revision, `sessions.changed` and `liveNow.changed`. So a **Re-link** and its **Undo**
move an agent's sessions at once: the counts, the Agent filter, the agent page's tabs, Live now
and `pomade-agents show` all read `summary.agent`. A record's `agent` key is kept current with it
(`refreshRecord`). `sessions.liveIn` gives the tab's own agent id, as Pomade launched it.
Spec: `relink-sessions.spec.ts`. Tickets: T-036.

## Attribution

`attribution.ts`, [glossary](../../GLOSSARY.md) "Project attribution". In order: `projectOverride`
(+ `project`; without `project`, the Workspace bucket) → `launchedFrom` → the deepest project root
holding the start folder (all projects on that root when several share it: `sharedFolder`) → the
`project` remembered in the record, when no root holds the folder any more (ids are stable across
rename or move, pomade:E-030) → the Workspace bucket (`projects: []`). A project that no longer exists
holds nothing; a Move to one that is gone is void and the session falls to automatic placement.
`Session.folderInProject` is the start folder relative to the first project, `""` at its root.

**Symlinks** — folders are compared absolute with symlinks resolved, both sides: project folders by
`placesOf` (`interfaces/platform.ts`: the workspace's real path joined with the project's root), start
folders by `RealPath` (`core/real-paths.ts`, a 30 s cache; a missing folder stands as it is). Until a start
folder is resolved the session is placed by the folder as recorded and its record is not written;
resolving re-joins every session started in it. The same resolution serves `forRepo`, `liveIn` and
`find`. Specs: `symlinks.spec.ts`, `backend.spec.ts` ("through a symlinked workspace").
Tickets: T-030.

## Changes in

Status, note, name and Move to project go to the record file and nowhere else (`change` → `records.update`
→ reconcile → the answer is the session as it is now). `changeStatus` is the one way a status changes
and tells its listeners each session whose status actually changed (event C's source); `rename` tells
its listeners the name (tab titles). Name and note are trimmed, one line, empty removes the key.
Errors: no record file yet → `not-ready`; unknown session → `not-found`; unreadable file → `io-error`.

## Live state and bound tabs

`live-state.ts` keeps one entry per live thing from two sources — agent tabs (`agentTabs.list`, then
`agentTab.changed`; live while `working`, `needs-you` or `idle`) and Runner runs (`source: "run"`, always
Working). A session's live state is the most urgent of its entries (needs-you, working, idle), a bound tab
winning over a run; none means Closed. `since` is when the backend saw the session enter the state (a state
present at first listing is dated then; a Closed session never seen live this run has `since: null`).
It is detected, never set. Entries are replaced per source; an entry keeps its `since` while its state and
session stay.

`bound-tabs.ts` holds every tab Pomade lists, exited ones too (a restored tab revives when focused), and
answers `Session.tab` — a live tab before an exited one, then the first listed. `Session.tab` is what
Open / Resume, the rename retitle and the Live now click use. The other direction, `ofTab(tabId)`, answers
`{ sessionId }` for an agent tab Pomade lists (`sessionId` `null` before its first prompt) and `null` for any
other id; `sessions.ofTab` turns that into `{ agentTab, session }` and the `pomade-agents` command's default
target uses it ([CONTRACTS "Session of a tab"](../../CONTRACTS.md#session-of-a-tab),
[interfaces](../interfaces/api.md#session-of-a-tab)).

## Names are tab names

`tab-titles.ts`, [CONTRACTS "Sessions"](../../CONTRACTS.md#sessions) "Tab titles". A rename retitles every tab bound to
the session (`agentTabs.setTitle`; `null` marks it unnamed: Pomade draws the agent's name in italics with the
unnamed dot). A tab the user renamed (`titleSource: "user"`) renames its session. A tab that gets bound to
a session — first session, after `/clear` or `/fork`, an in-session `/resume`, a resume in a new tab, a tab
restored at Pomade's start — takes the session's name or the unnamed mark. Two cases keep the user's title
and name the session with it (`adopt`): a tab the user named before its first session, and a listed tab
with the user's title bound to an unnamed session. A tab waits for its session's record before either
way is applied, and one that already shows what it should is left alone. Specs: `tab-titles.spec.ts`,
`pomade/tab-titles.spec.ts`. Tickets: T-013.

## Work-session rule

`isWorkSession` (`src/shared/work-sessions.ts`), the only place ([DESIGN](../../DESIGN.md) §2.9,
[CONTRACTS "Sessions"](../../CONTRACTS.md#sessions) "Work session"): a session is a work session unless
its record's status is `done-skip`; one without a record counts. `session-data.ts` sets `Session.work`
whenever it joins a session, so a status change changes it like any field and the revision moves.
Every count and sum reads the field: the Sessions tab's header and group sums
([sessions-tab](sessions-tab.md) "Scope, groups, counts"), the command's `work session` line
(`src/command/session-text.ts`), and `sessions.agentCounts` ([CONTRACTS "Agent counts"](../../CONTRACTS.md#agent-counts)).
`agentCounts` (same file) tallies per agent, from the whole session list: last activity, work sessions
and known ~$ within the caller's week, and per project (`attribution.projects`, `[]` → the Workspace
bucket; a shared-folder session counts in each) the sessions within the caller's window and the last
activity ever; `agentsWithSessions` lists every agent with a session of any status, which is how the
Roster knows an agent never ran. The windows are the caller's, never the rule's. A hidden session is a
work session here: only the Sessions tab leaves it out of its own count. Specs: `work-sessions.spec.ts`,
`work-sessions.test.ts`. Tickets: T-033.

## Hidden rule

`hidden.ts`, the only place: a session whose summary has no first message, no last message and no
answer — a file only a `/clear` wrote — is `"empty"`; its first message or answer clears it. Every read
lists hidden sessions all the same (`Session.hidden`); the Sessions tab, not the API, leaves them out.
Spec: `hidden-sessions.spec.ts`. Tickets: T-011.

## `sessions.open`

`open.ts`, in this order: a session with a bound tab → `agentTabs.focus` (`opened: "tab"`; a tab that
left meanwhile falls through) → a live Runner run of it → `tabs.openAttached` its terminal in the run's
project (`"run"`; no terminal known → `not-ready`) → otherwise `agentTabs.resume` with its agent, in its
first project (the Workspace when none) and its start folder workspace-relative, then a status other than
Active becomes Active through `changeStatus` (`"resumed"`; a failure of that is logged, the resume stands).
Refusals change nothing: unknown session (`not-found`), no messages (hidden as `empty`), an agent not in
the roster or orphaned, a start folder outside the workspace (`outside-workspace`), Pomade's own refusals
(plain words, Pomade's after " — "). Spec: `open-resume.spec.ts`. Tickets: T-010.

## Events B and C

`session-events.ts`, `status-window.ts` ([CONTRACTS "Published events"](../../CONTRACTS.md#published-events)).
**C** `session.statusChanged` goes out `STATUS_WINDOW_MS` = 5 s after the session's last change; a
change inside the window restarts it and keeps the first `from`, one that brings the status back to
that `from` drops it; `stop` publishes what is pending. **B** `session.closed` comes from `agentTab.exited`
(`quit` and an exit with no session publish nothing) and from a Runner run finishing (`run-finished`,
with the job); one end gives one B — a tab bound to a run's session that exits while the run runs, or
within 5 s after it, publishes nothing. A session not yet known with a record is waited for up to 5 s.
The UI's 4 s toast keeps Undo inside the status window ([sessions-tab](sessions-tab.md) "Changing status").
Specs: `for-runner.spec.ts`, `bulk-status.spec.ts`.

## Runner runs

`runner-runs.ts`: Runner's `run.started` / `run.finished` of an agent run (other kinds are ignored; a
malformed one is logged) — the app never calls Runner. A started run is a live entry (Working, the job's
name, its attached terminal when the payload names it) and marks its session `startedByRunner` (held until
the record is there). A run without a session id (Codex) is placed by agent, folder and start time
(`PLACE_BEFORE_MS` 5 s before to `PLACE_AFTER_MS` 60 s after `startedAt`; not taken by another run or
tab), retried whenever sessions change. Runs live in memory and are dropped when the connection to Pomade
ends. Specs: `runner-runs.spec.ts`. Tickets: T-015.

## Reads for other apps

`for-git.ts` (`sessions.forRepo`: sessions whose start folder is in a repository or worktree, optionally
on a branch, newest first, only those answerable in full — folder, both times and a usable record;
`sessions.liveIn`: what runs at or below a folder now) and `for-runner.ts` (`sessions.find`: sessions
started in one folder within a time window). All compare real paths. Contracts: [CONTRACTS "The sessions
contract (git)"](../../CONTRACTS.md#the-sessions-contract-git), ["Reads for Runner"](../../CONTRACTS.md#reads-for-runner).
Specs: `for-git.spec.ts`, `for-runner.spec.ts`, `records.spec.ts`.

Tickets: T-004, T-005, T-010, T-011, T-013, T-015, T-027, T-030, T-033, T-036.
