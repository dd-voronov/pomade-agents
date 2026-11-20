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
| `interfaces` | the published API through Pomade's broker, events A/B/C, the `pomade-agents` command, the session-data format skill | `src/backend/interfaces/`, `src/shared/` |
