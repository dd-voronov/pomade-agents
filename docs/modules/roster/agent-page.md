---
doc: docs/modules/roster/agent-page.md
audience: engineers, product
holds: the agent's page — route and states, the header, and each tab (Overview, Skills, Projects, Model & modes, Permissions, Memory, Sessions) with its data and rules
kind: reference
---

# The agent's page

One agent in detail, at the route `roster/<agent>/<tab>` (`src/ui/roster/agent-page/`). Design:
[DESIGN](../../DESIGN.md) §3.4, §3.5. Users: [Agent page](../../user-guide/agent-page.md). The backend files
the tabs read and write: [agent-config](agent-config.md); the profile and the roster:
[roster-data](roster-data.md).

## Route and states

- `<agent>` is the roster id, URI-encoded; `<tab>` is one of `overview`, `skills`, `projects`, `model`,
  `permissions`, `memory`, `sessions` (`AGENT_TABS`, in the page's order). A route with no tab, or one this
  build does not know, opens `overview`; `roster/new` is never an agent. The tab is the route, so a reload
  and a restart of Pomade open the same tab (`navigate` → `tabs.setRoute`). Helpers: `agentRoute`,
  `agentPageOf`, `agentSessionsRoute`, `agentProjectOf` in `src/ui/core/routes.ts`; the routes are in
  [CONTRACTS "Surfaces and routes"](../../CONTRACTS.md#surfaces-and-routes).
- The page reads `roster.agents` / `roster.changed` like the Roster (`useRoster`), the agents' counts
  (`useAgentCounts`) and the projects (`useProjects`), and hands each tab an `AgentContext`
  (`agent-context.ts`); a tab is one file listed in `tabs.tsx` that takes it and nothing else.
- **States:** `Reading the roster` until the first answer; `Background: not answering` (warning) when the
  app's backend does not answer; **No such agent** (`The roster has no agent called “<id>”…`) with **Back
  to the Roster** for an id the roster does not hold.
- A toast (4 s) carries what a tab did or why it did not; one toast at a time.

## Header

`AgentHeader.tsx`, over the tab bar:

- **← Roster** (to `roster`); the agent's name, as on its card (`Claude` for the built-in; a folder agent's
  name is its id); the state chips; **Start session ▾** (not for an orphan) and the **⋯** menu.
- **Chips**, in order: `Needs login`, `built-in`, `orphan`, `agent.yaml can’t be read` (cause on hover),
  `hidden` — the card's own list (`state-chips.ts`), read from the roster entry.
- **Under the name:** `id <id>` when the id differs from the name (the built-ins), the provider, the default model + effort (`provider default` when none; the effort is
  shown only with a model), and `launches with <command>` when the profile is usable.
- **Notices** (`entry.orphan`, `entry.problem`, Needs login): the config folder is gone, with its path;
  `agent.yaml <problem>. The agent runs on its first-sight values; the file is never written over.`; and
  the Needs login notice with **Copy setup prompt** ([roster-tab](roster-tab.md) "Needs login").
- **Start session ▾** and **⋯** are the Roster card's own ([roster-tab](roster-tab.md) "Actions"): the ⋯
  menu here is **Clone…**, **Hide from / Show in the “+” menu**, **Open CLAUDE.md**, **Open agent.yaml**
  (no Open agent page or Sessions entry). Clone… navigates to `roster/new?clone=<id>`
  ([creating-agents](creating-agents.md)).

## Overview

Role line and tags, edited in place with the Roster's `RoleLine` and `TagList` (editable when the profile is
usable and the agent is not an orphan; otherwise shown, `No role line` / `No tags`), then facts:

| Fact | Shows |
|---|---|
| Provider | `Claude Code · folder agent` / `· built-in`, `Codex · built-in` |
| Launch command | the profile's `command`, read-only, `its shell alias`; `—` without a usable profile |
| Config folder | the profile's `configDir` as written |
| Identity | **CLAUDE.md**, opens in Pomade's editor; `Codex has no CLAUDE.md` |
| Profile | the path of `agent.yaml`, opens in the editor |
| Last active | from the counts: relative time (full time on hover), `never`, `—` before the counts answer |
| This week | `3 sessions · ~$2.10`, `no sessions` |

## Skills

`SkillsTab.tsx`, `skills-model.ts`. The agent's `skills/` entries, grouped (`skillGroups`): each **listed
skill folder** in the Settings list's order (the path as listed, a count of links switched on), then each
folder a link points into that Settings no longer lists (marked `not in Skill folders`; **Add skill** does
not offer its skills, the links keep working), then **Own** (real folders in the agent's own `skills/`).
Empty groups are not shown; rows by name.

- A row: a **switch** (own skills have an `own` mark instead and are never touched), the name, the skill's
  `SKILL.md` description, and `only here` / `also in a, b +2` (other agents linked to the same skill by
  real path). A broken link shows `Nothing at <path>` and `broken link`; its switch removes it.
- **Off** removes the symlink (`skills.unlink`), **on** makes it again (`skills.link`, to the link's own
  target). The link switched off stays in its row, off, while the tab is open for that agent, so switching
  never moves a row. Each write disables its switch until answered; the toast says `Removed the link
  <where>/<name>` or `Linked <where>/<name> → <target>` with **Undo** (the opposite write; an Undo offers no
  further Undo). A refused write says `The link was not changed. …` with the reason.
- **Add skill** opens a searchable menu (`Search the catalog`, matching name, folder name and description)
  of the catalog's skills the agent has no link to, under their folder, each with its description and `in N`
  (agents linked); one whose entry name is taken is disabled (`skills/<name> is already there`). A pick
  makes the link with the same toast and Undo. The menu ends with **Skill folders…**, which opens the
  Settings page (route `settings`), as does the lead line's link. A catalog with no folders says `No skill
  folders: add one in Settings.`
- The tab says `Off removes the link, on creates it; a new session picks the change up.` Codex agents:
  `Codex reads no skills/ folder.` An agent whose `skills/` the catalog does not read (an unusable profile,
  an orphan): `This agent’s skills/ folder is not read…`.
- The catalog is `useSkillsCatalog` (`src/ui/settings/`): read on request, again on `skills.changed` and
  when the tab comes back into view. Write rules: [agent-config](agent-config.md).

## Projects

`ProjectsTab.tsx`, `projects-model.ts`, `project-offers.ts`, `useVisibleAgents.ts`. One table, **Project ·
Sessions (90 d) · Last session**: every project of the workspace (the Workspace is not a row; it offers every
agent), in two bands.

- **Connected** — projects whose visible agents list the agent or are `["*"]`, under the sidebar's groups
  (path `Work / Clients`, `Ungrouped`), most sessions first inside a group. A row has **Disconnect**; a
  project offering every agent shows a lock, `offers every agent`, and is never rewritten from here. With
  none: `No project offers <agent>. Connect one below, or start it in the Workspace, which offers every
  agent.`
- **Not connected** — first the projects the agent has work sessions in (most sessions, then the latest;
  the band says `N with sessions`), each with **Connect**; then the never-used ones under their groups,
  folded behind **Show all projects** (`N more`) when more than 5.
- **Sessions (90 d)** is the agent's work sessions in the project active in the last 90 days (`—` for none
  ever); **Last session** is the latest work session there, however long ago (`ProjectCounts` from
  `sessions.agentCounts`, [CONTRACTS "Agent counts"](../../CONTRACTS.md#agent-counts)). A row's project name
  is a button and the whole row is a click: it navigates to `roster/<agent>/sessions?project=<id>`.
- **Connect** and **Disconnect** (`connectAgent`, `disconnectAgent`) read the project's list with
  `project.getAgents`, edit that list and write it whole with `project.setAgents`, so a change made elsewhere
  meanwhile is kept; they refuse a list holding `"*"`, an agent already (not) in it. Toasts: `<project>’s
  settings now list <agent>.` and `<project> no longer offers <agent>. Its sessions there stay.`, each with
  **Undo** (a disconnect's Undo puts the agent back at its old place). The buttons are off, with the reason,
  without a workspace, for an orphan and for an unusable profile.
- Visible agents are read per project and again on `project.created`, `.renamed`, `.removed`, `.updated`;
  a project that cannot be read is treated as not offering the agent.
- Caption: `Sessions (90 d): work sessions — every session except Skip/Failed ones — active in the last 90
  days. Last session: the latest of them, however long ago.`

## Model & modes

`ModelTab.tsx`, `model-tab-model.ts`, `useLaunchLines.ts`. **Model** — `roster.modelConfig`:

- Claude Code: **Default model** (a menu: `opus`, `sonnet`, `haiku`, the file's own model when it names
  another, then `Provider default`, which removes the key) and **Effort** (`low`, `medium`, `high`,
  `xhigh`; the active level cannot be cleared). A pick calls `roster.setModel`; the toast says what was
  written (`settings.json: "model": "opus".`, `… "effortLevel": "high" — no other key changed.`, `…model
  removed — the provider’s default applies.`). The hint says which file and keys are written and that
  sessions already running keep theirs. Locked, with the reason: no workspace (`Read-only: no workspace is
  open.`), an orphan, an unusable profile; and a `settings.json` that cannot be used is reported with
  **Open settings.json** and never written over.
- Codex: model, effort and the file they come from, read-only, with `Read-only here: editing Codex’s model
  comes with Codex-based agents.`
- The tab shows the latest read, or a write's own answer until the next read lands.

**Modes** — one row per mode (`Normal`, `Full autonomy`) with what it does per provider (`the agent’s own
settings, no flags`; `skips every permission prompt` / `bypasses approvals and the sandbox` / `default
approvals`), a switch, and, for an enabled mode, its launch line from the backend's own `roster.launchSpec`
(read-only, hover for the whole line, **Copy** — copies it, `Copied` for 1.5 s). The lead line says the
spec is what Pomade's “+” menu and Runner build from, how a new session gets its id (`--session-id` for
Claude Code; Codex callers use `sessions.find`) and what ends the agent (`/exit`).

- **Normal** is always on and its switch is locked. **Full autonomy**'s switch is `roster.updateProfile({
  modes })`; the switch shows its new state from the click until the roster answers; others are locked
  meanwhile (`Saving…`). A mode that is off says `Not offered: not in the “+” menu, not by Runner, not on
  this agent’s Start session.` An orphan says `Not launched: its config folder is gone.` No Undo; the
  toast says `Full autonomy is off for <agent>: …` or `… is offered for <agent> again.`
- Launch lines are asked again when the roster changes; a mode the backend refuses shows its reason.

## Permissions

`PermissionsTab.tsx` — `roster.permissions`, read-only. A button opens the config file in the editor
(**Open settings.json** / **Open config.toml**; off with `… does not exist yet`). Facts: Claude Code —
**Default mode**, **Allow**, **Ask** (only when not empty), **Deny**, **MCP servers** (name and type),
**Plugins**; Codex — **Approvals**, **Sandbox**, **MCP servers**. `none` / `not set` for empty values. A file
that cannot be read is a notice with the cause; the hint says where the facts come from.

## Memory

`MemoryTab.tsx`, `memory-model.ts` — `roster.memory`: a row per project folder that holds memory, named
after its workspace project (`Workspace` for the workspace itself; an unknown folder shows its own name,
dimmed), with its files (`MEMORY.md` first); a file opens in the editor. `No project memory yet.` for none
(Codex always).

## Sessions

`AgentSessionsTab.tsx`, `agent-sessions-model.ts`. This agent's sessions across every project, newest
activity first, **the latest 50** (`SESSIONS_SHOWN`; `The latest 50 of N. Open in Sessions has them all.`),
from the Sessions tab's own copy (`useSessions`): every status, hidden sessions left out. A row: the status
square, the live mark, the name (the first message, grey, when unnamed), the project, model + effort, ~$ and
last active (full time on hover). The **Project** filter (`All projects` and every project the agent has
sessions in, each with its count) is the route's: choosing one navigates to
`roster/<agent>/sessions?project=<id>` (`agentSessionsRoute`; the id URI-encoded; `agentProjectOf` reads it
back), so a reload and a restart keep it; **Clear** removes it. **Open in Sessions** opens the Workspace's
Sessions tab at `sessions?agent=<id>[&project=<id>]`
([sessions-tab](../sessions/sessions-tab.md) "Search and filters"). Empty: `No sessions yet.` /
`No sessions of <agent> in <project>.`

## Opening files

Open CLAUDE.md, agent.yaml, `settings.json` / `config.toml` and a memory file use `tabs.openFile`
(`open-file.ts`): a workspace-relative path inside the workspace (as Pomade names it, or resolved), the
absolute path outside it. A refusal is a toast, `<file> was not opened. <cause>`.

## Invariants

- The page holds no state a reload would lose: the tab and the sessions' project filter are in the route;
  the skills tab's off-rows and Show all projects are per visit.
- Every write is through a backend method or Pomade's project API, never straight to a file, and each
  answers before the page shows it as done.
- Read-only means read-only: an orphan, an unusable profile, no workspace and Codex's config offer no write.
- A card, a row and this header act through the same code (`commands/`).

## Tests

Unit: `agent-model.test.ts`, `skills-model.test.ts`, `projects-model.test.ts`, `project-offers.test.ts`,
`memory-model.test.ts`, `agent-sessions-model.test.ts`, `needs-login.test.ts`. End to end:
`e2e/agent-page.spec.ts` (each tab from the folder's files, reload on the tab, Sessions filter, role and
tags, unusable and orphan states, opening files, header actions, built-ins, unknown route, widths),
`e2e/agent-skills.spec.ts`, `e2e/agent-projects.spec.ts`, `e2e/agent-model.spec.ts`.

Known limits: the command is not editable; a Codex agent's skills and model are read-only; the Memory tab
cannot delete or edit memory (it opens files).

Tickets: T-022, T-023, T-024, T-034, T-033.
