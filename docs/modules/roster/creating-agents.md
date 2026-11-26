---
doc: docs/modules/roster/creating-agents.md
audience: engineers, product
holds: creating a folder agent — the New agent page (template and clone), the name check, the Create's steps and outcomes, the alias, the staging folder, Needs login and the setup prompt
kind: reference
---

# Creating agents

A new agent is a Claude Code **folder agent** — `Agents/<name>/` with its own `CLAUDE.md`, skills and
settings, a profile, an alias in `~/.zshrc` — made from the blank template or cloned from an existing folder
agent. Codex-based agents are not created (the Provider field's Codex button is off). Design:
[ARCHITECTURE](../../ARCHITECTURE.md) §3.6. Contracts: [CONTRACTS "Roster"](../../CONTRACTS.md#roster) ("Creating an
agent"). Users: [New agent](../../user-guide/new-agent.md). Code: `src/ui/roster/new-agent/`
(`NewAgentPage.tsx`, `new-agent-model.ts`, `useNewAgent.ts`), `src/ui/roster/needs-login.ts`,
`src/backend/roster/create-agent.ts`, `src/backend/roster/shell.ts`, `src/shared/agent-name.ts`, the shapes
in `src/shared/roster.ts`.

## The page

Route `roster/new`; `roster/new?clone=<id>` starts it as a clone of that agent (`newAgentRoute`,
`cloneSourceOf`); `new` never names an agent (the name rules refuse it). **New agent** on the Roster and
**Clone…** in a ⋯ menu navigate there; the Roster crumb, **Cancel** and **Back to Roster** go to `roster`. A
new route (another agent to clone) starts the page afresh. The page title is `New agent`,
`New agent — clone of <source>`, `Creating <name>`, `<name> created` or `<name> not created`.

**Form**, in this order, with **Create will** beside it:

- **Start from** — **Blank template** (`Agents/Claude Agent Template`: a blank `CLAUDE.md` its first session
  fills in) or **Clone an agent**. The source menu lists the Claude Code folder agents with a usable profile
  that are not orphans (`cloneable`), each with its role line; a built-in is never cloned, its config folder
  holds history and credentials. A clone takes its source's role line, tags and projects once both the
  roster and Pomade's projects have answered (`clonePrefill`; the projects are those whose visible agents
  list the source); the name starts empty; the user changes them freely. Picking another source prefills
  only the fields the user has not changed (`takePrefill`). Create stays refused until a source is picked (`Pick the agent to clone.`).
- **Name** — focused on open. Checked as typed (below).
- **Provider** — Claude Code; Codex is disabled (`Codex-based agents come later`).
- **Role line** — required, one line, at most 200 characters (`ROLE_MAX`).
- **Tags** — a field in a box: Enter or comma adds a tag, Backspace in an empty field removes the last,
  leaving the field adds what is typed; lower-cased, each once, at most 24 characters each and 20 tags — at 20 the
  field is off, with a hint. The limits are the roster's own (`src/shared/roster.ts`).
- **Connect to projects** — the workspace's projects in sidebar order under their groups, each a checkbox
  with its root. A project that offers every agent already is not listed; a hint names them (`<names> offer
  every agent already.`). With none to choose: `The workspace has no projects.`
- **Create will** — the steps for the current choices, live (`createWill`): copy from the template or the
  source (`CLAUDE.md`, `settings.json`, its skill links, the `plugins` link), link every missing shared
  skill from `Agents/_shared/skills`, write `Apps/pomade-agents/agents/<name>/agent.yaml`, connect the
  checked projects (or `Connect to no project (the Workspace offers every agent)`), append `alias <name>=…`
  to `~/.zshrc` and check it resolves, open a `<name>` tab in the first checked project or the Workspace. For
  a clone it adds `Never copied: projects/, sessions, memory, history, caches, .claude.json.`

**Create agent** (Enter in the name or role field too). If the form is not whole — the name refused or empty,
no role, a clone with no source — the fields turn red, the first is focused and `Fix the fields marked red.`
shows. A name still being checked does not block: the backend checks again first. The phases
(`Phase`): `edit` → `creating` (the steps tick) → `done`, `incomplete` or `failed`; a refused name returns to
`edit` with the verdict on the field.

## The name

Rules the page applies at once and the backend again (`nameRuleProblem`, `src/shared/agent-name.ts`):
`[a-z0-9-]`, a letter or digit first, at most 64 characters, not `new`, nothing with `template` in it. The
rest needs the disk and the shell and is asked of `roster.checkName` after a 300 ms pause in typing
(`NAME_CHECK_DELAY_MS`); an answer about a name no longer typed is dropped, and typing is never blocked by a
slow shell. Order and the page's words ([CONTRACTS](../../CONTRACTS.md#roster) has the table):

| Problem | The page says |
|---|---|
| `empty` | `Name it. Lowercase letters, digits and “-”, starting with a letter or digit.` |
| `leading-dash` | `Start with a letter or digit: a leading “-” breaks the alias.` |
| `characters` | `Only lowercase letters, digits and “-”.` |
| `too-long` | `At most 64 characters.` |
| `reserved` | `A name with “template” in it is skipped by the agent scan.` / `<name> is the New agent page’s own address.` |
| `folder` | `Agents/<name> already exists.` |
| `agent` | `The roster already has an agent <name>.` |
| `shell` | `<name> already runs something in zsh: <zsh's line>.` |
| `shell-error` | `zsh could not be asked (<why>). Try again.` |

Free: `Free: folder Agents/<name>, alias <name>.` with a tick.

## The Create

`roster.create` (`create-agent.ts`) runs these steps in order and answers when all have run (the page's
`apps.call` waits up to 60 s); each start and end is published as `roster.creating { createId, steps }` and
the page's list ticks from it. Without a workspace everything is `not-ready` and **New agent** is off.

| Step | What it does |
|---|---|
| `folder` | copies the template (symlinks as they are) — or, for a clone, only the source's `CLONED_ENTRIES` — into the staging folder `Agents/.<name>.creating-from-template` |
| `skills` | in its `skills/`, a relative symlink `../../_shared/skills/<skill>` for every shared skill folder it lacks; dot-entries skipped |
| `profile` | writes `agent.yaml` (`provider: claude`, `kind: folder`, `configDir: Agents/<name>`, `command: <name>`, the role and tags, `hidden: false`, both modes enabled — a clone takes its source's `modes`), then renames the staging folder to `Agents/<name>` |
| `projects` | per project, in order: `project.getAgents`; a list holding `"*"` already offers every agent, else `project.setAgents` with the name appended. `skip` with none |
| `alias` | appends `alias <name>='CLAUDE_CONFIG_DIR="<workspace>/Agents/<name>" claude'` to the rc file on its own line, unless a line of the file is exactly that; creates the file when missing |
| `verify` | a fresh `zsh -ilc` must define the alias with exactly that command |
| `open` | `agentTabs.launch` of the agent in the first project that connected, else the Workspace, Normal mode; runs only when `verify` is `done`, else stays `todo` |

- **A clone** copies exactly `CLONED_ENTRIES` of the source's config folder: `CLAUDE.md` and `settings.json`
  (a file is copied, a link stays a link), every symlink directly in `skills/` (an own skill folder stays
  behind), and `plugins` when it is a symlink. A relative link is rewritten to reach the same target from
  the new folder. Never `projects/`, sessions, memory, history, caches, credentials or `.claude.json`. A
  source that is not a Claude Code folder agent the roster holds, or an orphan, fails `folder`.
- **The staging folder** holds "template" in its name, so the agent scan skips it. The agent appears whole or
  not at all: any failure in `folder`, `skills` or `profile` removes the staging folder and the
  `agent.yaml` this Create wrote, and the outcome is `failed`; a profile whose folder is not yet in place is
  never visible to the roster for longer than the rename takes.
- **Outcomes:** `created` (every step done or skipped); `incomplete` — the agent exists and `projects`,
  `alias` or `verify` failed, or `open` failed (each failure marks its step and the rest still run);
  `failed`; `refused` (the name cannot be had; nothing is written, every step `todo`).
- **The rc file** is `$ZDOTDIR/.zshrc`, else `$HOME/.zshrc`, of the backend's own environment; every zsh
  runs with exactly that environment (`shell.ts`: `$SHELL` when it is a zsh, else `/bin/zsh`; a 15 s limit,
  the whole process group killed on it). A workspace path holding `'`, `"`, `$`, `` ` ``, `\` or a line break
  cannot go into the alias line: the `alias` step fails. The zsh question prints between markers, so
  whatever the user's rc files print is ignored; the name is passed as an argument, never spliced in.
- **The name is checked again** at the start of `roster.create`, and a Create of a name running now makes
  the second one `folder`-refused.

## What the page shows after the Create

- **Steps** as a list that ticks (`Copy Agents/Claude Agent Template`, `Link the missing shared skills`,
  `Write agent.yaml`, `Connect to …`, `Append the alias to ~/.zshrc`, `Check that <name> resolves in a fresh
  zsh`, `Open a <name> tab in <project>`); a failed step shows its reason.
- **Done** (`created`, or `incomplete` with the alias fine): `<name> is ready`; the new agent's tab is open
  in the first connected project (`Its tab is open in <project>.` — or `Its tab did not open: Go to its tab
  opens one.`), `It starts logged out: run /login there, then paste this prompt so the
  creating-claude-agent skill writes its identity.` with the **setup prompt** and **Copy**, and the buttons
  **Go to its tab** (focuses the tab; opens another when it was closed; `No tab to go to: …` when it
  cannot), **Open its page** (`roster/<name>/overview`) and **Back to Roster**. If a project failed to
  connect, `Not every project was connected. Connect them from <name>’s page, Projects.`
- **The alias did not resolve:** everything else stays created; the page shows `<name> doesn’t resolve in a
  fresh zsh`, the exact line to add (with **Copy**) and the rc file, and **Check again**
  (`roster.checkAlias`: a fresh zsh, nothing written; `not-found` for an agent that is not a folder agent
  the roster holds). When it resolves, both alias steps are marked done and the tab that was held back
  opens (`agentTabs.launch`); `Still not: <why>.` otherwise.
- **Failed:** `<name> was not created; nothing of it was kept.` with **Back to the form** (the form's values
  are kept) — or, when no answer came, `No answer from the app (<why>). Look on the Roster for <name> before
  trying again.`

## Needs login and the setup prompt

A new agent's config folder is logged out, and Claude Code's `/login` is its own step. **Needs login**
(`needs-login.ts`, `NeedsLogin.tsx`) is shown on the agent's card, row (chip) and page until its first
session exists: a Claude Code folder agent with a usable profile, not an orphan, with no session of any
status in its store; read from the sessions' counts, so the first session clears it with no reload; never
shown while the stores' first walk runs. Its notice carries **Copy setup prompt**. The prompt (`setupPrompt`)
is `Use the creating-claude-agent skill to set up <name>: role “<role>”, tags a, b.` — the role and tags left
out when empty. The skill belongs to the workspace, not to this app; the app only writes the words.

## Invariants

- Nothing of a failed Create is kept: no staging folder, no profile it wrote.
- The alias is appended once and verified in a fresh interactive zsh, never resolved or run by the app.
- A name that resolves in the user's zsh (an alias, function, builtin or command) is refused.
- A clone never copies sessions, memory, history, caches, credentials or `.claude.json`.
- `~/.zshrc` is written only by the `alias` step, by appending one line.

## Tests

Unit: `create-agent.test.ts` (name checks in order, every step, clone entries and relative links, failure
cleanup, outcomes, the alias line and `appendOnce`), `shell.test.ts` (rc file, the zsh answer's markers,
timeouts), `new-agent-model.test.ts` (name states and words, Create will, phases), `needs-login.test.ts`.
End to end: `e2e/create-agent.spec.ts` (a Create end to end with the rc file and a resolving alias,
refused names, an rc file that cannot be written and Check again, a slow shell),
`e2e/clone-agent.spec.ts` (Clone…, what a clone copies, the tab and the prompt, Needs login until the first
session).

Known limits: Claude Code only.

Tickets: T-025, T-026, T-037.
