// The skill folders and the skills catalog as the UI and the backend both know them (DESIGN §3.4,
// §3.8; docs/CONTRACTS.md "Skills"): the workspace folders the catalog reads, kept in
// `settings.yaml`; the skills they hold; and every Claude Code agent's `skills/` entries.
//
// The shapes are type aliases, so they are JSON values to the broker as they are.

/** The whole catalog; answers `SkillsCatalog`. */
export const SKILLS_CATALOG_METHOD = "skills.catalog";

/** Replace the list of skill folders; answers `SetSkillFoldersResult`. */
export const SETTINGS_SET_SKILL_FOLDERS_METHOD = "settings.setSkillFolders";

/** Published by the backend, unqualified, whenever the list of skill folders changes; payload `SkillsChanged`. */
export const SKILLS_CHANGED_EVENT = "skills.changed";

/** The folders the catalog reads while `settings.yaml` has no `skillFolders` key. */
export const DEFAULT_SKILL_FOLDERS: readonly string[] = ["Agents/_shared/skills", "Knowledge/_skills"];

/** The file that makes a folder a skill. */
export const SKILL_FILE = "SKILL.md";

/** One listed skill folder, as the Settings page shows it. */
export type SkillFolder = {
  /** Workspace-relative, as `settings.yaml` lists it. */
  path: string;
  /** `missing`: nothing (or no folder) is at the path. */
  state: "ok" | "missing";
  /** The skills it holds, at any depth. */
  skills: number;
  /** Some of its skills sit in a subfolder, not directly in it. */
  nested: boolean;
  /** Agents' `skills/` links whose target lies in it. */
  links: number;
  /** The agents those links belong to, in roster order. */
  agents: string[];
};

/** One skill of a listed folder: what **Add skill** offers. */
export type CatalogSkill = {
  /** The `name` of its `SKILL.md` frontmatter, else its folder's name. */
  name: string;
  /** The listed skill folder that holds it (`SkillFolder.path`). */
  folder: string;
  /** The skill's own folder, workspace-relative. */
  path: string;
  /** The `description` of its `SKILL.md` frontmatter; `null` when it has none. */
  description: string | null;
  /** The agents whose `skills/` links point at it, in roster order. */
  agents: string[];
};

/** One entry of an agent's `skills/` folder. */
export type AgentSkillEntry = {
  /** The entry's name in `skills/`. */
  name: string;
  /** `link`: a symlink (the switch of the Skills tab); `own`: a real folder of the agent's. */
  kind: "link" | "own";
  /** A link's target, absolute, as the link names it (relative links resolved against `skills/`); `null` for an own skill. */
  target: string | null;
  /** The target with symlinks resolved, workspace-relative when it lies in the workspace, else absolute; `null` for an own skill and a broken link. */
  targetPath: string | null;
  /** Nothing is at the link's target. */
  broken: boolean;
  /** The listed skill folder the target lies in; `null` for an own skill and a link into a folder not listed. */
  folder: string | null;
  /** The target lies in a listed skill folder (`folder` is set). */
  listed: boolean;
  /** The parent folder of the target, as `targetPath` is written (a broken link's from `target`); where the Skills tab groups a link whose folder is not listed. `null` for an own skill. */
  targetFolder: string | null;
};

/** One Claude Code agent's `skills/` folder. */
export type AgentSkills = {
  /** The roster id. */
  agent: string;
  /** `<config folder>/skills`, absolute. */
  dir: string;
  /** By name; none when the folder is missing. */
  entries: AgentSkillEntry[];
};

export type SkillsCatalog = {
  /** One backend run; revisions count changes of the folder list within it. */
  epoch: string;
  revision: number;
  /** In `settings.yaml`'s order. */
  folders: SkillFolder[];
  /** Every skill of every listed folder, by folder then path. */
  skills: CatalogSkill[];
  /** Every Claude Code agent of the roster that is not an orphan, in roster order. */
  agents: AgentSkills[];
  /** Why the list cannot be changed now (no workspace open, an unusable `settings.yaml`); `null` while it can. */
  foldersOff: string | null;
};

export type SetSkillFoldersParams = { folders: string[] };

/** The catalog with the new list, or the folder refused and why (nothing is written then). */
export type SetSkillFoldersResult = { ok: true; catalog: SkillsCatalog } | { ok: false; folder: string; reason: string };

/** `skills.changed`: the revision `skills.catalog` answers now. */
export type SkillsChanged = { epoch: string; revision: number };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");
const isStringOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";

function isSkillFolder(v: unknown): v is SkillFolder {
  return (
    isObject(v) &&
    typeof v.path === "string" &&
    (v.state === "ok" || v.state === "missing") &&
    typeof v.skills === "number" &&
    typeof v.nested === "boolean" &&
    typeof v.links === "number" &&
    isStrings(v.agents)
  );
}

function isCatalogSkill(v: unknown): v is CatalogSkill {
  return isObject(v) && typeof v.name === "string" && typeof v.folder === "string" && typeof v.path === "string" && isStringOrNull(v.description) && isStrings(v.agents);
}

function isAgentSkillEntry(v: unknown): v is AgentSkillEntry {
  return (
    isObject(v) &&
    typeof v.name === "string" &&
    (v.kind === "link" || v.kind === "own") &&
    isStringOrNull(v.target) &&
    isStringOrNull(v.targetPath) &&
    typeof v.broken === "boolean" &&
    isStringOrNull(v.folder) &&
    typeof v.listed === "boolean" &&
    isStringOrNull(v.targetFolder)
  );
}

function isAgentSkills(v: unknown): v is AgentSkills {
  return isObject(v) && typeof v.agent === "string" && typeof v.dir === "string" && Array.isArray(v.entries) && v.entries.every(isAgentSkillEntry);
}

/** True for a well-formed `skills.catalog` answer. */
export function isSkillsCatalog(value: unknown): value is SkillsCatalog {
  return (
    isObject(value) &&
    typeof value.epoch === "string" &&
    typeof value.revision === "number" &&
    Array.isArray(value.folders) &&
    value.folders.every(isSkillFolder) &&
    Array.isArray(value.skills) &&
    value.skills.every(isCatalogSkill) &&
    Array.isArray(value.agents) &&
    value.agents.every(isAgentSkills) &&
    isStringOrNull(value.foldersOff)
  );
}

/** True for a well-formed `settings.setSkillFolders` answer. */
export function isSetSkillFoldersResult(value: unknown): value is SetSkillFoldersResult {
  if (!isObject(value)) return false;
  if (value.ok === true) return isSkillsCatalog(value.catalog);
  return value.ok === false && typeof value.folder === "string" && typeof value.reason === "string";
}

/** True for a well-formed `skills.changed` payload. */
export function isSkillsChanged(value: unknown): value is SkillsChanged {
  return isObject(value) && typeof value.epoch === "string" && typeof value.revision === "number";
}
