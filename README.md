# pomade-agents

**Agents** — the Pomade app for the agent roster (profiles, modes, launch specs, skills, creating
agents) and session data (sessions per project, names, statuses, notes, attribution, messages,
stats). A web UI Pomade hosts in a side panel and a tab, plus a Node backend that runs while
Pomade runs. Both are built on `pomade-kit`.

Part of the Pomade family — the platform and its rules live in the sibling repo `Pomade`
(`docs/PLATFORM.md`, `docs/HOST-API.md`). Design: `docs/DESIGN.md`. Plan: `docs/PLAN.md`.
The app's own interfaces: `docs/CONTRACTS.md`.

## Scripts

Node 22.18 or newer.

| Script | What it does |
|---|---|
| `npm run build` | builds the app folder `dist/`: the UI (`index.html`, `assets/`), `manifest.json`, the strip icon, and the backend bundled into one file, `backend/main.mjs` |
| `npm run install-app` | builds, then `pomade apps install dist` — into the dev Pomade (HOST-API §2 "Which Pomade") |
| `npm run dev` | builds, dev-links `dist/` into Pomade (`pomade apps link dist`) and rebuilds on every change; `pomade apps unlink pomade-agents` removes the link |
| `npm run dev:fake` | the app without Pomade: a fake Pomade hosts the UI (Vite dev server) and the backend (from source, restarted on change) in a throwaway sandbox |
| `npm run lint` · `npm run typecheck` | ESLint (type-aware) · `tsc` over the UI, Node and e2e programs |
| `npm run test:unit` | vitest |
| `npm run e2e` | Playwright against the fake Pomade, with the built backend |
| `npm run e2e:pomade` | the smoke spec inside a real Pomade — dev-linked, then installed. Needs a built Pomade checkout: the sibling `../Pomade`, or `POMADE_REPO=<path>` |

The `pomade` command is found on `PATH` (Pomade's own terminals have it), else at
`../Pomade/bin/pomade`; `POMADE_BIN` overrides both.

The gate: `npm run lint && npm run typecheck && npm run build && npm run test:unit && npm run e2e`.

## Layout

| Folder | Holds |
|---|---|
| `public/` | `manifest.json` — the single source of the app's id, version and API list — and the strip icon |
| `src/shared/` | what the UI and the backend share: the API's method names and shapes |
| `src/ui/core/` | the app shell: handshake, routes and surfaces, the tab's view switch, empty and unavailable states, theme |
| `src/ui/sessions/` · `src/ui/roster/` | the Live now panel and the Sessions view · the Roster view |
| `src/backend/core/` | the backend process: locations, run record, connection to Pomade |
| `src/backend/stores/` | the agents' session stores: transcript parsers, the price table, the parse index, watching |
| `src/backend/records/` | the app's data files: session records and `settings.yaml` — read, written, watched |
| `src/backend/sessions/` | sessions joined: summaries + records + projects; first-run adoption, record rules, project attribution |
| `src/backend/interfaces/` | the API the backend serves through Pomade's broker, and what it follows of Pomade (projects, agent tabs) |
| `harness/` | development and test tooling: the sandbox, the fake Pomade and its shell page, fixtures (synthetic transcripts in `fixtures/transcripts/`) |
| `e2e/` | Playwright specs against the fake Pomade; `e2e/pomade/` — the smoke spec in a real Pomade |
| `scripts/` | `dev`, `dev:fake` and the `pomade` command runner |

## Test isolation

Every test and `dev:fake` run in a sandbox (`harness/sandbox.ts`): a temp folder with a HOME
holding copies of the fixture stores (`~/.claude`, `~/.codex`, `~/.zshrc`, with synthetic
transcripts), a copy of the fixture workspace, and Pomade user data. The backend gets only the environment Pomade gives a backend,
pointed at that folder. Nothing reads or writes the real stores or the real `Apps/`.
