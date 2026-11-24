---
doc: docs/modules/roster/agent-config.md
audience: engineers, product
holds: the backend behind the agent page — reads of an agent's provider config (permissions, MCP, plugins, memory, model), the model and effort write, skill link writes and the rules that keep them inside the agent's own files
kind: reference
---

# Agent config

An agent's page ([agent-page](agent-page.md)) shows and, in two places, changes files that are the
provider's, not the app's. This page holds those reads and writes. The roster's own file, `agent.yaml`,
is [roster-data](roster-data.md). Shapes: [CONTRACTS "Roster"](../../CONTRACTS.md#roster) and
["Skills"](../../CONTRACTS.md#skills). Code: `src/backend/roster/` (`agent-files.ts`, `model-config.ts`,
`json-keys.ts`, `provider-config.ts`, `skill-links.ts`, `skills-catalog.ts`).

All methods here answer `not-found` for an agent the roster does not hold and for an orphan, and resolve
the agent's `configDir` (`~/…`, workspace-relative or absolute) the way the roster does.

## Reads, on each call

Nothing here is cached; the page asks again when the roster changes (`useAgentRead`, keyed on the roster's
revision) and, while the backend does not answer, every second.

- **`roster.permissions`** (`readPermissions`): Claude Code — `permissions.defaultMode`, `allow`, `ask`,
  `deny` and `enabledPlugins` (those set to `true`) from `<configDir>/settings.json`, MCP servers from the
  top-level `mcpServers` of `.claude.json` (`<configDir>/.claude.json`; for the built-in `claude`,
  `~/.claude.json`), a server's type being its `type`, else `stdio` when it has a `command`. Codex —
  `approval_policy`, `sandbox_mode` and the `[mcp_servers.<name>]` tables (`http` for one with a `url`) of
  `config.toml`. A missing file is `exists: false` with empty lists; an unreadable one or one that is not a
  JSON object is `problem`; an unreadable `.claude.json` is no servers.
- **`roster.memory`** (`readMemory`): Claude Code only. Each `<configDir>/projects/<folder>/memory/` that
  holds at least one `.md` file, by folder name, `MEMORY.md` first, then by name. Codex: no folders.
- **`roster.modelConfig`** (`readModelConfig`): `settings.json` `model` and `effortLevel`, or `config.toml`
  `model` and `model_reasoning_effort`; `writable` is true for a Claude Code file that is absent or a JSON
  object.

The Memory tab names each `<folder>` after the workspace project whose root, under the workspace as Pomade
names it or with symlinks resolved, encodes to it (`claudeFolderName`: every character but letters and
digits written as `-`); other folders show their own name (`memory-model.ts`, `folderLabels`).

## Writing the model and effort (`roster.setModel`)

`{ agent, model?, effort? }`, Claude Code only: `model` a model name (`[A-Za-z0-9][A-Za-z0-9._:@/[\]-]*`,
at most 128) or `null`, `effort` one of `EFFORT_LEVELS` (`low`, `medium`, `high`, `xhigh`) or `null`; at
least one is required. The page offers `CLAUDE_MODEL_CHOICES` (`opus`, `sonnet`, `haiku`) and the file's
own model when it names another (`src/shared/model-choices.ts`).

- **Only those keys' text changes** (`json-keys.ts`): every other key, the key order, the indentation, the
  spacing around `:` and the text after the closing brace stay byte for byte. A key is set where it stands;
  a new key goes after the last one, laid out like it; `null` removes the key with its comma.
- **Never over an unusable file.** A file that cannot be read or is not a JSON object is refused
  (`io-error`) and reported; a missing file is created holding just the keys set; removing a key from a
  missing file writes nothing.
- **One write at a time per file**, each starting from the file as it is on disk then, so a hand edit made
  before it stays. The text replaces the file through a sibling temporary file and a rename at the path the
  file resolves to, keeping its mode: a symlinked `settings.json` stays a symlink.
- Codex is `invalid-params` (read-only); no workspace is `not-ready` (the built-ins are read-only then).
  The roster is read again before the answer, so `roster.changed` carries the new `model` / `effort`.

## Mode switches

Full autonomy is switched in `agent.yaml` (`roster.updateProfile`, [roster-data](roster-data.md)), not in
the provider's config. Each enabled mode's launch line is the backend's own `roster.launchSpec`.

## Skill links (`skills.link`, `skills.unlink`)

A skill is on for an agent when `<configDir>/skills/<name>` is a symlink to a skill folder. The writes
(`skill-links.ts`) stay inside that one folder:

- `name` is one path segment — no `/`, no leading `.`, at most 255 characters. A `skills/` that is itself a
  symlink or not a folder is refused; a missing one is made by `link` (its parent must exist).
- **Only symlinks.** `unlink` refuses a real folder (the agent's own skill) or a file and never follows a
  link, so its target is untouched. `link` never replaces an entry.
- **The link's form** is relative to `skills/` when both lie in the workspace as Pomade names it
  (`../../_shared/skills/grill-me`, as the template's), else absolute (the built-in `claude`'s
  `~/.claude/skills/grill-me` → `<workspace>/Agents/_shared/skills/grill-me`).
- A refusal is `{ ok: false, reason }` with nothing written; `not-found` for an agent that is not a Claude
  Code agent of the roster (Codex, an orphan); `not-ready` without a workspace; `io-error` when the disk
  refuses. Both answer the whole catalog after the write and publish `skills.changed`.

The **skills catalog** (`skills.catalog`, `skills-catalog.ts`) lists the skills of the listed skill folders
and every Claude Code agent's `skills/` entries; it is read from disk on request. The folder list and the
Settings page that edits it belong to the Settings page ([DESIGN](../../DESIGN.md) §3.8,
[CONTRACTS "Skills"](../../CONTRACTS.md#skills)); the agent page only reads the catalog and links.

## Invariants

- The provider configs are written only by `roster.setModel`, and then only the `model` and `effortLevel`
  keys of a usable Claude Code `settings.json`.
- Agent folders are written only by skill links (inside `skills/`) and by creating an agent
  ([creating-agents](creating-agents.md)); a skill's folder and an own skill are never removed.
- An unusable config file is never written over.

## Tests

`agent-files.test.ts` (permissions and memory per provider), `model-config.test.ts`, `json-keys.test.ts`
(only the named keys change, layout kept), `skill-links.test.ts`, `skills-catalog.test.ts`. End to end:
`e2e/agent-model.spec.ts`, `e2e/agent-skills.spec.ts`, `e2e/agent-page.spec.ts`.

Tickets: T-022, T-023, T-024.
