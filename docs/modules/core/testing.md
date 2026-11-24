---
doc: docs/modules/core/testing.md
audience: engineers, product
holds: how the app is tested — the gate, unit tests, the fake Pomade and its shell, the sandbox, the command process harness, the Playwright fixtures, dev:fake, and the smoke inside a real Pomade
kind: reference
---

# Testing

Three layers, each with one job, all running off the real machine: **unit tests** for logic with no
host, **e2e against a fake Pomade** for the built app's frames and backend together, and a **smoke
inside a real Pomade** for what only Pomade can show. Interfaces of the harness:
[CONTRACTS "Test harness"](../../CONTRACTS.md#test-harness).

## The gate

```
npm run lint && npm run typecheck && npm run build && npm run test:unit && npm run e2e
```

`npm run e2e:pomade` (build, then the real-Pomade smoke) is outside the gate: it needs a built Pomade
checkout and runs one Electron app at a time.

- **Lint** — type-aware typescript-eslint with hand-picked rules (floating and misused promises,
  exhaustive switches, unused bindings), the React hooks rules for the UI and Playwright's
  missing-await rules for the e2e; `--max-warnings 0`. Each glob is checked against exactly one tsconfig
  (`eslint.config.mjs`).
- **Typecheck** — three programs: `tsconfig.ui.json` (`src/ui`, `src/shared`, the shell page),
  `tsconfig.node.json` (backend, shared, unit tests, `harness/`, `scripts/`, configs) and
  `tsconfig.e2e.json` (`e2e/`, the Playwright configs). `src/shared` is in both UI and node programs: keep it free of
  Node and DOM APIs.
- **Build** is part of the gate because the e2e runs the **built** app, backend and command
  (`dist/`), not the source. It ends with `scripts/check-build.ts`, which fails when `dist/` is not an
  installable folder ([interfaces](../interfaces/index.md#the-build-check)).

## Unit tests

Vitest, in Node (no DOM): `src/**/*.test.ts`, `harness/**/*.test.ts`, `scripts/**/*.test.ts`, each
next to the code it tests. UI logic is therefore tested as pure models (`*-model.test.ts`, `routes.test.ts`),
and anything that needs rendering goes to e2e. Fixtures: synthetic transcripts in
`harness/fixtures/transcripts/` (`TRANSCRIPTS`, read by the stores' tests and seeded into sandboxes).
Core's own: `locations`, `run-record`, `routes`, `pomade-command`, and `manifest.test.ts` (the manifest
against the code, [App shell](app-shell.md#manifest-and-capabilities)). `harness/fake-pomade.test.ts`
runs the **real backend from source** (`SOURCE_BACKEND`) against the fake Pomade: connect, `app.info` with
every location inside the sandbox, SIGTERM stop with status 0 and nothing written but the state folder and the
app's data, a wrong key refused.

## The fake Pomade

`startFakePomade({ manifest, socketPath, appKey, host })` (`harness/fake-pomade.ts`) is one
`pomade-kit` fake host (`createFakeHost`) reachable the two ways the real Pomade is:

- **Socket** — `serveFakeHost` (`pomade-kit/fake-host/node`) listens at `<userData>/run/pomade.sock` and
  checks the app key at `<userData>/app-keys/<appId>`; the backend connects as it does to Pomade
  (`stayConnected`). `pomade.env()` is the environment the kit gives a backend; `backendCount()` is how
  many are connected and welcomed.
- **Frames** — the **shell page** and its **frame relay**. `harness/shell/` is a small page standing in
  for Pomade's window: a strip with the Agents icon, a side panel with one frame (`panel-frame`), and a
  tab area where each app tab the host opens gets a button (`tab-<projectId>`) and a frame
  (`tab-frame-<projectId>`). It is opened with `?host=<relay ws url>&app=<app url>`. The shell only hosts
  iframes and forwards their `postMessage` traffic over a WebSocket (`protocol.ts`) to `relay.ts` in Node,
  which attaches each frame to the fake host (`fake.attach`). One fake host therefore answers both the
  backend's socket and the frames, so a frame's `apps.call` reaches the backend that called `api.serve`.
- **Tabs** are the fake host's: `tabs.openApp` opens, focuses or navigates, `tabs.setRoute` records a
  route; `fake.openedTabs` (every call), `fake.appTabs` (open tabs with their routes), `fake.badges`
  and `fake.callApi` are what specs assert on. A frame reloaded in a tab opens at that tab's recorded
  route, as in Pomade.
- The shell and the app are served on **different origins**, as Pomade serves an app on its own origin.
  The shell's Vite has its own dependency cache (`node_modules/.vite-shell`): sharing one with the
  app's dev server makes each optimizer outdate the other's.

`FakeHostOptions` pass through `host`: `projects`, `activeProject`, `workspaceRoot`, `pomadeVersion`,
`hostApi` (a newer one shows the "needs an update" state), `agentTabs`, `sessions` (what
`agentTabs.resume` finds) and `files`. Fixture projects are `alpha` and `beta` (`FIXTURE_PROJECTS`);
`FIXTURE_AGENTS` is the roster the fixture home and workspace give (`claude`, `codex`, `claude-libra`).

## The sandbox

`createSandbox(appId, { workspaceLink? })` (`harness/sandbox.ts`) makes one throwaway folder under the
real tmp path holding everything a run may touch: `home/` (copies of `.claude`, `.codex`, `.zshrc` from
`harness/fixtures/home`), `workspace/` (a copy of `harness/fixtures/workspace`: two projects and the
folder agent `claude-libra`), `ud/` (Pomade's user data: `run/pomade.sock`, `app-keys/<appId>`), and
three seeded transcripts (`SEEDED_TRANSCRIPTS`: one per kind of store). `backendEnv()` is the **whole**
environment a backend gets — `HOME`, a minimal `PATH`, `POMADE_*` — and nothing of the caller's, so a
test can never read the real stores or the real `Apps/`.

- `workspaceLink: true` names the workspace through a symlink, as a symlinked Pomade workspace is.
  `workspaceReal` is where the files are.
- `snapshot(folder)` hashes every file under a folder inside the sandbox; the e2e compare it with
  `fixtureSnapshots()` to prove what the backend wrote (the state folder, `Apps/pomade-agents/`) and
  that the stores stayed byte-identical.
- The socket path must fit the OS limit; a too-long temp path throws at creation.

`spawnBackend(sandbox, { entry, nodeArgs?, echo?, pomade?, env? })` (`harness/backend-process.ts`) runs
the backend as Pomade does — Node in the build folder, SIGTERM then SIGKILL after the 3 s grace — and
exposes `output()`, `running()` and `stop()` (`{ code, signal, killed }`). Environment layers: sandbox,
then `pomade.env()`, then `env` (`undefined` unsets).

`runCommand(entry, args, env)` (`harness/command-process.ts`) runs the built `pomade-agents` command
(`BUILT_COMMAND` in `harness/app.ts`, `dist/cli/pomade-agents.mjs`) on Node as Pomade's shim does and
resolves `{ code, stdout, stderr }` (killed after 20 s). `shimHome(sandbox)` writes
`<sandbox>/pomade-home` with `host.json` (the sandbox's socket) and the workspace pointer, and
`shimEnv(sandbox, appId, home, terminal)` is the shim's environment — `POMADE_HOME`, `POMADE_APP_ID`,
`POMADE_APP_KEY_FILE`, `POMADE_CLIENT=command`, `POMADE_APP_STATE`, and, for a terminal
(`{ tabId, projectId }`), `POMADE_WORKSPACE`, `POMADE_TAB_ID`, `POMADE_PROJECT_ID`; with `null` it is
outside Pomade's terminals. Like the real shim it gives no `POMADE_SOCKET`: the command finds the socket
through `host.json`.

## Playwright e2e

`playwright.config.ts`: `e2e/` minus `e2e/pomade/`, fully parallel, no retries, `forbidOnly`. Two web
servers: the built app (`npm run build && vite preview`) and the shell page. Ports come from
`e2e/ports.ts`: the app on 4337 and the shell on 4338; `AGENTS_E2E_PORT_BASE` moves the pair (the
other family repos have their own pairs), so two worktrees can run suites at once.

Each test starts its **own** sandbox, fake Pomade and, when it asks for `backend`, built backend
(`e2e/fixtures.ts`), so tests share nothing. Fixtures: `manifest`, `sandbox`, `pomade`, `backend`
(waits until it is connected), `openShell(page)` (returns `{ panel, tabFrame(projectId) }`). Options,
set with `test.use`:

| Option | Default | Effect |
|---|---|---|
| `seed` | `null` | `{ into(sandbox) }` writes into the sandbox before the backend starts (transcripts, records) |
| `workspaceLink` | `false` | the workspace is named through a symlink |
| `pomadeSeed` | `{}` | what the fake Pomade has at start besides the fixture projects: `agentTabs`, `sessions`, `files` |

A spec that does not use `backend` runs with none, which is how "backend not answering" is tested.
`e2e/transcripts.ts` writes Claude Code transcript lines into a sandbox (`prompt`, `answer`,
`claudeSession`, `projectFolder`, `seedIntoProject`). Specs assert on `data-testid`s, roles and the
fake host's records; waits that depend on the backend pass `backend.output()` as their message. Screenshots for
review (`look.spec.ts` and others) go to `e2e/artifacts/` (gitignored); computed-style assertions
(the panel's and the tab's backgrounds) pin what screenshots cannot.

`command.spec.ts` runs the built command through `runCommand` against the fake Pomade, with agent tabs
seeded in `pomadeSeed` and, for most cases, the real backend: `show --json` in an agent tab equals
`sessions.get`'s `Session`; `--session` outside any terminal; text output; and every exit status
(tab with no session, plain terminal, unknown id, no tab, usage, backend absent, Pomade closed, no
app identity, a key Pomade did not issue). Interfaces: [interfaces](../interfaces/index.md#the-pomade-agents-command).

Core's specs: `no-host` (outside Pomade; a Pomade with a newer Host API), `panel` (the strip icon's panel,
no tabs opened, no badge), `tabs` (open, focus, one tab per project, the switch navigating by itself),
`backend` (broker round trip, absent backend and recovery, `app.info` locations, clean SIGTERM and what is
written, `POMADE_APP_STATE` handling, reconnect after Pomade goes away), `look` (light surfaces, screenshots).
Feature specs live with their module's tickets.

## `npm run dev:fake`

`scripts/dev-fake.ts` is the app without Pomade for development: a sandbox, a fake Pomade, the backend
from source under `node --watch` with its output echoed, and two Vite dev servers (app on 5327, shell
on 5328). It prints the shell URL (`?host=…&app=…`), the standalone app URL (the no-host state) and the
sandbox path. Nothing touches the real home or `Apps/`; the sandbox is removed on Ctrl-C.
`npm run dev` is the other kind: it builds, dev-links `dist/` into a **real** Pomade
(`pomade apps link dist`) and rebuilds on change (`scripts/pomade.ts` finds the command: `POMADE_BIN`,
`PATH`, then `../Pomade/bin/pomade`).

## The Pomade smoke

`npm run e2e:pomade` builds, then runs `e2e/pomade/*.spec.ts` (`playwright.pomade.config.ts`: one worker,
60 s timeout) against a real, built Pomade driven through Electron. `POMADE_REPO` names the checkout
(default `../Pomade`); it is only read — its `out/main/index.js`, Electron binary and `bin/pomade` —
and a missing piece fails with "point POMADE_REPO at a built Pomade checkout". `launchPomade`
(`e2e/pomade/pomade.ts`) isolates it completely: `HOME`, `POMADE_USER_DATA` and `POMADE_WORKSPACE` are the
sandbox's, `NODE_ENV=test` keeps Pomade's own home folder and shell-profile line off, every inherited
`POMADE_*` and `ELECTRON_*` variable is dropped, and `POMADE_DEV_APPS` dev-links the build folder. Its
third argument, `pomadeHome`, sets `POMADE_HOME` and so turns Pomade's commands on (they are off without
it): Pomade writes its shims into `<pomadeHome>/bin` and puts that folder first on its terminals' `PATH`.

The specs cover what a fake cannot:

- `smoke` — dev-linked: the strip icon and the panel's Live now, the backend through Pomade's broker
  and its run record; Pomade's own client (`platformClient`, the platform key) getting well-formed
  `sessions.forRepo` / `sessions.liveIn` answers; the one tab opened, focused and navigated; Pomade's "+"
  menu filled from the app's roster, and from Pomade's own scan while the backend is stopped
  (`SIGSTOP`); quitting Pomade stops the backend and leaves the stores unwritten. Installed
  (`pomade apps install dist`): the backend runs from a copy with no `node_modules`; installing a changed
  build updates the open panel and restarts the backend with no Pomade restart.
- `tab-titles` — a rename in the app becomes the tab's title on Pomade's tab strip, and the user's
  tab rename renames the session.
- `open-resume` — a Done session resumes in a new agent tab bound to it and turns Active; a second
  open focuses it; the session has no tab once the agent quits.

- `command` — an agent in a real agent tab runs `pomade-agents show --json` off its terminal's `PATH`
  (the shim, `POMADE_TAB_ID`, the socket and the broker are Pomade's) and gets the session that tab is
  bound to; run with a `pomadeHome`.

Agent tabs there run `STAND_IN_AGENT`, a zsh script mapped onto the fixture folder agent
(`.pomade/agents.json`): ready at once, echoes every prompt, writes a Claude-shaped transcript on its first
prompt, takes `--resume <id>`, and on the prompt `/show` runs `pomade-agents show --json` into `<store>/show.json`
and says `AGENT_SHOWED <exit status>`. The specs kill any backend pid still alive in `afterAll`.

Tickets: T-002, T-027, T-029, T-031, T-032.
