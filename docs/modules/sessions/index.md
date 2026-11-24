---
doc: docs/modules/sessions/index.md
audience: engineers, product
holds: the sessions module — its scope, code locations and a summary of each page
kind: reference
---

# Module: sessions

Session records (names, statuses, notes, attribution, overrides), the Sessions tab, the Live now panel,
names = tab names, live state. Code: `src/ui/sessions/`, `src/backend/sessions/`, `src/backend/records/`;
shared shapes in `src/shared/sessions.ts` and `src/shared/live-now.ts`; end-to-end specs in `e2e/`.
Reads the `stores` module's session summaries; the published API and events are in
[CONTRACTS](../../CONTRACTS.md) ("Sessions", "Live now", "Published events"); the design is
[DESIGN](../../DESIGN.md) §2.4–2.8. For users: [user guide](../../user-guide/index.md).

| Page | Summary |
|---|---|
| [sessions-tab](sessions-tab.md) | The Sessions tab: the table and the list with the detail panel, selection as the tab's route, checks and the bulk bar, status changes from four places with one toast and Undo (4 s, inside the backend's 5 s status window), rename and Move to project, search and filters, hidden sessions, Open / Resume, live marks; the pure model file that holds each rule and the e2e specs that cover them. |
| [session-data](session-data.md) | The backend: record files (atomic, hand-edit-safe, watched), the first run's adoption, how a session joins its summary, record, project(s), live state and bound tab, attribution and its symlink resolution, names = tab titles, the hidden rule, `sessions.open`, events B and C, Runner runs, and the reads other apps make. |
| [live-now](live-now.md) | The Live now side panel: backend-built rows for agent tabs and Runner runs, grouping by project (current first) and ordering by urgency, what a click does, the strip icon's Needs you badge, and the specs. |

Tickets: T-004, T-005, T-006, T-007, T-008, T-009, T-010, T-011, T-012, T-013, T-014, T-015, T-029, T-030.
