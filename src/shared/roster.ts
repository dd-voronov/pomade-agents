// The roster as the UI and the backend both know it (docs/CONTRACTS.md "Roster"): the agent
// profile the app keeps for each agent (`agent.yaml`, DESIGN §3.2), the roster Pomade and other
// apps read (`roster.list`, Pomade's `RosterAgent`), launch specs (DESIGN §3.5), the project ↔
// agent connection, and the app's own full read with its change notice.
//
// The shapes are type aliases, so they are JSON values to the broker as they are.

import { ROSTER_METHOD, type AgentProvider, type RosterAgent } from "pomade-kit/protocol";

import type { NameProblem } from "./agent-name.ts";

/** Answers `{ agents: RosterAgent[] }` — Pomade's roster read (HOST-API §4 "Platform reads of app APIs"). */
export const ROSTER_LIST_METHOD = ROSTER_METHOD;

/** The command line for one launch; answers `LaunchSpec`. */
export const ROSTER_LAUNCH_SPEC_METHOD = "roster.launchSpec";

/** The projects an agent is connected to; answers `RosterProjectsForResult`. */
export const ROSTER_PROJECTS_FOR_METHOD = "roster.projectsFor";

/** The agents connected to a project; answers `RosterAgentsForResult`. */
export const ROSTER_AGENTS_FOR_METHOD = "roster.agentsFor";

/** Every profile, hidden ones and orphans included, for the app's own frames; answers `RosterAgentsAnswer`. */
export const ROSTER_AGENTS_METHOD = "roster.agents";

/** Published by the backend, unqualified, whenever `roster.agents` would answer differently; payload `RosterChanged`. */
export const ROSTER_CHANGED_EVENT = "roster.changed";

/** The modes every provider has (DESIGN §3.5), in the order the roster lists them. */
export const MODE_IDS = ["normal", "full-autonomy"] as const;
export type ModeId = (typeof MODE_IDS)[number];

export type AgentKind = "builtin" | "folder";

/** One agent's `agent.yaml` as the app reads it (DESIGN §3.2). `tags` and `hidden` absent from the
 *  file read as `[]` and `false`; a mode absent from `modes` is not enabled. */
export type AgentProfile = {
  id: string;
  provider: AgentProvider;
  kind: AgentKind;
  /** As written: workspace-relative, `~/…` (the home folder), or absolute. */
  configDir: string;
  /** What the shell runs to launch the agent: its alias. One line. */
  command: string;
  /** One line: what the agent is for. */
  role?: string;
  tags: string[];
  /** Left out of `roster.list`, so Pomade's "+" menu does not offer it. */
  hidden: boolean;
  modes: Partial<Record<ModeId, { enabled: boolean }>>;
};

/** `agent.yaml`'s keys, in the order a new file is written. */
export const AGENT_PROFILE_KEYS = ["id", "provider", "kind", "configDir", "command", "role", "tags", "hidden", "modes"] as const satisfies readonly (keyof AgentProfile)[];

/** One agent as `roster.agents` answers it. */
export type RosterEntry = {
  id: string;
  /** What the "+" menu and the tab show. */
  name: string;
  /** The profile as `agent.yaml` holds it; `null` when the file cannot be used (`problem` says why). */
  profile: AgentProfile | null;
  problem: string | null;
  /** The profile's config folder is gone (a folder agent's folder was renamed or removed). */
  orphan: boolean;
  /** The profile's config folder, absolute; `null` without a usable profile. */
  configDir: string | null;
  /** The default model and effort, from the provider's own config; `null` when it sets none. */
  model: string | null;
  effort: string | null;
};

export type RosterAgentsAnswer = {
  /** One backend run; revisions count within it. */
  epoch: string;
  revision: number;
  /** Built-ins first, then by id. */
  agents: RosterEntry[];
  /** Why no profiles are kept now (no workspace is open); `null` while they are. */
  profilesOff: string | null;
};

/** `roster.changed`: the revision `roster.agents` answers now. */
export type RosterChanged = { epoch: string; revision: number };

export type LaunchSpecParams = {
  /** The roster id. */
  agent: string;
  mode: string;
  /** A session to resume. */
  resume?: string;
  /** A new session with this id (a UUID); not with `resume`. */
  sessionId?: string;
  /** The first prompt. */
  prompt?: string;
};

export type LaunchSpec = {
  /** The agent's launch command (its alias), as typed. */
  command: string;
  /** Everything after the command, unquoted. */
  args: string[];
  /** `command` and `args` as one line for a POSIX shell, each argument quoted where it needs it. */
  line: string;
  /** The id the launched session will have; `null` when the provider cannot pre-assign one. */
  sessionId: string | null;
  /** What to type to end the agent. */
  exit: string;
};

export type RosterProjectsForParams = { agent: string };
export type RosterProjectsForResult = { projects: string[] };
export type RosterAgentsForParams = { project: string };
export type RosterAgentsForResult = { agents: string[] };

export type { AgentProvider, RosterAgent };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isLine = (v: unknown): v is string => typeof v === "string" && v.trim() !== "" && !/[\r\n]/.test(v);

export function isAgentProvider(v: unknown): v is AgentProvider {
  return v === "claude" || v === "codex";
}

function isModes(v: unknown): boolean {
  if (!isObject(v)) return false;
  return MODE_IDS.every((id) => v[id] === undefined || (isObject(v[id]) && typeof (v[id] as Record<string, unknown>).enabled === "boolean"));
}

/** True for a profile with only `AgentProfile`'s keys, each well-formed. */
export function isAgentProfile(value: unknown): value is AgentProfile {
  if (!isObject(value)) return false;
  const v = value;
  return (
    Object.keys(v).every((key) => (AGENT_PROFILE_KEYS as readonly string[]).includes(key)) &&
    isLine(v.id) &&
    isAgentProvider(v.provider) &&
    (v.kind === "builtin" || v.kind === "folder") &&
    isLine(v.configDir) &&
    isLine(v.command) &&
    (v.role === undefined || isLine(v.role)) &&
    Array.isArray(v.tags) &&
    v.tags.every(isLine) &&
    typeof v.hidden === "boolean" &&
    isModes(v.modes)
  );
}

function isRosterEntry(v: unknown): v is RosterEntry {
  return (
    isObject(v) &&
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    (v.profile === null || isAgentProfile(v.profile)) &&
    (v.problem === null || typeof v.problem === "string") &&
    typeof v.orphan === "boolean" &&
    (v.configDir === null || typeof v.configDir === "string") &&
    (v.model === null || typeof v.model === "string") &&
    (v.effort === null || typeof v.effort === "string")
  );
}

/** True for a well-formed `roster.agents` answer. */
export function isRosterAgentsAnswer(value: unknown): value is RosterAgentsAnswer {
  return (
    isObject(value) &&
    typeof value.epoch === "string" &&
    typeof value.revision === "number" &&
    Array.isArray(value.agents) &&
    value.agents.every(isRosterEntry) &&
    (value.profilesOff === null || typeof value.profilesOff === "string")
  );
}

/** True for a well-formed `roster.changed` payload. */
export function isRosterChanged(value: unknown): value is RosterChanged {
  return isObject(value) && typeof value.epoch === "string" && typeof value.revision === "number";
}

/** True for a well-formed `roster.launchSpec` answer. */
export function isLaunchSpec(value: unknown): value is LaunchSpec {
  return (
    isObject(value) &&
    typeof value.command === "string" &&
    Array.isArray(value.args) &&
    value.args.every((a) => typeof a === "string") &&
    typeof value.line === "string" &&
    (value.sessionId === null || typeof value.sessionId === "string") &&
    typeof value.exit === "string"
  );
}

// ── Creating an agent (DESIGN §3.6) ─────────────────────────────────────────

/** Whether a name can be had for a new agent; answers `NameVerdict`. */
export const ROSTER_CHECK_NAME_METHOD = "roster.checkName";

/** Create a folder agent from `Agents/Claude Agent Template`; answers `CreateAgentResult` once every step has run. */
export const ROSTER_CREATE_METHOD = "roster.create";

/** Whether an agent's alias resolves in a fresh interactive zsh; answers `AliasCheck`. */
export const ROSTER_CHECK_ALIAS_METHOD = "roster.checkAlias";

/** Published by the backend, unqualified, as each step of a `roster.create` starts and ends; payload `RosterCreating`. */
export const ROSTER_CREATING_EVENT = "roster.creating";

/** The steps of a Create from the template, in the order they run:
 *  - `folder` — copy the template to `Agents/<name>/`
 *  - `skills` — link every `Agents/_shared/skills/*` its `skills/` lacks
 *  - `profile` — write `agent.yaml`
 *  - `projects` — connect the projects (pomade:E-030)
 *  - `alias` — append the alias line to the rc file, unless it is there
 *  - `verify` — a fresh interactive zsh resolves the alias to the agent's folder */
export const CREATE_STEP_IDS = ["folder", "skills", "profile", "projects", "alias", "verify"] as const;
export type CreateStepId = (typeof CREATE_STEP_IDS)[number];

/** `todo` not started · `run` running · `done` · `skip` nothing to do · `fail` (`detail` says why). */
export type CreateStepState = "todo" | "run" | "done" | "skip" | "fail";

export type CreateStep = {
  id: CreateStepId;
  state: CreateStepState;
  /** One line: what the step did, or why it failed; `null` before it ends. */
  detail: string | null;
};

export type NameVerdict = {
  /** The name checked, as given. */
  name: string;
  /** Why the name cannot be had (`agent-name.ts` `NameProblem`); `null` when it can. */
  problem: NameProblem | null;
  /** For `shell`, what zsh says the name is (`whence -v`); for `shell-error`, what went wrong; else `null`. */
  detail: string | null;
};

export type CreateAgentParams = {
  name: string;
  /** One line, not blank. */
  role: string;
  tags: string[];
  /** Stable project ids, in the order to connect them. */
  projects: string[];
  /** The caller's id for this Create: `roster.creating` notices carry it. */
  createId: string;
};

/** - `created` — every step done or skipped
 *  - `incomplete` — the agent exists; connecting a project, the alias or its check failed
 *  - `failed` — copying, linking or writing `agent.yaml` failed: what this Create wrote is removed
 *  - `refused` — the name cannot be had (`refused`); nothing was written */
export type CreateOutcome = "created" | "incomplete" | "failed" | "refused";

export type CreateAgentResult = {
  createId: string;
  name: string;
  outcome: CreateOutcome;
  steps: CreateStep[];
  /** The name check that refused the Create; `null` otherwise. */
  refused: NameVerdict | null;
  /** The agent's folder, absolute (`<workspace>/Agents/<name>`). */
  folder: string;
  /** The line the rc file gets: `alias <name>='CLAUDE_CONFIG_DIR="<folder>" claude'`. */
  aliasLine: string;
  /** The rc file, absolute: `$ZDOTDIR/.zshrc`, else `$HOME/.zshrc`; `null` when neither is set. */
  rcFile: string | null;
};

/** `roster.creating`: the steps of one Create as they are now. */
export type RosterCreating = { createId: string; steps: CreateStep[] };

export type AliasCheckParams = { agent: string };

export type AliasCheck = {
  /** A fresh interactive zsh resolves the agent's name to its alias line's command. */
  ok: boolean;
  aliasLine: string;
  rcFile: string | null;
  /** Why not, in one line; `null` when `ok`. */
  detail: string | null;
};

const isStep = (v: unknown): v is CreateStep =>
  isObject(v) &&
  (CREATE_STEP_IDS as readonly unknown[]).includes(v.id) &&
  ["todo", "run", "done", "skip", "fail"].includes(v.state as string) &&
  (v.detail === null || typeof v.detail === "string");

const isNameVerdict = (v: unknown): v is NameVerdict =>
  isObject(v) && typeof v.name === "string" && (v.problem === null || typeof v.problem === "string") && (v.detail === null || typeof v.detail === "string");

/** True for a well-formed `roster.checkName` answer. */
export function isNameVerdictAnswer(value: unknown): value is NameVerdict {
  return isNameVerdict(value);
}

/** True for a well-formed `roster.create` answer. */
export function isCreateAgentResult(value: unknown): value is CreateAgentResult {
  return (
    isObject(value) &&
    typeof value.createId === "string" &&
    typeof value.name === "string" &&
    ["created", "incomplete", "failed", "refused"].includes(value.outcome as string) &&
    Array.isArray(value.steps) &&
    value.steps.every(isStep) &&
    (value.refused === null || isNameVerdict(value.refused)) &&
    typeof value.folder === "string" &&
    typeof value.aliasLine === "string" &&
    (value.rcFile === null || typeof value.rcFile === "string")
  );
}

/** True for a well-formed `roster.creating` payload. */
export function isRosterCreating(value: unknown): value is RosterCreating {
  return isObject(value) && typeof value.createId === "string" && Array.isArray(value.steps) && value.steps.every(isStep);
}

/** True for a well-formed `roster.checkAlias` answer. */
export function isAliasCheck(value: unknown): value is AliasCheck {
  return (
    isObject(value) &&
    typeof value.ok === "boolean" &&
    typeof value.aliasLine === "string" &&
    (value.rcFile === null || typeof value.rcFile === "string") &&
    (value.detail === null || typeof value.detail === "string")
  );
}

// ── The agent's page: editing the profile, reading its config ────────────────

/** Changes an agent's role line and tags in its `agent.yaml`; answers `RosterUpdateProfileResult`. */
export const ROSTER_UPDATE_PROFILE_METHOD = "roster.updateProfile";

/** What an agent's provider config grants — permissions, MCP servers, plugins; answers `AgentPermissions`. */
export const ROSTER_PERMISSIONS_METHOD = "roster.permissions";

/** The projects an agent keeps memory for, and the files of each; answers `AgentMemory`. */
export const ROSTER_MEMORY_METHOD = "roster.memory";

/** The longest role line, in characters. */
export const ROLE_MAX = 200;
/** The longest tag, in characters. */
export const TAG_MAX = 24;

/** `roster.updateProfile` params: each key present is set, `role: null` removes the role line. */
export type RosterUpdateProfileParams = {
  agent: string;
  role?: string | null;
  tags?: string[];
};

export type RosterUpdateProfileResult = { profile: AgentProfile };

export type McpServer = {
  name: string;
  /** `stdio`, `http`, `sse`…; `null` when the config names none. */
  type: string | null;
};

/** One agent's permissions, MCP servers and plugins, read from its provider config. */
export type AgentPermissions = {
  provider: AgentProvider;
  /** The config file the facts come from, absolute: Claude Code's `settings.json`, Codex's `config.toml`. */
  file: string;
  /** The file exists; with `false` every list is empty. */
  exists: boolean;
  /** Why the file cannot be read; `null` when it can (or is absent). */
  problem: string | null;
  /** Claude Code: `permissions.defaultMode`; Codex: `approval_policy`. */
  defaultMode: string | null;
  /** Codex: `sandbox_mode`; Claude Code: always `null`. */
  sandbox: string | null;
  /** Claude Code's `permissions.allow` / `ask` / `deny`; empty for Codex. */
  allow: string[];
  ask: string[];
  deny: string[];
  mcp: McpServer[];
  /** Claude Code's enabled plugins (`enabledPlugins`); empty for Codex. */
  plugins: string[];
};

export type AgentMemoryFile = {
  name: string;
  /** Absolute. */
  path: string;
};

/** The memory of one project folder: `<configDir>/projects/<folder>/memory/`. */
export type AgentMemoryFolder = {
  /** The folder's name under `projects/`: the project's folder path with every character other than a letter or digit as `-` (`claudeFolderName`). */
  folder: string;
  /** Markdown files, `MEMORY.md` first, then by name. */
  files: AgentMemoryFile[];
};

export type AgentMemory = {
  /** Only folders with at least one file, by folder name. */
  folders: AgentMemoryFolder[];
};

/** How Claude Code names a project's folder under `projects/`: every character that is not a letter or digit becomes `-`. */
export function claudeFolderName(path: string): string {
  return path.replace(/[^A-Za-z0-9]/g, "-");
}

const isTextList = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");

/** True for a well-formed `roster.updateProfile` answer. */
export function isRosterUpdateProfileResult(value: unknown): value is RosterUpdateProfileResult {
  return isObject(value) && isAgentProfile(value.profile);
}

/** True for a well-formed `roster.permissions` answer. */
export function isAgentPermissions(value: unknown): value is AgentPermissions {
  return (
    isObject(value) &&
    isAgentProvider(value.provider) &&
    typeof value.file === "string" &&
    typeof value.exists === "boolean" &&
    (value.problem === null || typeof value.problem === "string") &&
    (value.defaultMode === null || typeof value.defaultMode === "string") &&
    (value.sandbox === null || typeof value.sandbox === "string") &&
    isTextList(value.allow) &&
    isTextList(value.ask) &&
    isTextList(value.deny) &&
    Array.isArray(value.mcp) &&
    value.mcp.every((m) => isObject(m) && typeof m.name === "string" && (m.type === null || typeof m.type === "string")) &&
    isTextList(value.plugins)
  );
}

/** True for a well-formed `roster.memory` answer. */
export function isAgentMemory(value: unknown): value is AgentMemory {
  return (
    isObject(value) &&
    Array.isArray(value.folders) &&
    value.folders.every(
      (f) => isObject(f) && typeof f.folder === "string" && Array.isArray(f.files) && f.files.every((file) => isObject(file) && typeof file.name === "string" && typeof file.path === "string"),
    )
  );
}
