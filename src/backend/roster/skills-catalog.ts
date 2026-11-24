// The skills catalog (DESIGN §3.4, §3.8): the skills the listed skill folders hold, and every
// Claude Code agent's `skills/` entries — which link where, which are the agent's own, and whether a
// link's target lies in a listed folder.
//
// - **A skill** is a folder holding `SKILL.md`, at any depth of a listed folder; its own subfolders
//   are not searched further. Folders whose names start with `.`, and `node_modules`, are skipped;
//   symlinked folders are followed once each (by real path), at most `MAX_DEPTH` deep.
// - **Read on request.** Every `read` walks the listed folders and the agents' `skills/` folders
//   anew, so a skill added or removed on disk, and a link made or taken away, show on the next
//   read. The folder list itself is followed as it changes (`skills.changed`).
// - **Matching** is by real path: a link points at a skill when both resolve to the same folder,
//   and into a listed folder when its target resolves inside it — or, for a broken link, when the
//   path it names lies inside it.

import { randomUUID } from "node:crypto";
import { readFile, readdir, readlink, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { readFrontmatter } from "pomade-kit/protocol";
import { HostError } from "pomade-kit/sdk";

import { SKILL_FILE, type AgentSkillEntry, type AgentSkills, type CatalogSkill, type SetSkillFoldersResult, type SkillFolder, type SkillsCatalog, type SkillsChanged } from "../../shared/skills.ts";
import type { SkillFolderSettings } from "../settings/settings.ts";
import { resolveConfigDir, type Roster } from "./roster.ts";

/** How deep below a listed folder skills are looked for. */
export const MAX_DEPTH = 8;

/** An agent whose `skills/` folder the catalog reads. */
export interface CatalogAgent {
  id: string;
  /** `<config folder>/skills`, absolute. */
  skillsDir: string;
}

export interface CatalogRead {
  folders: SkillFolder[];
  skills: CatalogSkill[];
  agents: AgentSkills[];
}

const code = (err: unknown): string | undefined => (err as NodeJS.ErrnoException | null)?.code;

async function realOrNull(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch {
    return null;
  }
}

async function isFolder(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

const inside = (child: string, parent: string): boolean => child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);

interface FoundSkill {
  /** Workspace-relative, through the listed folder as named. */
  path: string;
  real: string;
  depth: number;
}

/** The skills under `abs` (the listed folder `path`), by path. */
async function findSkills(abs: string, path: string): Promise<FoundSkill[]> {
  const found: FoundSkill[] = [];
  const seen = new Set<string>();
  const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
    const real = await realOrNull(dir);
    if (real === null || seen.has(real)) return;
    seen.add(real);
    let names: string[];
    try {
      names = (await readdir(dir)).sort();
    } catch {
      return;
    }
    if (depth > 0 && names.includes(SKILL_FILE) && !(await isFolder(join(dir, SKILL_FILE)))) {
      found.push({ path: rel, real, depth });
      return;
    }
    if (depth >= MAX_DEPTH) return;
    for (const name of names) {
      if (name.startsWith(".") || name === "node_modules") continue;
      const child = join(dir, name);
      if (await isFolder(child)) await walk(child, `${rel}/${name}`, depth + 1);
    }
  };
  await walk(abs, path, 0);
  return found;
}

/** The `name` and `description` of a skill's `SKILL.md`, when its frontmatter has them. */
async function skillFacts(dir: string): Promise<{ name: string | null; description: string | null }> {
  try {
    const read = readFrontmatter(await readFile(join(dir, SKILL_FILE), "utf8"));
    if ("frontmatterError" in read || read.frontmatter === null) return { name: null, description: null };
    const { name, description } = read.frontmatter;
    return {
      name: typeof name === "string" && name.trim() !== "" ? name.trim() : null,
      description: typeof description === "string" && description.trim() !== "" ? description.trim() : null,
    };
  } catch {
    return { name: null, description: null };
  }
}

/** Read the listed `folders` (workspace-relative) and the `agents`' `skills/` folders. `roots`: the
 *  workspace as Pomade names it and with symlinks resolved, for the paths the answer shows. */
export async function readCatalog(workspace: string, roots: readonly string[], folders: readonly string[], agents: readonly CatalogAgent[]): Promise<CatalogRead> {
  const show = (abs: string): string => {
    for (const root of roots) if (inside(abs, root)) return relative(root, abs).split(sep).join("/");
    return abs;
  };

  const listed = await Promise.all(
    folders.map(async (path) => {
      const abs = join(workspace, path);
      const real = (await isFolder(abs)) ? await realOrNull(abs) : null;
      return { path, abs, real };
    }),
  );

  const skills: (CatalogSkill & { real: string })[] = [];
  const counts = new Map<string, { skills: number; nested: boolean }>();
  const taken = new Set<string>();
  for (const folder of listed) {
    const found = folder.real === null ? [] : await findSkills(folder.abs, folder.path);
    let count = 0;
    let nested = false;
    for (const skill of found) {
      if (taken.has(skill.real)) continue;
      taken.add(skill.real);
      count++;
      nested ||= skill.depth > 1;
      const facts = await skillFacts(join(workspace, skill.path));
      const base = skill.path.slice(skill.path.lastIndexOf("/") + 1);
      skills.push({ name: facts.name ?? base, folder: folder.path, path: skill.path, description: facts.description, agents: [], real: skill.real });
    }
    counts.set(folder.path, { skills: count, nested });
  }

  /** The listed folder an absolute path lies in: by real path, else as named. */
  const folderOf = (real: string | null, named: string): string | null => {
    for (const folder of listed) {
      if (real !== null && folder.real !== null && inside(real, folder.real)) return folder.path;
      if (inside(named, folder.abs)) return folder.path;
    }
    return null;
  };

  const agentSkills: AgentSkills[] = [];
  for (const agent of agents) {
    let names: string[] = [];
    try {
      names = (await readdir(agent.skillsDir)).filter((n) => !n.startsWith(".")).sort();
    } catch (err) {
      if (code(err) !== "ENOENT" && code(err) !== "ENOTDIR") throw err;
    }
    const entries: AgentSkillEntry[] = [];
    for (const name of names) {
      const path = join(agent.skillsDir, name);
      let link: string | null = null;
      try {
        link = await readlink(path);
      } catch (err) {
        if (code(err) !== "EINVAL") continue;
      }
      if (link === null) {
        if (!(await isFolder(path))) continue;
        entries.push({ name, kind: "own", target: null, targetPath: null, broken: false, folder: null, listed: false, targetFolder: null });
        continue;
      }
      const target = isAbsolute(link) ? link : resolve(agent.skillsDir, link);
      const real = await realOrNull(target);
      const folder = folderOf(real, target);
      const targetPath = real === null ? null : show(real);
      entries.push({
        name,
        kind: "link",
        target,
        targetPath,
        broken: real === null,
        folder,
        listed: folder !== null,
        targetFolder: show(dirname(real ?? target)),
      });
      if (real !== null) {
        const skill = skills.find((s) => s.real === real);
        if (skill !== undefined && !skill.agents.includes(agent.id)) skill.agents.push(agent.id);
      }
    }
    agentSkills.push({ agent: agent.id, dir: agent.skillsDir, entries });
  }

  const folderRows: SkillFolder[] = listed.map((folder) => {
    let links = 0;
    const users: string[] = [];
    for (const a of agentSkills) {
      const n = a.entries.filter((e) => e.folder === folder.path).length;
      links += n;
      if (n > 0) users.push(a.agent);
    }
    const count = counts.get(folder.path) ?? { skills: 0, nested: false };
    return { path: folder.path, state: folder.real === null ? "missing" : "ok", skills: count.skills, nested: count.nested, links, agents: users };
  });

  return { folders: folderRows, skills: skills.map(({ real: _real, ...skill }) => skill), agents: agentSkills };
}

// ── The catalog the backend serves ─────────────────────────────────────────

export interface SkillsCatalogOptions {
  /** The open workspace as Pomade names it; `null` when none is open. */
  workspace: string | null;
  /** The workspace with symlinks resolved. */
  workspaceReal: string | null;
  home: string | null;
  settings: SkillFolderSettings;
  roster: Pick<Roster, "answer" | "agent">;
}

export interface SkillsCatalogService {
  /** The catalog as the disk holds it now (`skills.catalog`). */
  read(): Promise<SkillsCatalog>;
  /** Replace the list of skill folders (`settings.setSkillFolders`). */
  setFolders(folders: string[]): Promise<SetSkillFoldersResult>;
  /** Called when the folder list changes (`skills.changed`); returns an unsubscribe function. */
  onChange(listener: (changed: SkillsChanged) => void): () => void;
  stop(): void;
}

export function startSkillsCatalog(options: SkillsCatalogOptions): SkillsCatalogService {
  const { workspace, workspaceReal, home, settings, roster } = options;
  const epoch = randomUUID();
  let revision = 0;
  const listeners = new Set<(changed: SkillsChanged) => void>();
  const roots = [workspace, workspaceReal].filter((r): r is string => r !== null);

  const catalogAgents = (): CatalogAgent[] => {
    const out: CatalogAgent[] = [];
    for (const entry of roster.answer().agents) {
      const facts = roster.agent(entry.id);
      if (facts === undefined || facts.orphan || facts.profile.provider !== "claude") continue;
      const dir = resolveConfigDir(facts.profile.configDir, home, workspace);
      if (dir !== null) out.push({ id: entry.id, skillsDir: join(dir, "skills") });
    }
    return out;
  };

  const read = async (): Promise<SkillsCatalog> => {
    const { folders, foldersOff } = settings.folders();
    const at = revision;
    const answer = workspace === null ? { folders: [], skills: [], agents: [] } : await readCatalog(workspace, roots, folders, catalogAgents());
    return { epoch, revision: at, ...answer, foldersOff };
  };

  const unsubscribe = settings.onChange(() => {
    revision++;
    const changed = { epoch, revision };
    for (const listener of listeners) listener(changed);
  });

  return {
    read,
    async setFolders(folders) {
      const off = settings.folders().foldersOff;
      if (off !== null) throw new HostError("not-ready", off);
      let result;
      try {
        result = await settings.set(folders);
      } catch (err) {
        throw new HostError("io-error", err instanceof Error ? err.message : String(err));
      }
      if (!result.ok) return result;
      return { ok: true, catalog: await read() };
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop() {
      unsubscribe();
    },
  };
}
