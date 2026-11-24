---
doc: docs/modules/roster/index.md
audience: engineers, product
holds: the roster module — its scope, code locations, the rules that hold across it and a summary of each page
kind: reference
---

# Module: roster

The agents the app knows and everything done to them: the roster the backend builds from agent folders and
profile files, the Roster tab (cards and a list), each agent's page (profile, skills, projects, model and
modes, permissions, memory, sessions), and creating or cloning an agent. Pomade reads the same roster
(`roster.list`, `roster.launchSpec`, the project connections) for its "+" menu and Runner.

Code: `src/backend/roster/` (the roster, profiles, first sight, orphans, launch specs, connections, provider
config, creating agents, skill links and the catalog), `src/ui/roster/` (`list/` the Roster, `agent-page/`,
`new-agent/`, `commands/` the actions shared by card, row and page, `profile-edit/` role line and tags in
place), shared shapes in `src/shared/` (`roster.ts`, `skills.ts`, `agent-name.ts`, `model-choices.ts`,
`work-sessions.ts`), routes in `src/ui/core/routes.ts`, handlers in `src/backend/interfaces/api.ts`
([interfaces](../interfaces/index.md)). Specs: `e2e/roster*.spec.ts`, `e2e/agent-*.spec.ts`,
`e2e/create-agent.spec.ts`, `e2e/clone-agent.spec.ts`, unit tests beside the code. Interfaces:
[CONTRACTS "Roster", "Agent counts", "Skills"](../../CONTRACTS.md#roster); design:
[DESIGN](../../DESIGN.md) §3. For users: [Roster](../../user-guide/roster.md),
[Agent page](../../user-guide/agent-page.md), [New agent](../../user-guide/new-agent.md). The app's
Settings page with the skill folders is the Settings page's own ([DESIGN](../../DESIGN.md) §3.8); this
module links to it and reads its catalog.

| Page | Summary |
|---|---|
| [roster-data](roster-data.md) | The backend roster: which agents exist and in what order, `agent.yaml` and its writers, first sight and unusable files, orphans with unclaimed folders, re-link and its byte-for-byte undo, remove, hiding an agent and switching a mode (`roster.updateProfile`), `roster.list` / `roster.agents` / `roster.connections`, the rebuild cycle and `roster.changed`, launch specs and their shell quoting, project connections. |
| [roster-tab](roster-tab.md) | The Roster tab: what it reads and keeps current, header and order, the card and the list row, **Connected to** (ranking, fit, tooltip), this week's numbers and Last active, state chips and notices, **Needs login**, and the actions that a card, a row and the agent page share — **Start session ▾**, Sessions, the ⋯ menu, Hide / Show, role line and tags in place, **Re-link**, **Remove**. |
| [agent-page](agent-page.md) | The agent's page: route and states, the header, and each tab — Overview, Skills (switches that make and remove symlinks, Add skill), Projects (Connect / Disconnect), Model & modes (model and effort written to `settings.json`, the Full autonomy switch, launch lines), Permissions, Memory, Sessions (the route-held Project filter). |
| [agent-config](agent-config.md) | The backend behind the page: reads of permissions, MCP servers, plugins, memory and model config; the key-preserving `settings.json` write for model and effort; skill link writes confined to the agent's own `skills/`. |
| [creating-agents](creating-agents.md) | New agent from the template or as a clone: the form and the name check, "Create will", the Create's steps (staging folder, shared skills, `agent.yaml`, projects, alias, verify, open tab) and outcomes, the alias in `~/.zshrc`, Check again, Needs login and the setup prompt. |

## Rules that hold across the module

- **Files are the truth, edits touch only what they name.** `agent.yaml` keeps comments and extra keys;
  `settings.json` keeps every byte but the `model` and `effortLevel` keys; skill writes are symlinks inside
  the agent's own `skills/`; nothing is written over a file the app cannot use.
- **Nothing the user cannot take back is silent.** Hide / Show, a re-link, a skill link and a project
  connection each offer Undo in a toast; Remove asks first; a Create that fails before the agent is whole keeps nothing of it.
- **Read-only where the data is not the app's:** no workspace, an orphan, an unusable `agent.yaml`, a Codex
  agent's config.
- **One implementation per action.** A card, a row and the agent page's header act through
  `src/ui/roster/commands/`.
- **Every count is over work sessions** ([sessions](../sessions/index.md)); the windows (this week, 90 days)
  are the Roster's own.

## Tests

Unit tests beside the code (listed on each page) and the Playwright specs against the fake Pomade named
above; run with the gate described in [testing](../core/testing.md).

Tickets: T-019, T-020, T-021, T-022, T-023, T-024, T-025, T-026, T-033, T-034.
