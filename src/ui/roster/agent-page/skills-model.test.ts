import { describe, expect, it } from "vitest";

import type { AgentSkillEntry, CatalogSkill, SkillFolder, SkillsCatalog } from "../../../shared/skills.ts";
import { addableSkills, agentSkills, alsoText, skillGroups } from "./skills-model.ts";

const SHARED = "Agents/_shared/skills";
const KNOWLEDGE = "Knowledge/_skills";

const folder = (path: string): SkillFolder => ({ path, state: "ok", skills: 0, nested: false, links: 0, agents: [] });
const skill = (path: string, agents: string[] = [], description: string | null = null, name = path.slice(path.lastIndexOf("/") + 1)): CatalogSkill => ({
  name,
  folder: path.startsWith(SHARED) ? SHARED : KNOWLEDGE,
  path,
  description,
  agents,
});
const link = (name: string, targetPath: string, folderPath: string | null): AgentSkillEntry => ({
  name,
  kind: "link",
  target: `/ws/${targetPath}`,
  targetPath,
  broken: false,
  folder: folderPath,
  listed: folderPath !== null,
  targetFolder: targetPath.slice(0, targetPath.lastIndexOf("/")),
  description: null,
});
const broken = (name: string, target: string, folderPath: string | null): AgentSkillEntry => ({
  name,
  kind: "link",
  target,
  targetPath: null,
  broken: true,
  folder: folderPath,
  listed: folderPath !== null,
  targetFolder: target.slice(0, target.lastIndexOf("/")),
  description: null,
});
const own = (name: string): AgentSkillEntry => ({ name, kind: "own", target: null, targetPath: null, broken: false, folder: null, listed: false, targetFolder: null, description: null });

function catalog(pm: AgentSkillEntry[]): SkillsCatalog {
  return {
    epoch: "e",
    revision: 0,
    folders: [folder(SHARED), folder(KNOWLEDGE)],
    skills: [
      skill(`${SHARED}/grill-me`, ["claude", "claude-pm"], "Interview the user."),
      skill(`${SHARED}/second-opinion`, [], "Ask another model."),
      skill(`${KNOWLEDGE}/wiki/wiki-query`, ["claude-pm", "claude-libra"], "Answer from the wiki."),
      skill(`${KNOWLEDGE}/librarian/inbox-triage`, ["claude-libra"], null, "Inbox triage"),
      skill(`${KNOWLEDGE}/own-clash`, []),
    ],
    agents: [
      { agent: "claude", dir: "/home/.claude/skills", entries: [link("grill-me", `${SHARED}/grill-me`, SHARED)] },
      { agent: "claude-pm", dir: "/ws/Agents/claude-pm/skills", entries: pm },
      {
        agent: "claude-libra",
        dir: "/ws/Agents/claude-libra/skills",
        entries: [link("wiki-query", `${KNOWLEDGE}/wiki/wiki-query`, KNOWLEDGE), link("kit-release", "Projects/kit/skills/kit-release", null), own("vault-audit")],
      },
      { agent: "claude-coder", dir: "/ws/Agents/claude-coder/skills", entries: [link("wiki-query", `${KNOWLEDGE}/wiki/wiki-query`, KNOWLEDGE)] },
      { agent: "claude-writer", dir: "/ws/Agents/claude-writer/skills", entries: [link("q", `${KNOWLEDGE}/wiki/wiki-query`, KNOWLEDGE)] },
    ],
    foldersOff: null,
  };
}

const PM = [
  link("wiki-query", `${KNOWLEDGE}/wiki/wiki-query`, KNOWLEDGE),
  link("grill-me", `${SHARED}/grill-me`, SHARED),
  link("kit-release", "Projects/kit/skills/kit-release", null),
  broken("gone", `/ws/${SHARED}/gone`, SHARED),
  broken("lost", "/old/skills/lost", null),
  own("pm-notes"),
  own("own-clash"),
];

describe("skillGroups", () => {
  it("groups by listed folder in the Settings order, then the folders not listed (by path), then own; rows by name", () => {
    const c = catalog(PM);
    const mine = agentSkills(c, "claude-pm");
    if (mine === null) throw new Error("no claude-pm");
    const groups = skillGroups(c, mine, []);
    expect(groups.map((g) => [g.kind, g.label, g.on, g.rows.map((r) => r.entry.name)])).toEqual([
      ["folder", SHARED, 2, ["gone", "grill-me"]],
      ["folder", KNOWLEDGE, 1, ["wiki-query"]],
      ["unlisted", "/old/skills", 1, ["lost"]],
      ["unlisted", "Projects/kit/skills", 1, ["kit-release"]],
      ["own", "Own", 2, ["own-clash", "pm-notes"]],
    ]);
  });

  it("names the other agents linking the same skill, by real path, in roster order; none for own and broken", () => {
    const c = catalog(PM);
    const mine = agentSkills(c, "claude-pm");
    if (mine === null) throw new Error("no claude-pm");
    const rows = skillGroups(c, mine, []).flatMap((g) => g.rows);
    const also = Object.fromEntries(rows.map((r) => [r.entry.name, r.also]));
    expect(also).toEqual({
      gone: [],
      "grill-me": ["claude"],
      "wiki-query": ["claude-libra", "claude-coder", "claude-writer"],
      lost: [],
      "kit-release": ["claude-libra"],
      "own-clash": [],
      "pm-notes": [],
    });
  });

  it("keeps a link switched off in its row, off; the group's count is of the rows on, and a group of only off rows stays", () => {
    const c = catalog(PM.filter((e) => e.name !== "grill-me" && e.name !== "kit-release"));
    const mine = agentSkills(c, "claude-pm");
    if (mine === null) throw new Error("no claude-pm");
    const off = [PM[1], PM[2]].filter((e): e is AgentSkillEntry => e !== undefined);
    const groups = skillGroups(c, mine, off);
    expect(groups.map((g) => [g.label, g.on, g.rows.map((r) => `${r.entry.name}:${r.on ? "on" : "off"}`)])).toEqual([
      [SHARED, 1, ["gone:on", "grill-me:off"]],
      [KNOWLEDGE, 1, ["wiki-query:on"]],
      ["/old/skills", 1, ["lost:on"]],
      ["Projects/kit/skills", 0, ["kit-release:off"]],
      ["Own", 2, ["own-clash:on", "pm-notes:on"]],
    ]);
  });

  it("an entry switched back on reads as on once and only once", () => {
    const c = catalog(PM);
    const mine = agentSkills(c, "claude-pm");
    if (mine === null) throw new Error("no claude-pm");
    const grill = PM[1];
    if (grill === undefined) throw new Error("no grill-me");
    const rows = skillGroups(c, mine, [grill]).flatMap((g) => g.rows).filter((r) => r.entry.name === "grill-me");
    expect(rows.map((r) => r.on)).toEqual([true]);
  });

  it("is empty for an empty skills/, and an agent the catalog does not read has none", () => {
    const c = catalog([]);
    const mine = agentSkills(c, "claude-pm");
    if (mine === null) throw new Error("no claude-pm");
    expect(skillGroups(c, mine, [])).toEqual([]);
    expect(agentSkills(c, "codex")).toBeNull();
  });
});

describe("alsoText", () => {
  it.each<[string[], string]>([
    [[], "only here"],
    [["claude"], "also in claude"],
    [["a", "b"], "also in a, b"],
    [["a", "b", "c", "d"], "also in a, b +2"],
  ])("%j → %s", (also, text) => {
    expect(alsoText(also)).toBe(text);
  });
});

describe("addableSkills", () => {
  const c = catalog(PM);
  const mine = agentSkills(c, "claude-pm");
  if (mine === null) throw new Error("no claude-pm");
  const offered = (query: string): [string, string[]][] => addableSkills(c, mine, query).map((g) => [g.folder, g.skills.map((s) => `${s.name}${s.blocked === null ? "" : "!"}`)]);

  it("offers the listed folders' skills the agent has no link to, by folder; a name already in skills/ is blocked", () => {
    expect(offered("")).toEqual([
      [SHARED, ["second-opinion"]],
      [KNOWLEDGE, ["inbox-triage", "own-clash!"]],
    ]);
    expect(addableSkills(c, mine, "").flatMap((g) => g.skills).find((s) => s.name === "own-clash")?.blocked).toBe("skills/own-clash is already there");
  });

  it("searches the name, the folder name and the description, in any case", () => {
    expect(offered("OPINION")).toEqual([[SHARED, ["second-opinion"]]]);
    expect(offered("another model")).toEqual([[SHARED, ["second-opinion"]]]);
    expect(offered("inbox triage")).toEqual([[KNOWLEDGE, ["inbox-triage"]]]);
    expect(offered("inbox-triage")).toEqual([[KNOWLEDGE, ["inbox-triage"]]]);
    expect(offered("  wiki  ")).toEqual([]);
    expect(offered("nothing like it")).toEqual([]);
  });
});
