---
doc: docs/modules/roster/roster-data.md
audience: engineers, product
holds: the roster backend — agents, agent.yaml, first sight, unusable files, orphans and re-link, hidden, roster.list / roster.agents / roster.connections, profile edits, launch specs, project connections
kind: reference
---

# Roster data

What the backend knows of each agent and how it keeps and serves it. Shapes and semantics:
[CONTRACTS "Roster"](../../CONTRACTS.md#roster); design: [DESIGN](../../DESIGN.md) §3.1, §3.2, §3.5.
Code: `src/backend/roster/` (`roster.ts`, `first-sight.ts`, `profile-edit.ts`, `launch-spec.ts`,
`connections.ts`, `provider-config.ts`), shapes in `src/shared/roster.ts`, handlers in
`src/backend/interfaces/api.ts` ([interfaces](../interfaces/index.md)). The frames' side:
[roster-tab](roster-tab.md), [agent-page](agent-page.md).

## Agents

`startRoster` (`roster.ts`) holds one entry per agent:

- the built-ins `claude` and `codex`;
- each folder agent: a folder under `<workspace>/Agents/` with a `CLAUDE.md` (`folderAgentNames`,
  `src/backend/stores/roots.ts`, the same scan the [stores](../stores/index.md) use, so an agent's
  sessions and its roster entry appear together). `_shared` and any name containing `template`
  (any case) are skipped; a folder named `claude` or `codex` is the built-in;
- every profile in `agents/` — an agent whose folder is gone keeps its profile.

Order: `claude`, `codex`, then by id. The display name is `Claude`, `Codex`, or the folder agent's id.
A folder whose name cannot name a file is left out and logged once. A folder some usable profile already
names as its `configDir` belongs to that profile's agent and gets no second profile.

**`RosterEntry`** (`roster.agents`) carries, per agent: `profile` (the usable one, else `null`),
`problem`, `orphan`, `configDir` (absolute, `null` without a usable profile), `model` / `effort` from the
provider's config, and `provider`, `kind`, `hidden` — taken from the usable profile, else from the
first-sight values, so an agent whose file cannot be used still answers all three.

## `agent.yaml`

`<workspace>/Apps/pomade-agents/agents/<id>/agent.yaml` — `id`, `provider`, `kind`, `configDir`
(`~/…`, workspace-relative or absolute), `command` (the shell alias that launches the agent), `role`,
`tags`, `hidden`, `modes` (`normal` and `full-autonomy`, each `enabled`). Reading and writing is the
record store's (`src/backend/records/record-store.ts`, `PROFILE_FILE`), the same machinery as session
records: the file is the truth, a change on disk is seen at once, only changed keys are rewritten,
comments and extra keys are kept, an unusable file is never written over. Model and effort are not in the
file: they are the provider's own config ([agent-config](agent-config.md)).

The roster writes the file in these places only:

| Writer | When |
|---|---|
| first sight (`first-sight.ts`) | an agent has no file |
| `roster.updateProfile` | role, tags, modes, hidden (below) |
| `roster.relink`, `roster.undoRelink`, `roster.removeOrphan` | an orphan (below) |
| `roster.create` | a new agent ([creating-agents](creating-agents.md)) |

## First sight

An agent with no file gets one, and an existing file, usable or not, is never touched by it.

| Agent | First-sight values |
|---|---|
| built-in | `configDir: ~/.claude` or `~/.codex`, `kind: builtin`, provider `claude` / `codex` |
| folder agent | `configDir: Agents/<name>`, `kind: folder`, provider `claude`, `role` = first sentence of the first paragraph under `## Role` in its `CLAUDE.md` (absent when none) |
| all | `command` = `.pomade/agents.json` `commands[id]`, else the id; `hidden` from its `hidden` list; `tags: []`; both modes enabled |

An unusable file (not YAML, not a mapping, a key missing or malformed) is reported by `roster.agents`
(`profile: null`, `problem`), and an agent the folder scan finds keeps answering from its first-sight
values, so a broken file does not remove it from Pomade's "+" menu (a profile-only agent with a broken
file answers nothing). With no workspace open there are no profiles (`profilesOff` says why), every agent
answers from first-sight values, and every write is `not-ready`.

## Orphans

An **orphan** is a `kind: folder` profile whose `configDir` folder is gone (renamed or removed outside the
app): kept, left out of `roster.list`, refused (`not-found`) by `roster.launchSpec`, `roster.permissions`,
`roster.memory`, `roster.modelConfig`, `roster.setModel`, `roster.updateProfile` and `roster.checkAlias`,
without model or effort, and left out of `roster.connections`. A built-in is never an orphan.

An **unclaimed agent folder** (`roster.unclaimedFolders`, read on each call) is a folder agent that no
profile has made its own: no profile but its own names it as `configDir`, and its own profile is absent or
still exactly what first sight writes for it (`sightKey`: id, provider, kind, `configDir`, command, role,
tags, hidden, the modes switched on). A folder renamed outside the app gets that first-sight profile within
a tick, so it is unclaimed until someone edits it. Names in order; none without a workspace.

- **`roster.relink { agent, folder }`** points the orphan's `configDir` at `Agents/<folder>` (every other key
  kept), removes the folder's own first-sight profile, and reads the roster again before it answers: the
  agent is in `roster.list` again under its id, and the folder's sessions are its own
  ([session-data](../sessions/session-data.md) "A session's agent"). The answer's `undo` holds the agent's profile text and the
  removed profile's text (`null`: none) as the files held them.
- **`roster.undoRelink(undo)`** requires the agent to still name the folder, writes the agent's text back,
  then the folder's profile (byte for byte), and reads again. If the second write fails the first is put
  back: nothing is left half-done. A text over `PROFILE_TEXT_MAX` (65 536) or not a usable profile is
  `invalid-params`.
- **`roster.removeOrphan { agent }`** deletes the orphan's `agents/<id>/agent.yaml` and that folder when
  nothing else is in it — never an agent folder. A profile already gone is no error; an agent that is no
  longer an orphan is `invalid-params`.

All three refresh the roster first (`orphanAgent`), so they judge the state on disk now.

## Profile edits

`roster.updateProfile { agent, role?, tags?, modes?, hidden? }` (`profile-edit.ts`, `roster.ts`) sets the
keys present and leaves every other key of the file alone.

- `role`: one line, trimmed, at most `ROLE_MAX` (200); `null` removes it. `tags`: at most 20, each one line
  of at most `TAG_MAX` (24), none repeated. `modes`: `normal` / `full-autonomy` → `true` / `false`; Normal
  is always on, so `normal: false` is `invalid-params`. `hidden`: a boolean. At least one key is required.
- **Hidden** leaves the agent out of `roster.list` (so out of Pomade's "+" menu and launches); the profile,
  `roster.launchSpec` and the project settings are unchanged. A hidden agent's connections are still the
  project settings' (`roster.connections`), but `roster.projectsFor` answers `[]` for it.
- **A mode switched off** leaves `roster.list`; `roster.launchSpec` refuses it.
- An agent the scan found whose first-sight file is not written yet gets it first. Errors: `not-ready` (no
  workspace), `not-found` (no such agent, or an orphan), `io-error` (the file cannot be used or written).
- The change is in the file when the call answers; the roster is read again before it does.

## Reading again

The roster is rebuilt on every profile change (a 40 ms settle after the record store's watch fires), every
2 s (`TICK_MS`) for what has no watch — agent folders, `.pomade/agents.json`, the providers' config files —
and after every write above (`refresh`). A rebuild that produces a different answer is a new revision and
a `roster.changed` notice `{ epoch, revision }`; a frame behind it asks `roster.agents` again, whole.
`startBackend` awaits the first rebuild before it connects, so Pomade's first `roster.list` is whole.

Default model and effort (`provider-config.ts`) are read from the provider's config: Claude's
`<configDir>/settings.json` (`model`, `effortLevel`), Codex's `<configDir>/config.toml` (top-level `model`,
`model_reasoning_effort`). A missing or unreadable file is `null`; an orphan has none.

## `roster.list`

Pomade's read, answered from memory: every agent that is neither hidden nor an orphan, in roster order,
with `command`, `provider`, the absolute `configDir` (absent only when it cannot be resolved, no `HOME`)
and the enabled modes with the kit's `providerModes` names and arguments (Normal: none; Full autonomy: the
provider's skip-permissions flag). The answer must pass the kit's `checkRosterList` unchanged. Pomade
applies its own `.pomade/agents.json` overrides on top; the app reads the same file only for first-sight
values.

## `roster.agents` and `roster.connections`

`roster.agents` is the app's own frames' read: every agent, hidden ones and orphans included, with
`profilesOff`. `roster.connections` answers every agent's connected projects in one read for the Roster's
**Connected to**: one entry per agent the roster answers for that is not an orphan, project ids in the
Projects panel's order; no workspace open: every entry `[]`. Both are asked together by `useRoster`
([roster-tab](roster-tab.md)).

## Launch specs (`launch-spec.ts`)

`roster.launchSpec { agent, mode, resume?, sessionId?, prompt? }` answers the command line that starts the
agent in that mode: `command`, `args`, `line`, the session id the launch will have and `exit`. Pomade's
"+" menu and Runner both launch from it; the agent page's launch lines ([agent-page](agent-page.md))
and **Start session** go through it too.

- Forms follow the CLIs and Pomade's `buildAgentCommand`: command, the mode's arguments, then the resume
  arguments, then the prompt. Claude: `--resume <id>` or `--session-id <uuid>`. Codex: `resume <id>`; it
  cannot pre-assign an id, so `sessionId` is `null` and the session is found afterwards with
  `sessions.find`.
- A prompt that starts with `-` follows `--`, so a CLI never reads it as an option.
- **`line` is one printable line a shell reads back to exactly `args`.** `shellWord` leaves plain arguments
  as they are, single-quotes the rest, and ANSI-C quotes (`$'…'`) any argument with a control character,
  escaping `\`, `'`, `!` and every control character. `e2e/roster.spec.ts` runs `line` in a real shell and
  compares the result with `args`. Keep it so when touching the quoting.
- The command is the agent's alias, typed as is into an interactive shell: never resolved or run by the
  backend.
- Errors: `invalid-params` for a bad id, `resume` with `sessionId`, an unknown mode or one the profile does
  not enable; `not-found` for an agent the roster does not hold or an orphan. A hidden agent gets its spec.

## Project connections (`connections.ts`)

`roster.projectsFor { agent }` and `roster.agentsFor { project }` read the connection from Pomade on every
call (`project.list`, `project.getAgents`) and keep no copy that could go stale. Pomade stores each
project's visible agents as roster ids; `["*"]` is every agent (also a project that never set a list),
`[]` none, and the Workspace offers every agent. An agent is connected to a project when the project
offers it and it is in `roster.list`, so a hidden agent or an orphan is connected to nothing. A project
removed between the two reads offers nothing. Unknown project: `not-found` (Pomade's); unknown agent:
`not-found`.

`roster.connections` reads the same lists once for every agent, but answers hidden agents by the project
setting alone.

## Invariants

- An existing `agent.yaml` is never overwritten by first sight; an unusable one is never written at all.
- `roster.list` never contains a hidden agent or an orphan; a broken `agent.yaml` does not remove an agent
  the scan finds.
- A profile write changes only the keys it names; a re-link is undone byte for byte or not at all.
- No write leaves an agent folder deleted: `roster.removeOrphan` deletes a profile, never `Agents/<name>/`.
- `.pomade/agents.json` is only read; the provider configs are written only by `roster.setModel`
  ([agent-config](agent-config.md)).
- The roster is built before the backend connects, and read again before any write answers.
- A launch spec's `line` round-trips through a POSIX shell to its `args`.

## Known limits

- A command edit made in the app does not reach Pomade's `.pomade/agents.json`; the app has no command
  editor (the command is shown on the agent page, read-only).
- Only Claude Code folder agents exist; a Codex agent is a built-in.

## Tests

Unit: `roster.test.ts` (agents, first sight, orphans, unusable files, edits on disk, no workspace, re-link
and its undo, `roster.list`), `first-sight.test.ts`, `profile-edit.test.ts`, `launch-spec.test.ts` (forms
per provider, quoting), `connections.test.ts`, and the roster API in `src/backend/interfaces/api.test.ts`.
End to end through the fake Pomade: `e2e/roster.spec.ts` (profiles written, `roster.list` through Pomade's
check, launch lines in a real shell, a renamed agent folder becoming an orphan and a new agent within about
2 s with a `roster.changed` notice, project connections) and the action specs named in
[roster-tab](roster-tab.md).

Tickets: T-019, T-021.
