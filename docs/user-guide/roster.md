---
doc: docs/user-guide/roster.md
audience: users
holds: how to use the Roster tab — reading the cards and the list, starting a session, finding an agent's sessions, editing a role line and tags, hiding an agent, cloning, fixing an orphan, Needs login
kind: reference
---

# Roster

The Roster tab lists your agents — Claude and Codex, and every folder agent in `Agents/` — with what each is
for, where it is connected, when it last worked and how much it did this week. Open it from the Agents
icon's panel (**Roster** button) or from the **Sessions | Roster** switch at the top of the Agents tab. An
agent's own page is [Agent page](agent-page.md); making a new one is [New agent](new-agent.md).

## What you see

The header says `Roster`, `7 agents` and `This week: 11 sessions · ~$9.85` — the work sessions of all agents
this week (from Monday) and their estimated cost; **work sessions** are every session except those in
**Done–skip/Failed**. `Indexing…` shows while the agents' stores are read for the first time. The two
buttons at the right switch between **Cards** and **List** (the app remembers your choice on this Mac), and
**New agent** makes one.

Agents are in a fixed order: Claude, Codex, then folder agents by name. Agents you hid from the “+” menu are
in their own section at the end, **Hidden from the “+” menu**; click its title to fold it.

An agent shows:

- its **name** (click it to open its page) and chips: `built-in`, `orphan`, `hidden`,
  `agent.yaml can't be read`, `Needs login`;
- the provider and the default model: `Claude Code · opus-4.8 high`, or `provider default` when the
  provider's settings choose none;
- its **role line** and, on a card, its **tags**;
- **Connected to**, **Last active** (`5m`, `3h`, `yesterday`, `Nov 3`; `never` for an agent with no work
  session) and **This week** (`3 sessions · ~$2.10`; the cost is left out when unknown).

The list drops columns as the tab narrows: provider and model and **This week** first, then **Last active**,
then **Connected to**.

## Connected to

An agent is connected to a project when the project's “+” menu offers it. The field shows the number of
projects, then the ones where the agent worked most in the last 90 days: `8 (■ pomade-agents, ■ Pomade, …)`.
A card names up to three projects, a row up to two, as many as fit; `…` at the end means more are connected
than named. Hover for the full list with each project's work sessions. `All 12 (…)` means every project;
`No projects` means none (the Workspace offers every agent, so you can still start it there). Click the
field to open the agent's **Projects** tab, where you connect and disconnect.

## Start a session

**Start session ▾** on a card or a row opens a menu:

1. **Mode** — **Normal** or **Full autonomy**, shown only when the agent offers both.
2. **Connected** projects, then **Not connected** projects.
3. **Workspace**.

Pick a project: Pomade opens a new agent tab for the agent in that project and mode. The button is off, with
the reason on hover, when no workspace is open, the agent is an orphan, or it is hidden from the “+” menu
(show it first).

## See an agent's sessions

**Sessions** on a card — or **Sessions** in the ⋯ menu on a row — opens the Workspace's Sessions tab already
filtered to that agent. [Sessions](sessions.md) explains the tab.

## Edit the role line and tags

Click the role line to edit it, then press Enter or click away to save; Esc drops the change. An empty line
removes the role. It is one line, up to 200 characters.

On the tags, `×` removes one and `+ tag` (shown when you hover the tags) opens a field: type a tag, press
Enter or a comma to add it (the field stays open for the next), click away to add what you typed, Esc to
close without adding. Tags are lower case, up to 24 characters, each once, up to 20 per agent.

Both are saved to the agent's `agent.yaml` at once and a toast says so (`Role line saved to agent.yaml.`).
Nothing on the card moves while you edit. Built-in agents are editable too; an orphan, an agent whose
`agent.yaml` can't be read, and every agent when no workspace is open, are not.

## Hide an agent from the “+” menu

⋯ → **Hide from the “+” menu** takes the agent out of Pomade's “+” menu and out of launches; its card moves
to the hidden section and its sessions stay. ⋯ → **Show in the “+” menu** brings it back. A toast offers
**Undo**.

## Other things in the ⋯ menu

- **Open agent page** and **Sessions** (on the Roster only).
- **Clone…** — [New agent](new-agent.md) starting from this agent. For Claude Code folder agents.
- **Open CLAUDE.md** and **Open agent.yaml** — open the file in Pomade's editor. The agent's profile file is
  `Apps/pomade-agents/agents/<name>/agent.yaml`.

## An agent whose folder is gone

If you rename or delete an agent's folder in `Agents/` outside the app, its card says `orphan` and `Its
config folder … is gone`. It is left out of the “+” menu and cannot start a session. Two ways out:

- **Re-link ▾** lists the **Unclaimed agent folders** — folders in `Agents/` that no agent owns, such as the
  one you renamed to. Pick it: the agent keeps its name, its profile, role and tags, and points at that
  folder. The toast `<name> now points at Agents/… It is back in the “+” menu.` offers **Undo**, which puts
  everything back as it was. `None: every agent folder is an agent’s own.` means there is nothing to pick.
- **Remove** asks `Remove <name>’s profile? …`; then **Remove** deletes the agent's profile
  (`Apps/pomade-agents/agents/<name>/`). No agent folder is touched. **Cancel** keeps it.

## An agent.yaml the app can't read

An agent whose `agent.yaml` is broken says so on its card, with **Open agent.yaml**. It keeps working from
the values the app would give a new agent, nothing about it can be edited here, and the app never writes
over the file. Fix the file; the card updates by itself.

## Needs login

A new agent, until it has had a session, has `Needs login`: its config folder is logged out. The card says
`Log in with /login in its tab, then paste the setup prompt.` — **Copy setup prompt** copies the sentence
that has the `creating-claude-agent` skill write the agent's identity. Start a session, run `/login`, paste.
The chip and notice go as soon as the agent's first session appears.

## No workspace, no agents yet

With no workspace open the Roster shows Claude and Codex with their defaults, read-only, and **New agent**
is off. With a workspace but no folder agents, a `No folder agents yet` note under the built-ins has a **New
agent** button.

## Keys

Click-driven, with these keys:

- Menus (**Start session ▾**, ⋯, **Re-link ▾**): ↑ ↓ move, Home and End jump, Enter or Space picks, Esc or
  Tab closes.
- Role line: Enter saves (or opens the field when the line has focus), Esc drops.
- Tag field: Enter or `,` adds, Esc closes.

The Sessions tab's keys are in [keyboard-shortcuts](keyboard-shortcuts.md).
