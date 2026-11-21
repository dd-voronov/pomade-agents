// The roster as the UI and the backend both know it (docs/CONTRACTS.md "Roster"): the agent
// profile the app keeps for each agent (`agent.yaml`, DESIGN §3.2), the roster Pomade and other
// apps read (`roster.list`, Pomade's `RosterAgent`), launch specs (DESIGN §3.5), the project ↔
// agent connection, and the app's own full read with its change notice.
//
// The shapes are type aliases, so they are JSON values to the broker as they are.

import { ROSTER_METHOD, type AgentProvider, type RosterAgent } from "pomade-kit/protocol";

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
