// The Skills tab's lists, from the skills catalog (DESIGN §3.4): the agent's `skills/` entries
// grouped by skill folder — the listed folders in the Settings order, then a folder a link points
// into that Settings no longer lists (marked), then the agent's own — and what **Add skill** offers.
//
// A link switched off during this visit of the tab stays in its row, off, so switching never moves
// a row: the tab keeps the entry as it was and merges it back in here.

import type { AgentSkillEntry, AgentSkills, CatalogSkill, SkillsCatalog } from "../../../shared/skills.ts";

export interface SkillRow {
  entry: AgentSkillEntry;
  /** The link is in `skills/` now; `false` for one switched off during this visit. */
  on: boolean;
  /** The other agents with a link to the same skill (by real path), in roster order. */
  also: string[];
}

export interface SkillGroup {
  /** `folder`: a listed skill folder; `unlisted`: a folder the links point into that is not listed; `own`: the agent's own skills. */
  kind: "folder" | "unlisted" | "own";
  /** The folder's path; "Own" for the agent's own. */
  label: string;
  /** The rows switched on. */
  on: number;
  /** By entry name. */
  rows: SkillRow[];
}

/** The agent's `skills/` as the catalog reads it; `null` when it reads none (Codex, an orphan, not in the roster). */
export function agentSkills(catalog: SkillsCatalog, agent: string): AgentSkills | null {
  return catalog.agents.find((a) => a.agent === agent) ?? null;
}

const byName = (a: SkillRow, b: SkillRow): number => a.entry.name.localeCompare(b.entry.name);

/** The groups the Skills tab shows, without empty ones; `off`: entries switched off during this visit. */
export function skillGroups(catalog: SkillsCatalog, mine: AgentSkills, off: readonly AgentSkillEntry[]): SkillGroup[] {
  const present = new Set(mine.entries.map((e) => e.name));
  const entries = [...mine.entries, ...off.filter((e) => !present.has(e.name))];
  const also = (entry: AgentSkillEntry): string[] =>
    entry.targetPath === null ? [] : catalog.agents.filter((a) => a.agent !== mine.agent && a.entries.some((e) => e.kind === "link" && e.targetPath === entry.targetPath)).map((a) => a.agent);

  const listed = new Map<string, SkillRow[]>(catalog.folders.map((f) => [f.path, []]));
  const unlisted = new Map<string, SkillRow[]>();
  const own: SkillRow[] = [];
  for (const entry of entries) {
    const row = { entry, on: present.has(entry.name), also: also(entry) };
    if (entry.kind === "own") own.push(row);
    else if (entry.folder !== null && listed.has(entry.folder)) listed.get(entry.folder)?.push(row);
    else {
      const key = entry.targetFolder ?? entry.target ?? entry.name;
      unlisted.set(key, [...(unlisted.get(key) ?? []), row]);
    }
  }

  const group = (kind: SkillGroup["kind"], label: string, rows: SkillRow[]): SkillGroup => ({ kind, label, on: rows.filter((r) => r.on).length, rows: rows.sort(byName) });
  return [
    ...[...listed].map(([path, rows]) => group("folder", path, rows)),
    ...[...unlisted].sort(([a], [b]) => a.localeCompare(b)).map(([path, rows]) => group("unlisted", path, rows)),
    group("own", "Own", own),
  ].filter((g) => g.rows.length > 0);
}

/** "also in a, b +2", or "only here". */
export function alsoText(also: readonly string[]): string {
  if (also.length === 0) return "only here";
  return `also in ${also.slice(0, 2).join(", ")}${also.length > 2 ? ` +${also.length - 2}` : ""}`;
}

export interface AddableSkill {
  skill: CatalogSkill;
  /** The entry name the link takes in `skills/`: the skill's folder name, as the links already there are named. */
  name: string;
  /** Why it cannot be linked (an entry of that name is already there); `null` when it can. */
  blocked: string | null;
}

/** The folder name a link to `skill` takes. */
export const linkNameOf = (skill: CatalogSkill): string => skill.path.slice(skill.path.lastIndexOf("/") + 1);

/** What **Add skill** offers the agent, by listed folder: the catalog's skills it has no link to,
 *  matching `query` in the name or the description (any case). */
export function addableSkills(catalog: SkillsCatalog, mine: AgentSkills, query: string): { folder: string; skills: AddableSkill[] }[] {
  const q = query.trim().toLowerCase();
  const names = new Set(mine.entries.map((e) => e.name));
  const matches = (s: CatalogSkill): boolean => q === "" || s.name.toLowerCase().includes(q) || linkNameOf(s).toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q);
  return catalog.folders
    .map((f) => ({
      folder: f.path,
      skills: catalog.skills
        .filter((s) => s.folder === f.path && !s.agents.includes(mine.agent) && matches(s))
        .map((skill) => {
          const name = linkNameOf(skill);
          return { skill, name, blocked: names.has(name) ? `skills/${name} is already there` : null };
        }),
    }))
    .filter((g) => g.skills.length > 0);
}
