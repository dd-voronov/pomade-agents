---
doc: docs/modules/index.md
audience: engineers, product
holds: the module map — each module's scope and where it lives in code
kind: reference
---

# pomade-agents — modules

A module is a real area of the app with a home in the code. Tickets name one in `module:`
(`../Pomade/docs/process/backlog.md`); process items use `meta`. The app's design, across modules, is
in [DESIGN](../DESIGN.md).

| Module | Covers | Where in code |
|---|---|---|
| `core` | app shell: manifest, install, backend process, surfaces and routing, settings and app state, test harness | `public/`, `src/ui/core/`, `src/ui/settings/`, `src/backend/core/`, `src/backend/settings/`, `harness/`, `scripts/`, `e2e/` |
| `stores` | reading the agents' session stores — Claude Code (built-in + folder agents) and Codex transcripts: parsing, watching, parse index, messages, tokens, context %, cost, price table | `src/backend/stores/` |
| `sessions` | session records (names, statuses, notes, attribution, overrides), the Sessions tab, the Live now panel, names = tab names, live state | `src/ui/sessions/`, `src/backend/sessions/`, `src/backend/records/` |
| `roster` | `agent.yaml`, roster import, the Roster tab and cards, the agent detail page, modes and launch specs, creating agents and their aliases | `src/ui/roster/`, `src/backend/roster/` |
| `interfaces` | the published API through Pomade's broker, events A/B/C, the `pomade-agents` command, the session-data format skill | `src/backend/interfaces/`, `src/command/`, `src/shared/`, `public/skills/` |

## Pages

- [core](core/index.md) — the app shell ([app-shell](core/app-shell.md): manifest, surfaces and
  routing, the backend's life with Pomade, locations, tokens and theme, shared UI pieces, the app's Settings and skill folders) and how
  the app is tested ([testing](core/testing.md): the gate, the fake Pomade and its shell, the
  sandbox, Playwright fixtures, `dev:fake`, the Pomade smoke).
- [stores](stores/index.md) — one page: the Claude Code and Codex store readers, parsing and
  watching, tokens, context %, cost and the price table, the parse index, the read-only rule.
- [sessions](sessions/index.md) — the Sessions tab ([sessions-tab](sessions/sessions-tab.md):
  layouts, selection and checks, status changes and Undo, rename and move, search and filters,
  hidden sessions, Open / Resume, live marks), the backend's session data
  ([session-data](sessions/session-data.md): records, attribution, live state, bound tabs, tab
  titles, `sessions.open`) and the Live now panel with its badge ([live-now](sessions/live-now.md)).
- [roster](roster/index.md) — the backend's roster ([roster-data](roster/roster-data.md):
  `agent.yaml` and its writers, first sight, orphans, unclaimed folders, re-link and its undo,
  `roster.list`, launch specs, project connections), the Roster tab
  ([roster-tab](roster/roster-tab.md): cards and list, Connected to, the numbers, the shared
  actions, the role line and tags edited in place), the agent's page
  ([agent-page](roster/agent-page.md): the route, the header and each tab), what the page reads and
  writes in an agent's own config ([agent-config](roster/agent-config.md): permissions, memory,
  model and effort, skill links) and creating an agent
  ([creating-agents](roster/creating-agents.md): the New agent page, the name check, Create's
  steps, the alias, Needs login and the setup prompt).
- [interfaces](interfaces/index.md) — the published API ([api](interfaces/api.md): every method
  by family and who reads it, the three lists that must agree, validation, `sessions.ofTab`, what
  Pomade itself reads, the shared types), the events ([events](interfaces/events.md): published
  and subscribed, who listens, their timing, the capabilities) and the command
  ([command](interfaces/command.md): `pomade-agents`, the `pomade-agents-sessions` format skill,
  the build check that holds the build folder installable).
