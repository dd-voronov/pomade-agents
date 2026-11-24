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
| `core` | app shell: manifest, install, backend process, surfaces and routing, settings and app state, test harness | `public/`, `src/ui/core/`, `src/backend/core/`, `harness/`, `scripts/`, `e2e/` |
| `stores` | reading the agents' session stores — Claude Code (built-in + folder agents) and Codex transcripts: parsing, watching, parse index, messages, tokens, context %, cost, price table | `src/backend/stores/` |
| `sessions` | session records (names, statuses, notes, attribution, overrides), the Sessions tab, the Live now panel, names = tab names, live state | `src/ui/sessions/`, `src/backend/sessions/`, `src/backend/records/` |
| `roster` | `agent.yaml`, roster import, the Roster tab and cards, the agent detail page, modes and launch specs, creating agents and their aliases | `src/ui/roster/`, `src/backend/roster/` |
| `interfaces` | the published API through Pomade's broker, events A/B/C, the `pomade-agents` command, the session-data format skill | `src/backend/interfaces/`, `src/command/`, `src/shared/`, `public/skills/` |

## Pages

- [core](core/index.md) — the app shell ([app-shell](core/app-shell.md): manifest, surfaces and
  routing, the backend's life with Pomade, locations, tokens and theme, shared UI pieces) and how
  the app is tested ([testing](core/testing.md): the gate, the fake Pomade and its shell, the
  sandbox, Playwright fixtures, `dev:fake`, the Pomade smoke).
- [stores](stores/index.md) — one page: the Claude Code and Codex store readers, parsing and
  watching, tokens, context %, cost and the price table, the parse index, the read-only rule.
- [sessions](sessions/index.md) — the Sessions tab ([sessions-tab](sessions/sessions-tab.md):
  layouts, selection and checks, status changes and Undo, rename and move, search and filters,
  hidden sessions, Open / Resume, live marks), the backend's session data
  ([session-data](sessions/session-data.md): records, attribution, live state, bound tabs, tab
  titles, `sessions.open`) and the Live now panel with its badge ([live-now](sessions/live-now.md)).
- [roster](roster/index.md) — one page: `agent.yaml`, first sight, `roster.list`, launch specs and
  project connections as the backend serves them; the Roster tab is a placeholder.
- [interfaces](interfaces/index.md) — one page: the published API through Pomade's broker, the
  shared types, the published and subscribed events and their timing, what Pomade itself reads;
  `sessions.ofTab`, the `pomade-agents` command (source, build, target, exit statuses), the
  `pomade-agents-sessions` format skill and the build check that holds the build folder installable.
