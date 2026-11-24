---
doc: docs/user-guide/agent-page.md
audience: users
holds: how to use an agent's page — the header and its tabs Overview, Skills, Projects, Model & modes, Permissions, Memory and Sessions, task by task
kind: reference
---

# Agent page

One agent in detail. Open it from the [Roster](roster.md): click the agent's name, **Open** on a card, ⋯ →
**Open agent page**, or the **Connected to** field (which opens the **Projects** tab). **← Roster** goes
back. The page remembers its tab: a reload, or restarting Pomade, opens the same one.

## The header

The agent's name — for the built-ins, `claude` and `codex` — with its chips (`Needs login`, `built-in`,
`orphan`, `hidden`, `agent.yaml can’t be read`), **Start session ▾** and ⋯. Under the name: the provider, the
default model and effort (`provider default` when none), and `launches with <command>` — the shell alias
Pomade types to start it.

- **Start session ▾** works as on the Roster: mode, then project, then **Workspace**. It is not shown for an
  orphan and is off for a hidden agent.
- **⋯**: **Clone…**, **Hide from the “+” menu** / **Show in the “+” menu** (with Undo), **Open CLAUDE.md**,
  **Open agent.yaml**.
- A notice appears under the name when the agent is an orphan, its `agent.yaml` can't be read, or it **Needs
  login** (see [Roster](roster.md)); the last has **Copy setup prompt**.

Toasts at the bottom of the page say what a change did, with **Undo** where it can be taken back.

## Overview

The **role line** and **tags**, edited in place as on the Roster (click, Enter or click away saves, Esc
drops; tags: `×` removes, `+ tag` adds, Enter or a comma adds one). Then the facts:

- **Provider** — `Claude Code · folder agent`, `built-in`.
- **Launch command** — the alias, read-only.
- **Config folder** — where the agent's `CLAUDE.md`, skills and settings live.
- **Identity** — **CLAUDE.md**, which opens in Pomade's editor.
- **Profile** — the path of `agent.yaml`; click to open it.
- **Last active** and **This week** (`3 sessions · ~$2.10`, or `no sessions`).

## Skills

The skills the agent can use are links in its `skills/` folder to skills in your **Skill folders**
(configured in Settings, the gear at the right of the Sessions | Roster bar). The tab groups them by folder,
then folders no longer in Settings (marked `not in Skill folders`), then **Own** skills — real folders in
the agent's own `skills/`, which the app never touches.

- **Switch a skill off or on.** Off removes the link, on makes it again; the skill itself is never touched.
  A toast says `Removed the link …` or `Linked … → …` with **Undo**. A skill you switched off stays in its row,
  off, while you are on the tab. A new session picks the change up; a running one does not.
- Each row says `only here` or `also in <agents>`, so you see who shares it. A `broken link` (nothing at its
  target) has a switch that removes it.
- **Add skill** opens the catalog of every skill in your Skill folders that the agent doesn't have. Type
  in **Search the catalog** to filter by name or description; a skill shows its description and `in N`
  (how many agents use it). Pick one to link it, with **Undo**. A skill whose name collides with an entry
  already in `skills/` is greyed out. **Skill folders…** at the end opens Settings.
- Codex has no skills folder: the tab says so.

## Projects

Where the agent is offered and where it worked.

- **Connected** — projects whose “+” menu offers the agent, under your sidebar's groups. **Disconnect** stops
  offering it there (its sessions there stay). A project that offers every agent shows `offers every agent` with a
  lock: change that in the project's own settings.
- **Not connected** — projects where the agent has sessions come first, each with **Connect**; the rest
  follow, folded behind **Show all projects** when there are more than five.
- **Sessions (90 d)** is the agent's work sessions in the project in the last 90 days; **Last session** is
  its latest one there, however old.

**Connect** and **Disconnect** change the project's own setting, the same list as in Pomade's project
settings; a toast offers **Undo**. They are off for an orphan, an agent whose `agent.yaml` can't be read,
and with no workspace. Click a row to open this agent's **Sessions** tab filtered to that project. The
Workspace is not listed: it offers every agent.

## Model & modes

**Model** (Claude Code agents):

- **Default model** — a menu of `opus`, `sonnet`, `haiku` (and the file's own model when it names another),
  or **Provider default**, which removes the setting.
- **Effort** — `low`, `medium`, `high`, `xhigh`.

A choice is written to the agent's own `settings.json` — only the `model` and `effortLevel` keys; nothing else
in the file changes. A toast says what was written. Sessions already running keep theirs. If the file isn't
valid JSON the tab says why and offers nothing to change; the app never writes over it. Codex shows its model
and effort read-only, from `config.toml`.

**Modes** — **Normal** is always offered. **Full autonomy** (the agent skips every permission prompt) has a
switch: off, it is no longer offered in Pomade's “+” menu, by Runner, or in this agent's **Start session**. A
toast says so; switch it on again to offer it. Each offered mode shows the command line that starts it, with
a **Copy** button; the line is what Pomade types. Read-only.

Both are locked, with the reason on hover, for an orphan, an agent whose `agent.yaml` can't be read, and with
no workspace.

## Permissions

What the agent's provider config allows, read-only: **Default mode**, **Allow**, **Ask** (when set), **Deny**,
**MCP servers** with their type, **Plugins** (Claude Code); **Approvals**, **Sandbox**, **MCP servers** (Codex).
**Open settings.json** (or **Open config.toml**) opens the file in the editor to change them.

## Memory

The projects the agent keeps memory for — one row each, with its memory files (`MEMORY.md` first). Click a file to
open it in the editor. A folder that matches none of your projects shows under its own name. `No project
memory yet.` when there is none; Codex agents have none.

## Sessions

The agent's latest 50 sessions across every project, newest first: status mark, live mark, name, project,
model and effort, ~$ est., last active. The **Project** menu filters to one project (with counts); **Clear**
removes the filter, and the filter survives a reload. **Open in Sessions** opens the Workspace's Sessions tab
filtered to this agent (and the project, if one is chosen), with every session and every action
([Sessions](sessions.md)).

## Keys

Menus: ↑ ↓ move, Home and End jump, Enter picks, Esc or Tab closes; in a search field ↓ goes to the first
item and Enter picks it. Role line and tags: as on the [Roster](roster.md).
