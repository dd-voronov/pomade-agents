---
doc: docs/DESIGN.md
audience: engineers, product
holds: the app's living design — sessions, roster, data and files, published API, events, command, placement, what's not in v1
kind: reference
---

# pomade-agents — Design

`pomade-agents` ("Agents" in the UI) is the Pomade app for the user's agents. It owns two kinds of
data, for the whole Pomade family:

- **The roster.** It shows which agents exist and what each one is for, holds their modes and
  launch specs, manages their skills and model, and creates new agents.
- **Session data.** It tracks every agent session per project: its name (which is also its tab's
  name), the status the user sets, its live state, where it started, which agent and model ran it,
  its context fill and estimated cost, the first and last messages, and one-click resume.

Other pieces read both only through this app's API (PLATFORM rule 4). This doc states the current
design. The reasoning and the Owner's scenarios are in the G4 grill outcome
(`../Pomade/docs/auxiliary/grills/2026-11-09-g4-agents.md`); the platform frame is in
`../Pomade/docs/PLATFORM.md`.

## 1. Shape

| Part | What |
|---|---|
| **UI** | one web app (iframe on `pomade-app://pomade-agents/`) rendering three surfaces, chosen by route: the **Live now** panel, the **Sessions** tab, the **Roster** tab (cards, agent detail page, create agent) |
| **Backend** | **with-Pomade** (starts and stops with Pomade). It reads and watches the agents' session stores, keeps the parse cache, writes the session and roster files, edits agent folders and `settings.json`, and appends shell aliases to `~/.zshrc` |
| **Commands** | `pomade-agents` (§7) |

**Stack:** TypeScript + React + Vite for the UI, a TypeScript Node process for the backend, both
on `pomade-kit`'s SDK. Pure logic (transcript parsing, attribution, cost math) is unit-tested with
vitest. Behavior is covered by Playwright against the SDK's fake host, plus a dev-linked Pomade
smoke spec.

**Manifest** (`manifest.json`):
- id `pomade-agents`, backend `with-pomade`
- one strip icon: Agents → fills the panel with Live now
- command `pomade-agents`
- published events (§6)
- paths outside the workspace: `~/.claude/` (built-in Claude Code store, skills, settings),
  `~/.codex/` (sessions, config), `~/.zshrc` (aliases)

**Surfaces:**
- The **Agents icon** in Pomade's left strip opens the **Live now** panel (§2.8).
- The panel's two buttons, **Sessions** and **Roster**, open or focus those wide tabs.
- With the app installed, Pomade's clock icon opens the Sessions tab, and the "+" menu takes its
  agents from the roster (§3.7).

## 2. Sessions

### 2.1 Identity

- **One provider session id = one session.**
  - `/compact` and resume (`claude --resume`, `codex resume`, Pomade's Resume) keep the id, so
    they keep the session.
  - `/clear` creates a new id, so it's a new session: unnamed and Active.
  - `/fork` creates a new session named "<name> (fork)", with `forkedFrom` recorded.
- **A tab's session changes over time.**
  - In-session `/resume` switches the tab to an existing session. `/clear` and `/fork` move the
    tab to a new one.
  - The platform reports every binding change (`pomade:E-033`). The app records which project's
    tab first ran each session (`launchedFrom`).
- **Open / Resume:**
  - If the session is bound to an open tab, that tab is focused.
  - Otherwise the session is resumed in a new agent tab in its project (`pomade:E-033`).
  - Resuming a session whose status isn't Active sets it to **Active**.

### 2.2 Sources

| Provider | Store | Session file |
|---|---|---|
| Claude Code, built-in `claude` | `~/.claude/projects/<encoded-cwd>/` | `<sessionId>.jsonl` (the basename is the id) |
| Claude Code, folder agents | `<workspace>/Agents/<name>/projects/<encoded-cwd>/` | same |
| Codex, built-in `codex` | `~/.codex/sessions/<YYYY>/<MM>/<DD>/` | `rollout-<launch time>-<sessionId>.jsonl`; line 0 `session_meta` carries id + cwd |

- Only regular `.jsonl` files count. Excluded: `memory/`, per-session directories, and sub-agent
  transcripts (Claude `<sessionId>/subagents/`; Codex rollouts whose `session_meta.source` names a
  sub-agent).
- A session's **start folder** is its first recorded `cwd`.
- Store semantics (when a file appears, what `/clear` and resume do to it) are in Pomade's
  `docs/modules/agents/session-stores.md`.
- The backend watches each store. A file that appears or grows is re-parsed incrementally from
  its last offset.
- The parse index lives in `<userData>/app-state/pomade-agents/` (machine-local, rebuildable).

### 2.3 What a session shows

| Field | Source |
|---|---|
| agent | the store it lives in: built-in store → `claude` / `codex`; `Agents/<name>/` → that folder agent |
| provider | Claude Code or Codex |
| model + effort | the latest turn. Claude: `message.model` + `effort`. Codex: `turn_context.model` + `effort`. A mid-session `/model` switch shows |
| context % | the last turn's input-side tokens ÷ the model's context window. Claude: `input + cache_read + cache_creation` of the last assistant usage, window from the price table. Codex: `last_token_usage` ÷ the rollout's `model_context_window` (shown even for a model missing from the price table) |
| ~$ est. | Σ tokens per turn × the price table (input, output, cache read, cache write split into 5-minute and 1-hour), always labeled "~$ est.". Claude: usage counted once per `message.id` (one API message spans several records); `<synthetic>` records aren't turns. Codex: per-turn tokens are differences of the cumulative `total_token_usage` (identical `token_count` events repeat) |
| started · last active | first and last `timestamp` |
| folder · branch | `cwd`, the first non-empty `gitBranch` (Claude). Codex: `session_meta.cwd`, `session_meta.git.branch` when recorded |
| first / last message from the user | the first and last real user text, skipping injected content (system reminders, skill bodies, tool results, command caveats, built-in slash commands, Pomade's file-context lines). A skill or custom command shows as typed. Codex Desktop's wrapped prompts keep only the request |
| last agent answer | the last assistant text block |

**Price table:** a hand-maintained table in the app source. Per model id it holds dollar rates
per million tokens and the context window. A model missing from the table shows "—" for cost and
context; it never shows a guess.

### 2.4 Status and live state

Two separate columns:

| | Values | Set by |
|---|---|---|
| **Status** | Active · On hold · Done · Done–skip/Failed | the user only, in the Agents UI (row, detail panel, bulk) |
| **Live state** | Working · Needs you · Idle · Closed | detected: the platform's live state per agent tab (`pomade:E-033`); Runner agent runs from its events — Working while the run runs, unless a tab attached to the session says otherwise; anything not running is Closed |

- **New sessions start Active.**
- **On the app's first run, every session that already exists is set to Done**, silently.
- **An optional one-line note** attaches to any status.
- **Resuming** a non-Active session sets it to Active. Nothing else ever changes a status.
- **Done–skip/Failed** is excluded from cost roll-ups (a toggle includes it), and readers like
  the Session Analyzer treat it separately.

### 2.5 Names

- **A session's name is its tab's name, in both directions.**
  - Renaming in the app changes the tab title.
  - Double-click-renaming an agent tab renames the session.
  - Restored tabs show their session's name.
- **There are no automatic names.** Claude's `aiTitle` is ignored.
- **An unnamed session:**
  - its row shows the first message in grey
  - its tab shows the default title in italics with an "unnamed" dot (e.g. after `/clear`)

### 2.6 Project attribution

In order:
1. **Move to project** override, if set.
2. **The project of the Pomade tab that first ran it** (`launchedFrom`), when known. A tab in the
   Workspace scope means the session belongs to the **Workspace**, in no project: ad-hoc
   questions, work on the workspace itself.
3. **The deepest project whose root contains the start folder.**
   - If several projects share that root, the session shows in each, with a "shared folder"
     marker.
4. **The record's last project**, if it still exists (a project folder moved, so no root holds
   the start folder any more).
5. **None of the above** → the **Workspace** bucket.

Also:
- The detail panel shows the start folder relative to the project root ("started in `docs/`").
- Every agent counts, whether or not it's connected to the project.
- A session created after the first run and never bound to a Pomade tab is marked **"outside
  Pomade"**. Its live state is always Closed.

### 2.7 Sessions tab

The tab has two layouts and moves between them by selection: the **table** while no session is
selected, the **list with the detail panel** once one is.

**Both layouts**

- **Scope** is the tab's project: a project's tab shows that project's sessions; the Workspace's
  tab shows every session, with the project named on each row and a Project filter (its
  "Workspace (no project)" entry is the Workspace bucket).
- **Header:** "Sessions", the scope's name, the session count and the sum of ~$ est.
  (Done–skip/Failed left out).
- **Statuses**, in order: Active · On hold · Done · Done–skip/Failed. Rows are sorted by last
  activity, newest first. Done and Done–skip/Failed show their latest 10 with "Show all N" when
  they hold more than 12.
- **Marks:** status is a small colored square; live state is a round mark — a spinner for
  Working, a red dot for Needs you, a grey dot for Idle, nothing for Closed.
- **Name:** the session's name, or the first message in grey when it is unnamed; a fork mark;
  chips for an unattended run (⏱ + job name), "shared folder" and "outside Pomade".
- **Context %** is a bar with the number: amber from 75 %, red from 90 %. A model missing from
  the price table shows "—" for context and cost.
- **The note** sits under its row.
- **Search** covers names, the first and last message, the last agent answer and notes; a match
  outside what the row shows adds a snippet line under it ("Last message: …"), and matches are
  highlighted. **Filters:** agent, folder (workspace-relative paths in the Workspace scope) and,
  in the Workspace scope, project. While a search or filter is on, the toolbar shows the match
  count and "Clear".
- **Selecting several:** the row's checkbox, Cmd+click, Shift+click or Shift+arrows for a range,
  Space, Cmd+A. While rows are checked a bar replaces the toolbar: "N selected", **Set status**
  with the four statuses, Clear. Bulk sets no note.
- **Changing a status:** the detail panel, the bulk bar, the row menu (right-click, or ⋯ on
  hover), or dragging rows onto a status (a group header, a status tab). Every change shows a
  toast with **Undo**.
- **Keys:** ↑ ↓ move, Space checks, Enter opens or resumes, F2 renames, `/` focuses search, Esc
  clears the checks, then closes the detail panel.
- **Empty states:** no sessions in this scope; nothing matches (with "Clear search and
  filters"); a line in each empty status.
- **Sessions hidden from the tab** — today those that hold only a `/clear` — are left out of the
  rows, counts, sums, search and filters; the header says "N hidden", and clicking it shows them
  in their groups, dimmed, with a "hidden — no messages" chip, until clicked again. The header's
  count and sum never take them. Live now lists their agent tabs all the same.
- Light theme only. One density.
- Deep reading = Resume. There is no transcript viewer in v1.

**Table — nothing selected.** One scrolling table over the full width:

- A column header, then four collapsible groups with sticky headers; each header carries the
  status mark, the count and the group's ~$ sum (Done–skip/Failed: "not in totals"). No group is
  ever hidden.
- One 28 px line per session: checkbox · live mark · name · project (Workspace scope) · agent ·
  model · effort · context % · ~$ est. · last active · Open/Resume and ⋯ on hover.
- As the tab narrows, columns go in this order: effort → model → ~$ est. → context % → agent.
  The name and last active always stay.

**List with the detail panel — a session selected.** Clicking a row selects it and the tab
becomes two panes:

- **Left, the list:** status tabs with counts on top (the selected session's status is the open
  tab); below, that status's sessions as two-line rows — name, agent and last active; then
  project (Workspace scope) · agent · model · effort, context % and ~$ est. While a search or
  filter is on, the list shows the matches of every status, grouped, instead of one tab.
- **Right, the detail panel**, over the rest of the width:
  - the name (click or F2 to rename in place), close
  - live state and since when, or last active
  - **Open tab / Resume · Rename · Move to project**
  - notes for a Runner-started session, a fork (with a link to its parent), a shared folder,
    outside Pomade
  - **Status** as four buttons, with the one-line note field under them
  - facts: project, started in (folder relative to the project, branch), started, last active,
    agent and provider, model and effort, context %, ~$ est.
  - first message, last message, last agent answer — long texts are clamped, "Show more"
    expands in place
- Closing the panel (its ×, or Esc) returns to the table.

### 2.8 Live now panel

- **Header:** "Live now" with "N running · M need you"; under it the **Sessions** and
  **Roster** buttons.
- **Every running session**, grouped by project, the active project first with a "current"
  tag; clicking a group header switches to that project.
  - Within a project: Needs you → Working → Idle, then the most recent.
  - Row, two lines: the name (or the first message in grey) and since when; then the live state
    in words and the agent.
  - Unattended runs show ⏱ and the job name.
- **Click a row:**
  - an agent tab → Pomade switches to its project and focuses the tab
  - a Runner run → its attached terminal tab opens
- **The Agents icon's badge** counts the sessions in **Needs you**. The backend keeps it, so it is
  right from Pomade's start, before the panel was ever opened.
- **Nothing running:** "No agents running".
- The red unread dots on tabs and the per-project counters are the platform's and stay as they
  are.

### 2.9 Work sessions

A **work session** is a session that counts. Every count and sum the app shows — the week
roll-ups, an agent's sessions per project — is over work sessions, and one rule in one place in
the code decides it: every session is a work session unless its status is Done–skip/Failed.
The window a view counts over ("this week", "the last 90 days") is that view's own.

Which other sessions are not work — started and ended at once, tests, sub-agents' — and how
each is treated is [[P-017]].

## 3. Roster

### 3.1 Agents

- **Built-ins:**
  - `claude`: Claude Code, config `~/.claude`
  - `codex`: Codex, config `~/.codex`
- **Folder agents:** one per `<workspace>/Agents/<name>/` that holds a `CLAUDE.md`. Folders named
  `_shared` or containing `template` are skipped. All folder agents are Claude Code instances run
  with `CLAUDE_CONFIG_DIR=<folder>`.
- **Names:** the built-ins show as Claude and Codex, a folder agent as its folder's name.
- **Each agent's launch command is its shell alias**, e.g. `claude-libra`. Pomade types it into
  an interactive shell.

### 3.2 `agent.yaml`

One file per agent: `<workspace>/Apps/pomade-agents/agents/<id>/agent.yaml`. The folder leaves
room for future per-agent files (custom modes, own harness).

```yaml
id: claude-libra
provider: claude               # claude | codex — Pomade's roster names
kind: folder                   # builtin | folder
configDir: Agents/claude-libra # workspace-relative; builtins: ~/.claude, ~/.codex
command: claude-libra          # what Pomade types to launch it
role: A meticulous librarian for the Knowledge vault.
tags: [knowledge, vault]
hidden: false
modes:
  normal: { enabled: true }
  full-autonomy: { enabled: true }
```

- **Model and effort aren't stored here.** The provider's own config is their single truth:
  `settings.json` `model` / `effortLevel` for Claude Code, `config.toml` for Codex.
- **Absent keys:** no `tags` is none, no `hidden` is `false`; a mode absent from `modes` is not
  enabled.
- **First sight** of an agent with no file — on the first run, and for every agent folder added
  later — creates its file:
  - from Pomade's folder scan
  - plus `.pomade/agents.json` (command overrides, hidden agents)
  - plus a role line pre-filled from the first sentence under `## Role` in the agent's
    `CLAUDE.md`
  - A folder another profile names as its `configDir` belongs to that profile: no second file.
- **A file is never written over** when the app cannot use it (broken YAML, a malformed key): the
  Roster reports it, and the agent answers from its first-sight values until it is fixed.
- **Orphans:** a folder agent's `agent.yaml` whose `configDir` no longer exists (the folder was
  renamed outside the app). It stays out of the "+" menu and launches, and is shown on a card, with
  **Re-link** to an unclaimed agent folder or **Remove**. A built-in is never an orphan.
  - **An unclaimed agent folder** is one no profile has made its own: none names it but the
    first-sight profile written when it appeared, still as written — the case of a folder renamed
    outside the app. Re-link points the orphan's `configDir` at it and drops that first-sight
    profile; the agent keeps its id. Its toast offers Undo, which puts both profiles back as they
    were.
  - **Remove** deletes the orphan's profile (its `agents/<id>/` folder), never an agent folder,
    after asking in place.
- **Known limit:** command edits made in the app don't reach Pomade's `.pomade/agents.json`. The
  platform's fallback (§3.7) uses the last commands it knew itself.

### 3.3 Roster tab

One entry per agent, in two views the user switches between with two icon buttons left of
**New agent** — **cards** and a **list** — the choice remembered on this Mac. Layout:
`prototypes/roster/`.

- **Header:** the agent count; this week's work sessions (§2.9) and ~$ across agents; the view
  switch; **New agent**; the gear of the app's Settings (§3.8) sits at the right of the
  Sessions | Roster bar.
- **Order:** the built-ins first, then by id. Hidden agents are in their own collapsible section
  at the end. An orphan and an agent with an unusable `agent.yaml` stay in place, marked.
- **A card shows:**
  - name (a link to the agent's page), provider, default model + effort
  - role line and tags, both edited in place → `agent.yaml`. Hovering or editing them never moves
    the rest of the card.
  - **Connected to** (below)
  - last active
  - this week: work sessions and ~$
  - **Start session ▾** · **Sessions** · **Open ›** (the agent's page); a ⋯ menu with Open agent
    page and Sessions (the list row's way to them), then Clone…, Hide / Show in the "+" menu, Open
    CLAUDE.md, Open agent.yaml. The buttons stay inside the card at every width.
- **A list row shows** the same without tags: name and role line, provider and model, Connected
  to, last active, this week, **Start session ▾** and the ⋯ menu.
- **Connected to** — one field, the projects whose "+" menu offers the agent (the project
  setting: Pomade stores it, the app reads and writes it through `pomade:E-030`):
  - the total first, then the top projects in brackets: `8 (■ pomade-agents, ■ Pomade, …)`
  - ordered by the agent's work sessions in the project over the last 90 days, most first;
    connected projects without one follow in sidebar order
  - a card shows as many names as fit, up to three; a list row one, two when the row is wide.
    A long name is cut with "…"; the total and the brackets are never clipped; `…` before the
    closing bracket says more are connected than shown; the tooltip lists them all
  - a project that offers every agent (`["*"]`) counts
  - connected to every project: `All 12 (…)`; to none, and with no workspace open: "No projects"
  - the field is a button: it opens the agent's page on its Projects tab
- **Start session ▾:** the mode (Normal / Full autonomy — only the enabled ones; no choice when
  only Normal is), then the project: connected ones first, then the others, then the Workspace.
  Off for a hidden agent (Pomade launches only what its "+" menu offers) and an orphan.
- **Sessions:** the Sessions tab in the Workspace scope with the Agent filter set.
- **Orphan:** **Re-link** to an unclaimed agent folder, or **Remove**.
- **No workspace open:** the two built-ins, read-only.

### 3.4 Agent detail page

Route `roster/<agent>/<tab>`. A header — name, state chips, provider, model, the launch command,
**Start session ▾**, a ⋯ menu (Clone…, Hide, Open CLAUDE.md, Open agent.yaml) — over tabs:

| Tab | Content |
|---|---|
| Overview | role and tags (edited in place), provider, launch command, config folder, `CLAUDE.md` (opens in Pomade's editor), the profile file, last active, this week |
| Skills | the agent's `skills/` entries grouped by skill folder (§3.8), then its own. On/off = create / remove the symlink; an own skill (a real folder) has no switch. **Add skill** from the catalog of the skill folders; "also in" other agents. A link into a folder no longer listed shows under that path, marked |
| Projects | where the agent is offered and where it worked (below) |
| Model & modes | default model + effort, edited in the provider config (only those keys change; `codex` read-only); §3.5's modes with a switch for Full autonomy (Normal is always on) and each mode's launch line, read-only, with Copy |
| Permissions | permissions, MCP servers and plugins, read-only; **Open `settings.json`** |
| Memory | the projects the agent has `memory/` for; open a memory file |
| Sessions | this agent's sessions across all projects, a Project filter, **Open in Sessions** |

**Projects tab.** One table: **Project · Sessions (90 d) · Last session** — the count is of work
sessions (§2.9) in the last 90 days. Connecting is edited here; it is the same data as the
project's own settings.

- **Connected:** every project that offers the agent, under the sidebar's groups, ordered inside
  a group by the count. **Disconnect** on a row; a project that offers every agent (`["*"]`) is
  connected and locked.
- **Not connected:** the other projects, each with **Connect** — first those the agent has
  sessions in (Start session launches anywhere, and a disconnect keeps the history), by count;
  the never-used ones behind **Show all projects** when there are more than five.
- Connect and Disconnect offer Undo. A click on a row opens the Sessions tab with that project
  as its filter.

### 3.5 Modes and launch specs

| Mode | Claude Code | Codex |
|---|---|---|
| Normal | the agent's own settings, no flags | default approvals |
| Full autonomy | `--dangerously-skip-permissions` | `--dangerously-bypass-approvals-and-sandbox` |

- **The modes come from the provider and are listed in `agent.yaml`**, each with its own
  arguments — the shape Pomade's "+" menu reads from `roster.list`, with no translation.
- A disabled mode is offered nowhere: not in the "+" menu, not by Runner.
- **A launch spec** = the command line for an (agent, mode, resume id or new session id?, prompt?)
  combination, with the id the session will have and what to type to end the agent. Pomade's "+"
  menu and Runner both build their launches from it. Claude Code takes a new session's id
  (`--session-id`); Codex cannot, so a caller finds that session with `sessions.find`.
- Custom modes are later ([[P-004]]).

### 3.6 Creating an agent

**Claude Code agents only in v1.** A page of its own, route `roster/new`.

1. **Form,** in this order:
   - **start from**: the blank template `Agents/Claude Agent Template`, or **clone** a folder
     agent (a built-in is never cloned: its config folder holds history and credentials). A clone
     pre-fills the role line, tags and projects; the name starts empty.
   - **name**: `[a-z0-9-]`, starting with a letter or digit, checked while typed. Refused if the
     folder exists, or if `zsh -ilc 'type <name>'` resolves (an existing alias or command).
   - **provider**
   - **role line** (required)
   - **tags**
   - **connect to projects**
   - beside the form, "Create will": the exact steps for the current choices.
2. **Create,** in place, as a list of steps that tick:
   - Copy the template, or the source agent's identity and config: `CLAUDE.md`,
     `settings.json`, `skills/` links, `plugins` link. A clone never copies `projects/`,
     sessions, memory, history, caches or `.claude.json`.
   - Link every `Agents/_shared/skills/*` that's missing.
   - Write `agent.yaml`.
   - Connect the projects.
   - Append `alias <name>='CLAUDE_CONFIG_DIR="<abs folder>" claude'` to `~/.zshrc` (always, once),
     then verify it resolves. When it does not, that step is marked, everything else stays
     created, and the page shows the line to add with **Check again**.
3. **Done:** the page stays, with
   - an agent tab opened by Pomade with the new agent in the first connected project — in the
     Workspace when none is connected
   - a copyable prompt for after `/login`: *"Use the creating-claude-agent skill to set up
     <name>: role …, tags …"*
   - **Go to its tab**, Open its page, Back to Roster
   - The card and the page show **Needs login**, with the prompt to copy, until the agent's first
     session exists.

### 3.7 The "+" menu and the clock icon

- **With the app installed,** Pomade reads the roster from it through the broker
  (`pomade:E-033`): the agent list, commands, enabled modes, hidden agents.
- **When the app is absent or not responding,** Pomade uses its own folder scan +
  `.pomade/agents.json` (PLATFORM rule 7). A broken app never empties the "+" menu.
- **With the app installed,** the clock icon opens the Sessions tab. Otherwise it opens Pomade's
  built-in history dialog.

### 3.8 Settings and skill folders

The app's own settings: a page at route `settings`, opened by the gear at the right of the
Sessions | Roster bar, kept in `settings.yaml` (§4).

- **Skill folders:** the workspace folders the skills catalog reads, subfolders included —
  `Agents/_shared/skills` and `Knowledge/_skills` from the start. Each shows how many skills it
  holds and how many links from how many agents point into it; **Add folder…** picks another;
  **Remove** warns when links depend on it and keeps them.
- An agent's own `skills/` folder is always read.

## 4. Data and files

| What | Where | Synced |
|---|---|---|
| agent profiles | `<workspace>/Apps/pomade-agents/agents/<id>/agent.yaml` | yes |
| session records | `<workspace>/Apps/pomade-agents/sessions/<session-id>.yaml` | yes |
| app settings | `<workspace>/Apps/pomade-agents/settings.yaml` (`adoptedAt`: the first run; the skill folders, §3.8) | yes |
| parse index, stats cache | `<userData>/app-state/pomade-agents/` | no |

**Session record.** One per session, written the first time the app sees the session and on
every change:

```yaml
id: 7b5c3451-0370-4bf9-b6fd-617d56545a78
provider: claude-code            # claude-code | codex
agent: claude                    # roster id
name: G4 agents grill            # absent = unnamed
status: active                   # active | on-hold | done | done-skip
note: waiting for the v0.2.6 test round   # optional
project: <stable project id>     # effective project (§2.6), the first in sidebar order on a shared root; absent = Workspace
projectRoot: Projects/Pomade     # workspace-relative, refreshed on project rename
projectOverride: true            # set when the user used Move to project
launchedFrom: <project id>       # project of the Pomade tab that first ran it
forkedFrom: <session id>
startedByRunner: { job: Morning summary }   # absent = started by the user
outsidePomade: true              # never bound to a Pomade tab (created after adoptedAt)
transcript: /Users/…/7b5c3451-….jsonl
cwd: /Users/…/Projects/Pomade
updated: 2026-11-09T14:32:00Z
```

- **Anyone may read these files.** The format skill (§7) describes them.
- **Only the app writes them**, through its UI, its API or its command. That way the tab title
  follows a rename, and event C fires on a status change.
- Derived numbers (tokens, cost, context, messages) aren't stored here. They come from the
  transcript, through the API.

## 5. Published API

Registered with Pomade's broker (`pomade:E-028`). Callers reach it through the Host API.

| Call | Returns | Callers |
|---|---|---|
| `sessions.get({ id })` | `{ session }`: record fields + §2.3 fields + live state | Runner, git |
| `sessions.lastMessage({ id })` | `{ message: { text, at } \| null }`: the last agent answer as the agent wrote it (Markdown), capped at 4000 characters; `null` while it has not answered | Runner (result cards) |
| `sessions.find({ cwd, startedFrom, startedTo, agent? })` | `{ sessions: { id, provider, agent, cwd, startedAt, lastActiveAt }[] }`: sessions started exactly in that folder (symlinks resolved) within that time window, both ends included; earliest start first | Runner (runs without a pre-set id, e.g. Codex) |
| `sessions.forRepo({ folder, branch? })` | `{ sessions: RepoSession[] }`: sessions whose start folder is `folder` or inside it (a repo or worktree) and, with `branch`, whose recorded branch is that one; newest activity first | git (branch ↔ session link) |
| `sessions.liveIn({ folder })` | `{ live, sessions: LiveSession[] }`: agent tabs and Runner agent runs (`kind: agent`; never script, git or service runs) running at or below `folder` now, including an agent tab not yet prompted; `live` is true exactly when `sessions` is non-empty | git (merge block, In progress rows), `pomade-git` (skip scheduled commit) |
| `roster.list()` | `{ agents: RosterAgent[] }` (the shape in Pomade's `docs/HOST-API.md` §4 "`apps` — the broker", "Platform reads of app APIs"): id, name, command, provider, config dir, enabled modes with their arguments. Hidden agents are left out | Pomade "+" menu and agent launches, Runner |
| `roster.launchSpec({ agent, mode, resume?, sessionId?, prompt? })` | `{ command, args, line, sessionId, exit }`: the agent's command, the arguments, both as one shell line; the session's id (`null` when the provider cannot pre-assign it); what ends the agent. A disabled or unknown mode is refused | Pomade "+" menu, Runner |
| `roster.projectsFor({ agent })` · `roster.agentsFor({ project })` | `{ projects }` stable project ids · `{ agents }` roster ids: the connection, read from each project's visible agents (`["*"]` = every agent; the Workspace offers every agent) | Runner (job form) |
| `roster.agents()` | every agent with its profile, hidden ones and orphans included, its default model and effort; `roster.changed` says when it changes | the app's own frames |
| `liveNow.list()` | the Live now panel's rows — one per running agent tab: its project, session, agent, live state and since when, the session's name and first message; `liveNow.changed` says when they change | the app's own frames |

**The sessions contract.** `sessions.forRepo` and `sessions.liveIn` are a contract shared with
Pomade, fixed in `pomade-kit/protocol` (`agent-sessions.ts`). The app imports its types and
constants (`SESSIONS_APP_ID`, `SESSIONS_FOR_REPO_METHOD`, `SESSIONS_LIVE_IN_METHOD`,
`RepoSession`, `LiveSession`, `SessionStatus`, `SessionLiveState`) and never redefines them.

- **`RepoSession`** = `{ id, agent, name | null, status, live, cwd, branch | null,
  project | null, startedAt, lastActiveAt }`.
  - `status`: `active` · `on-hold` · `done` · `done-skip` (§2.4)
  - `live`: `working` · `needs-you` · `idle` · `closed` (§2.4)
  - `name: null` = unnamed; `branch: null` = the provider records none (Codex); `project: null` =
    the Workspace bucket
- **`LiveSession`** = `{ sessionId | null, agent, cwd, source, job | null }`.
  - `sessionId: null` = an agent tab not prompted yet
  - `source`: `tab` (a Pomade agent tab) or `run` (an unattended Runner run); `job` is the Runner
    job's name for a run and `null` for a tab
- **Folders** (`folder`, `cwd`) are absolute with symlinks resolved.
- **How Pomade reads them** (PLATFORM rule 7):
  - Both methods are declared in the manifest's `api`. Pomade calls them as the caller `pomade`,
    with a 1.5 s limit; after a timeout it doesn't ask again for 10 s.
  - A malformed `forRepo` session is dropped; a malformed `liveIn` answer is ignored whole.
  - The Git panel's In progress row links one session: the live one, else the latest. A worktree
    is matched by its folder, a branch by the repo folder plus the branch name.
  - "Agent live here?" joins this app's answer with Pomade's own terminals. The app's answer only
    adds to it.

**Rule 4:** this app calls no other app. Runner's runs reach it as events (§6).

## 6. Events

**Published** (declared in the manifest, delivered by `pomade:E-031`; subscribers name them
`pomade-agents:<event>`):

| Event | When | v1 |
|---|---|---|
| **A** `session.turnFinished` | an agent answered and waits | declared; not emitted ([[P-013]]). When it is, only while someone subscribes |
| **B** `session.closed` | the session's process ended: `/exit`, tab closed, crash, a Runner run finished | yes |
| **C** `session.statusChanged` | the user changed a status (bulk = one event per session), 5 s after the change | yes |

**Payload, every event:**
- `sessionId`, `provider`, `agent` (roster id), `project` (`{ id, root }`, root
  workspace-relative; `null` for the Workspace bucket)
- `cwd`, `transcript` (the session's transcript file, absolute — Runner's hooks hand it to
  scripts), `name`, `status` (the kit's `SessionStatus` values, §5)
- `startedByRunner` (`true` with the `job` name; else `false`, `job: null`), `at`

C adds `from` and `to`. B adds `reason`: exit · tab-closed · crash · run-finished.

**How B is built:**
- from the platform's **agent tab exited** event (`agentTab.exited`), plus the session bound to
  the tab then; its reasons are the platform's. Pomade quitting (`quit`) pauses a session, so it
  publishes nothing
- for unattended runs, from Runner's **run finished**; while a run runs a session, a tab
  attached to it ending is not the session's end — one end, one B

**How C is timed:** it goes out 5 s after the session's last status change. A change taken back
inside the window (the Sessions tab's Undo) publishes nothing; several changes inside it publish
one event, from the first `from` to the last `to`. A requested stop publishes the pending ones.

Runner's loop guard (it never fires its "agent session finished" hook for its own runs) reads
`startedByRunner`. C always fires: it's a user action. Example use: Done → Runner runs the
Session Analyzer script on that transcript.

**Subscribed:**
- the platform's agent tab exited and binding changes (`pomade:E-031`, `pomade:E-033`)
- Runner's run started / run finished of agent runs (`pomade-runner:run.started`,
  `pomade-runner:run.finished`: session id, job name, agent, folder, start), for ⏱ rows,
  `liveIn` and B. A run without a session id is matched to its session by folder and start time.
  Runs are held in memory: one still running when the connection to Pomade ends is let go of

## 7. Command `pomade-agents`

Linked into `~/.pomade/bin` (`pomade:E-028`):

```
pomade-agents set-name [--session <id>] "<name>"
pomade-agents set-note [--session <id>] "<note>"
pomade-agents show     [--session <id>] [--json]
```

- **Without `--session`,** the command acts on the session bound to the terminal tab it runs in.
  The tab is identified by an environment variable Pomade gives every terminal.
- **There is no status command.** Status is the user's, in the UI.
- **The format skill**, `pomade-agents-sessions`, ships from this repo in the app's build. It
  teaches agents and scripts to read the session records (§4) and to use this command.
- **Every failure** is one line on stderr with its own exit status (CONTRACTS "Command"); with
  Pomade closed, the line says where the record files are.

## 8. Platform and kit usage

| Need | From |
|---|---|
| app tab + panel, manifest, install, dev link, own tabs at a route | `pomade:E-027` |
| with-Pomade backend, broker, the `pomade-agents` command | `pomade:E-028` |
| Agents icon, Live now panel, badge | `pomade:E-029`, `pomade:E-032` |
| projects, groups, sidebar selection (incl. Workspace), stable project ids, project ↔ agent connection, symlinks, open a file | `pomade:E-030` |
| agent tab exited, app-published events, subscriptions | `pomade:E-031` |
| tab ↔ session bindings, titles both ways, live state, focus / launch / resume, "+" menu + clock icon | `pomade:E-033` |
| opening a Runner run's attached terminal | `pomade:E-034` |
| the tab's own route when it navigates by itself (`tabs.setRoute`: the selection) | `pomade:E-045` |
| Host API client, fake host (`pomade-kit` v0.14.0) | `pomade-kit:E-001` |

## 9. Placement

| Capability | Where |
|---|---|
| Sessions tab, Live now panel, Roster tab, detail page, create agent | this app |
| Session data: stores, attribution, names, statuses, notes, overrides, stats, last message, lookups, "live here" | this app (single owner) |
| Roster data: profiles, modes, launch specs | this app; the platform's folder scan is the fallback |
| `~/.zshrc` aliases, agent folders, provider config edits | this app's backend |
| Launching agents, agent tabs, live pty state, session-id capture (`session-watcher`) | platform |
| Project ↔ agent connection (stored as a project setting) | platform; this app edits it and answers others |
| Unattended runs | `pomade-runner` |
| Branch ↔ session link in the Git panel | platform git, using §5 |

## 10. Not in v1

Codex-based agents ([[P-003]]) · custom modes ([[P-004]]) · team-first "+" menu ([[P-005]]) ·
planned sessions ([[P-006]]) · Stats tab ([[P-007]]) · Claude subscription meter ([[P-008]]) ·
transcript tab ([[P-009]]) · Board cards → agents ([[P-010]]) · dashboard widgets ([[P-011]]) ·
own harness / own agents ([[P-012]]) · emitting event A ([[P-013]]) · Runner runs in the Active
group ([[P-014]], parked). Stats roll-ups: v1 scope still to be groomed ([[P-002]]).
