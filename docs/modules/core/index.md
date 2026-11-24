---
doc: docs/modules/core/index.md
audience: engineers, product
holds: the `core` module's summary — what the app shell and the test harness are, and the pages that describe them
kind: reference
---

# core — app shell and test harness

`core` is everything the other modules stand on: the manifest that makes the app a Pomade app, the one
UI bundle that serves the panel and the tab, the backend process and its life with Pomade, the
places the app keeps data, the shared UI pieces, and the tooling that runs the app and tests it without a
real Pomade. It holds no feature: sessions, the roster and the published API are the `sessions`,
`roster` and `interfaces` modules (see [the module map](../index.md)).

Code: `public/`, `src/ui/core/`, `src/ui/settings/`, `src/backend/core/`, `src/backend/settings/`, `src/backend/main.ts`, `harness/`, `scripts/`,
`e2e/` (fixtures, ports, the Pomade smoke).

## Pages

- [App shell](app-shell.md) — the manifest and its capabilities; the two surfaces (side panel =
  Live now, tab = Sessions | Roster | Settings) and the route table that picks the view and what
  it shows; how the tab navigates itself;
  the backend process — what it starts, how Pomade starts and stops it, how it survives Pomade going
  away — and the folders it uses (`POMADE_APP_STATE`, `<workspace>/Apps/pomade-agents/`, `HOME`);
  the look from the kit's tokens and Pomade's theme; the shared UI pieces every surface uses (`Menu`,
  `Switch`, `LiveMark`, `StatePage`, icons, the hooks); the app's Settings — the skill folders in
  `settings.yaml`, their rules, and the page that edits them.
- [Testing](testing.md) — the test pyramid and the gate command; unit tests; the fake Pomade
  (`harness/fake-pomade.ts` on the kit's `serveFakeHost`, with its shell page and frame relay); the
  sandbox that keeps every run off the real home and `Apps/`; the Playwright fixtures and options
  (`seed`, `workspaceLink`, `pomadeSeed`, `AGENTS_E2E_PORT_BASE`); `dev:fake`; the smoke inside a real
  Pomade (`e2e/pomade/`, `POMADE_REPO`).

Interfaces this module realizes: [CONTRACTS "Manifest"](../../CONTRACTS.md#manifest),
["Surfaces and routes"](../../CONTRACTS.md#surfaces-and-routes), ["Backend"](../../CONTRACTS.md#backend)
and ["Test harness"](../../CONTRACTS.md#test-harness).

Tickets: T-002, T-029, T-031, T-032, T-035.
