---
doc: docs/user-guide/new-agent.md
audience: users
holds: how to create a new agent from the blank template or by cloning one, what Create does, fixing the alias, and the first login
kind: reference
---

# New agent

A new agent is a Claude Code folder agent: its own folder in `Agents/<name>/` with a `CLAUDE.md`, skills and
settings, started by its own command (`<name>`) from Pomade's “+” menu. Create one from the **Roster**: **New
agent**, or ⋯ → **Clone…** on an agent to start from it. It needs an open workspace; without one **New agent**
is off.

## Fill in the form

1. **Start from** — **Blank template** (the folder `Agents/Claude Agent Template`, with a blank `CLAUDE.md`
   the agent's first session fills in) or **Clone an agent**. Cloning copies the agent's `CLAUDE.md`,
   `settings.json`, skill links and plugins link, and pre-fills **Role line**, **Tags** and **Connect to
   projects** from it; change them freely. It never copies the agent's sessions, memory, history, caches or
   `.claude.json` (its login), so a clone starts logged out. Built-in agents can't be cloned. Picking another
   source replaces what the form took from the first.
2. **Name** — lowercase letters, digits and `-`, starting with a letter or digit, up to 64 characters. It
   becomes the folder, the command you type, and the name in the “+” menu. The page checks it as you type
   and says why a name is refused:
   - the folder `Agents/<name>` already exists, or the Roster already has an agent of that name;
   - the name already runs something in your terminal (zsh) — a command like `ls`, an alias or a function;
   - it contains `template`, or is `new`.
   A green tick and `Free: folder Agents/<name>, alias <name>.` mean it is free.
3. **Provider** — Claude Code. (Codex agents come later.)
4. **Role line** — required: one line on what the agent is for (up to 140 characters). The card and the setup
   prompt use it.
5. **Tags** — Enter or a comma adds a tag; Backspace in the empty field removes the last.
6. **Connect to projects** — tick the projects whose “+” menu should offer the agent. A project that already
   offers every agent isn't listed. With none ticked, the agent is still available in the Workspace.

**Create will**, beside the form, lists exactly what Create will do for your choices. Press **Create agent** (or
Enter in the name or role field). If something is missing the fields turn red and `Fix the fields marked red.`
shows. **Cancel** or **← Roster** leaves without creating anything.

## Create

The steps tick in place:

1. Copy the template (or the source agent's files) into `Agents/<name>/`.
2. Link every shared skill from `Agents/_shared/skills` the folder lacks.
3. Write the agent's profile, `Apps/pomade-agents/agents/<name>/agent.yaml`.
4. Connect the ticked projects.
5. Append a line to your `~/.zshrc` — `alias <name>='CLAUDE_CONFIG_DIR="…/Agents/<name>" claude'` — once, and
   check that a fresh terminal resolves it. This is how the agent starts: the command is its alias.
6. Open a tab with the new agent in the first ticked project (the Workspace when none).

The agent appears whole or not at all. If copying, linking or writing the profile fails, nothing of the agent
is kept, and the page says so; **Back to the form** keeps what you typed.

## When it is ready

The page says `<name> is ready` and stays. Its tab is open in the first connected project. The agent starts
**logged out**: in that tab run `/login`, then paste the **setup prompt** — `Use the creating-claude-agent
skill to set up <name>: role “…”, tags …` — so the skill writes the agent's identity into its `CLAUDE.md`.
**Copy** copies the prompt. Until the agent's first session, the Roster shows `Needs login` on its card with the
same prompt ([Roster](roster.md)).

- **Go to its tab** brings the agent's tab to the front, or opens a new one if you closed it.
- **Open its page** opens the [Agent page](agent-page.md).
- **Back to Roster** returns to the Roster.

If a project couldn't be connected the page says `Not every project was connected`; connect it from the agent's
**Projects** tab.

## When the alias doesn't resolve

If your `~/.zshrc` can't be written, or something later in it overrides the alias, the agent is still created
but its tab doesn't open. The page shows the line to add — **Copy** it, paste it into your `.zshrc` (or the
file it names) — and **Check again**. When a fresh terminal resolves the name, both alias steps tick and the tab
opens. `Still not: …` says what zsh answered.

## Keys

In the name and role fields Enter creates the agent. In the tags field Enter or a comma adds a tag and
Backspace removes the last. Menus (the clone source list): ↑ ↓ move, Enter picks, Esc closes.
