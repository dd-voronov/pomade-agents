---
doc: docs/modules/roster/index.md
audience: engineers, product
holds: what the roster backend does today — agents, agent.yaml, first sight, roster.list, launch specs, project connections — and what is not built
kind: reference
---

# roster

The roster is the list of agents the app knows, each with a profile file, a set of launch modes and
the projects it is connected to. Only the backend exists: it builds the roster, keeps the profile
files, and answers the roster methods other apps and Pomade call. **The Roster UI is a placeholder**:
`src/ui/roster/RosterTab.tsx` renders a "Roster" state page that says the view is not built yet. There are no
agent cards, no agent detail page, no create-agent flow, no alias writing and no skills reading; the
profile file is never written after first sight. Shapes and semantics:
[CONTRACTS "Roster"](../../CONTRACTS.md#roster).

Code: `src/backend/roster/` (`roster.ts`, `first-sight.ts`, `launch-spec.ts`, `connections.ts`,
`provider-config.ts`), shapes in `src/shared/roster.ts`, handlers in
`src/backend/interfaces/api.ts` ([interfaces](../interfaces/index.md)).

## Agents

`startRoster` (`roster.ts`) holds one entry per agent:

- the built-ins `claude` and `codex`;
- each folder agent: a folder under `<workspace>/Agents/` with a `CLAUDE.md` (the same
  `folderAgentNames` the [stores](../stores/index.md) use, so a folder agent's sessions and its
  roster entry appear together);
- every profile in `agents/` — an agent whose folder is gone keeps its profile.

Order: `claude`, `codex`, then by id. The display name is `Claude`, `Codex`, or the folder
agent's id. A folder whose name cannot name a file is left out and logged once. A folder some
profile already names as its `configDir` belongs to that profile's agent and gets no second profile.

## `agent.yaml`

`<workspace>/Apps/pomade-agents/agents/<id>/agent.yaml` — `id`, `provider`, `kind`, `configDir`
(`~/…`, workspace-relative or absolute), `command` (the shell alias that launches the agent), `role`,
`tags`, `hidden`, `modes` (`normal` and `full-autonomy`, each `enabled`). Reading and writing is the
record store's (`src/backend/records/record-store.ts`, `PROFILE_FILE`), the same machinery as session
records: the file is the truth, a change on disk is seen at once, only changed keys are rewritten,
comments and extra keys are kept, an unusable file is never written over.

The roster's own write is **first sight** only (`first-sight.ts`): an agent with no file gets one,
and an existing file, usable or not, is never touched.

| Agent | First-sight values |
|---|---|
| built-in | `configDir: ~/.claude` or `~/.codex`, `kind: builtin`, provider `claude` / `codex` |
| folder agent | `configDir: Agents/<name>`, `kind: folder`, provider `claude`, `role` = first sentence of the first paragraph under `## Role` in its `CLAUDE.md` (absent when none) |
| all | `command` = `.pomade/agents.json` `commands[id]`, else the id; `hidden` from its `hidden` list; `tags: []`; both modes enabled |

An unusable file (not YAML, not a mapping, a key missing or malformed) is reported by
`roster.agents` (`profile: null`, `problem`), and an agent the folder scan finds keeps answering from
its first-sight values, so a broken file does not remove it from Pomade's "+" menu (a profile-only
agent with a broken file answers nothing). With no workspace open there
are no profiles (`profilesOff` says why) and every agent answers from first-sight values.

An **orphan** is a `kind: folder` profile whose `configDir` folder is gone: kept, left out of
`roster.list`, refused by `roster.launchSpec`. A built-in is never an orphan.

## Reading again

The roster is rebuilt on every profile change (a 40 ms settle after the record store's watch fires)
and every 2 s (`TICK_MS`) for what has no watch: agent folders, `.pomade/agents.json`, the
providers' config files. A rebuild that produces a different answer is a new revision and a
`roster.changed` notice `{ epoch, revision }`; a frame behind it asks `roster.agents` again, whole.
`startBackend` awaits the first rebuild before it connects, so Pomade's first `roster.list` is whole.

Default model and effort (`provider-config.ts`) are read from the provider's own config and never
written: Claude's `<configDir>/settings.json` (`model`, `effortLevel`), Codex's
`<configDir>/config.toml` (top-level `model`, `model_reasoning_effort`). A missing or unreadable file
is `null`. An orphan has none.

## `roster.list`

Pomade's read, answered from memory: every agent that is neither hidden nor an orphan, in roster
order, with `command`, `provider`, the absolute `configDir` (absent only when it cannot be resolved,
no `HOME`) and the enabled modes with the kit's `providerModes` names and arguments (Normal: none;
Full autonomy: the provider's skip-permissions flag). The answer must pass the kit's
`checkRosterList` unchanged. Pomade applies its own `.pomade/agents.json` overrides on top;
the app reads the same file only for first-sight values.

## Launch specs (`launch-spec.ts`)

`roster.launchSpec { agent, mode, resume?, sessionId?, prompt? }` answers the command line that starts
the agent in that mode: `command`, `args`, `line` and the session id the launch will have. Pomade's
"+" menu and Runner both launch from it.

- Forms follow the CLIs and Pomade's `buildAgentCommand`: command, the mode's arguments, then the
  resume arguments, then the prompt. Claude: `--resume <id>` or `--session-id <uuid>`. Codex:
  `resume <id>`; it cannot pre-assign an id, so `sessionId` is `null` and the session is found
  afterwards with `sessions.find`.
- A prompt that starts with `-` follows `--`, so a CLI never reads it as an option.
- **`line` is one printable line a shell reads back to exactly `args`.** `shellWord` leaves plain
  arguments as they are, single-quotes the rest, and ANSI-C quotes (`$'…'`) any argument with a control
  character, escaping `\`, `'`, `!` and every control character. `e2e/roster.spec.ts` runs `line`
  in a real shell and compares the result with `args`. Keep it so when touching the quoting.
- The command is the agent's alias, typed as is into an interactive shell: never resolved or run
  by the backend.
- Errors: `invalid-params` for a bad id, `resume` with `sessionId`, an unknown mode or one the
  profile does not enable; `not-found` for an agent the roster does not hold or an orphan. A hidden
  agent gets its spec.

## Project connections (`connections.ts`)

`roster.projectsFor { agent }` and `roster.agentsFor { project }` read the connection from Pomade on
every call (`project.list`, `project.getAgents` through the connection the API is served on) and keep
no copy that could go stale. Pomade stores each project's visible agents as roster ids; `["*"]` is
every agent (also a project that never set a list), `[]` none, and the Workspace offers every agent.
An agent is connected to a project when the project offers it and it is in `roster.list`, so a hidden
agent or an orphan is connected to nothing. A project removed between the two reads offers nothing.
Unknown project: `not-found` (Pomade's); unknown agent: `not-found`.

## Invariants

- The profile file is written by first sight only, never over an existing file.
- `roster.list` never contains a hidden agent or an orphan; a broken `agent.yaml` does not remove an agent the scan finds.
- The provider configs, `.pomade/agents.json` and the agent folders are only read.
- The roster is built before the backend connects.
- A launch spec's `line` round-trips through a POSIX shell to its `args`.

## Tests

Unit: `roster.test.ts` (agents, first sight, orphans, unusable files, edits on disk, no workspace,
`roster.list`), `first-sight.test.ts` (overrides, role line, provider defaults), `launch-spec.test.ts`
(forms per provider, quoting),
and the roster API in `src/backend/interfaces/api.test.ts`. End to end through the fake Pomade:
`e2e/roster.spec.ts` (profiles written, `roster.list` through Pomade's check, launch lines in a real
shell, a renamed agent folder becoming an orphan and a new agent within about 2 s with a
`roster.changed` notice, project connections).

Tickets: T-019.
