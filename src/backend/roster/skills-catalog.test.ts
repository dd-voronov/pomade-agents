import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openRecordStore, SETTINGS_FILE, type RecordStore } from "../records/record-store.ts";
import { startSkillFolderSettings } from "../settings/settings.ts";
import { readCatalog, startSkillsCatalog } from "./skills-catalog.ts";
import type { Roster } from "./roster.ts";

const SOON = { timeout: 2000, interval: 20 };

let ws: string;
let home: string;

async function skill(path: string, frontmatter: string | null = null): Promise<void> {
  await mkdir(join(ws, path), { recursive: true });
  await writeFile(join(ws, path, "SKILL.md"), frontmatter === null ? "# no frontmatter\n" : `---\n${frontmatter}\n---\n\nBody.\n`);
}

beforeEach(async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pa-skills-")));
  ws = join(root, "ws");
  home = join(root, "home");
  await mkdir(ws);
  await mkdir(home);
});

afterEach(async () => {
  await rm(join(ws, ".."), { recursive: true, force: true });
});

describe("readCatalog", () => {
  it("finds skills at any depth, names them from their frontmatter, and leaves a skill's own subfolders alone", async () => {
    await skill("Agents/_shared/skills/grill-me", "name: grill-me\ndescription: Interview the user.");
    await skill("Knowledge/_skills/wiki/wiki-query", "name: wiki-query\ndescription: Answer from the wiki.");
    await skill("Knowledge/_skills/wiki/wiki-query/references/inner", "name: inner");
    await skill("Knowledge/_skills/plain");
    await skill("Knowledge/_skills/.hidden/x");
    await skill("Knowledge/_skills/node_modules/y");
    await mkdir(join(ws, "Knowledge/_skills/empty"), { recursive: true });

    const read = await readCatalog(ws, [ws], ["Agents/_shared/skills", "Knowledge/_skills", "Projects/gone"], []);
    expect(read.folders).toEqual([
      { path: "Agents/_shared/skills", state: "ok", skills: 1, nested: false, links: 0, agents: [] },
      { path: "Knowledge/_skills", state: "ok", skills: 2, nested: true, links: 0, agents: [] },
      { path: "Projects/gone", state: "missing", skills: 0, nested: false, links: 0, agents: [] },
    ]);
    expect(read.skills).toEqual([
      { name: "grill-me", folder: "Agents/_shared/skills", path: "Agents/_shared/skills/grill-me", description: "Interview the user.", agents: [] },
      { name: "plain", folder: "Knowledge/_skills", path: "Knowledge/_skills/plain", description: null, agents: [] },
      { name: "wiki-query", folder: "Knowledge/_skills", path: "Knowledge/_skills/wiki/wiki-query", description: "Answer from the wiki.", agents: [] },
    ]);
  });

  it("reads each agent's skills/: links into listed folders, links elsewhere, broken links and own skills", async () => {
    await skill("Agents/_shared/skills/grill-me", "name: grill-me");
    await skill("Knowledge/_skills/wiki/wiki-query", "name: wiki-query");
    await skill("Projects/kit/skills/kit-release", "name: kit-release");
    const libra = join(ws, "Agents/claude-libra/skills");
    await mkdir(libra, { recursive: true });
    await symlink("../../_shared/skills/grill-me", join(libra, "grill-me"));
    await symlink(join(ws, "Knowledge/_skills/wiki/wiki-query"), join(libra, "wiki-query"));
    await symlink("../../../Projects/kit/skills/kit-release", join(libra, "kit-release"));
    await symlink("../../_shared/skills/gone", join(libra, "gone"));
    await skill("Agents/claude-libra/skills/vault-audit", "name: vault-audit");
    await writeFile(join(libra, "notes.txt"), "a file is no skill\n");
    const claude = join(home, ".claude/skills");
    await mkdir(claude, { recursive: true });
    await symlink(join(ws, "Agents/_shared/skills/grill-me"), join(claude, "grill-me"));

    const read = await readCatalog(ws, [ws], ["Agents/_shared/skills", "Knowledge/_skills"], [
      { id: "claude", skillsDir: claude },
      { id: "claude-libra", skillsDir: libra },
      { id: "claude-pm", skillsDir: join(ws, "Agents/claude-pm/skills") },
    ]);
    expect(read.folders.map((f) => [f.path, f.links, f.agents])).toEqual([
      ["Agents/_shared/skills", 3, ["claude", "claude-libra"]],
      ["Knowledge/_skills", 1, ["claude-libra"]],
    ]);
    expect(read.skills.map((s) => [s.name, s.agents])).toEqual([
      ["grill-me", ["claude", "claude-libra"]],
      ["wiki-query", ["claude-libra"]],
    ]);
    expect(read.agents.map((a) => a.agent)).toEqual(["claude", "claude-libra", "claude-pm"]);
    expect(read.agents[2]?.entries).toEqual([]);
    expect(read.agents[1]?.entries).toEqual([
      { name: "gone", kind: "link", target: join(ws, "Agents/_shared/skills/gone"), targetPath: null, broken: true, folder: "Agents/_shared/skills", listed: true, targetFolder: "Agents/_shared/skills" },
      { name: "grill-me", kind: "link", target: join(ws, "Agents/_shared/skills/grill-me"), targetPath: "Agents/_shared/skills/grill-me", broken: false, folder: "Agents/_shared/skills", listed: true, targetFolder: "Agents/_shared/skills" },
      { name: "kit-release", kind: "link", target: join(ws, "Projects/kit/skills/kit-release"), targetPath: "Projects/kit/skills/kit-release", broken: false, folder: null, listed: false, targetFolder: "Projects/kit/skills" },
      { name: "vault-audit", kind: "own", target: null, targetPath: null, broken: false, folder: null, listed: false, targetFolder: null },
      { name: "wiki-query", kind: "link", target: join(ws, "Knowledge/_skills/wiki/wiki-query"), targetPath: "Knowledge/_skills/wiki/wiki-query", broken: false, folder: "Knowledge/_skills", listed: true, targetFolder: "Knowledge/_skills/wiki" },
    ]);
  });

  it("matches links by real path through a symlinked workspace, and follows a symlinked folder inside a listed one once", async () => {
    await skill("Knowledge/_skills/a/one", "name: one");
    await symlink(join(ws, "Knowledge/_skills/a"), join(ws, "Knowledge/_skills/again"));
    const link = join(ws, "..", "ws-link");
    await symlink(ws, link);
    const agent = join(ws, "Agents/x/skills");
    await mkdir(agent, { recursive: true });
    await symlink(join(link, "Knowledge/_skills/a/one"), join(agent, "one"));

    const read = await readCatalog(link, [link, ws], ["Knowledge/_skills"], [{ id: "x", skillsDir: agent }]);
    expect(read.skills).toEqual([{ name: "one", folder: "Knowledge/_skills", path: "Knowledge/_skills/a/one", description: null, agents: ["x"] }]);
    expect(read.folders[0]).toMatchObject({ skills: 1, links: 1, agents: ["x"] });
    expect(read.agents[0]?.entries[0]).toMatchObject({ targetPath: "Knowledge/_skills/a/one", folder: "Knowledge/_skills", listed: true });
  });
});

describe("the skills catalog with its settings", () => {
  let store: RecordStore | null = null;
  afterEach(async () => {
    await store?.stop();
    store = null;
  });

  const roster: Pick<Roster, "answer" | "agent"> = {
    answer: () => ({ epoch: "r", revision: 0, profilesOff: null, agents: [{ id: "claude-libra", name: "claude-libra", profile: null, problem: null, orphan: false, configDir: null, model: null, effort: null }] }),
    agent: () => ({ orphan: false, profile: { id: "claude-libra", provider: "claude", kind: "folder", configDir: "Agents/claude-libra", command: "claude-libra", tags: [], hidden: false, modes: {} } }),
  };

  const start = async () => {
    const dataDir = join(ws, "Apps/pomade-agents");
    store = await openRecordStore({ dataDir, now: () => new Date(), log: () => undefined });
    const settings = startSkillFolderSettings({ store, off: "off", workspace: ws, workspaceReal: ws, settingsPath: join(dataDir, SETTINGS_FILE) });
    const catalog = startSkillsCatalog({ workspace: ws, workspaceReal: ws, home, settings, roster });
    const heard: number[] = [];
    catalog.onChange((c) => heard.push(c.revision));
    return { catalog, heard, file: join(dataDir, SETTINGS_FILE) };
  };

  it("adds a folder: its skills join the catalog, the file keeps its other keys, and a change is heard", async () => {
    await skill("Agents/_shared/skills/grill-me", "name: grill-me");
    await skill("Projects/kit/skills/kit-release", "name: kit-release");
    await mkdir(join(ws, "Apps/pomade-agents"), { recursive: true });
    await writeFile(join(ws, "Apps/pomade-agents/settings.yaml"), "# mine\nother: 1\n");
    const { catalog, heard, file } = await start();
    expect((await catalog.read()).folders.map((f) => f.path)).toEqual(["Agents/_shared/skills", "Knowledge/_skills"]);

    const added = await catalog.setFolders(["Agents/_shared/skills", "Knowledge/_skills", "Projects/kit/skills"]);
    expect(added.ok && added.catalog.skills.map((s) => s.name)).toEqual(["grill-me", "kit-release"]);
    expect(await readFile(file, "utf8")).toBe("# mine\nother: 1\nskillFolders:\n  - Agents/_shared/skills\n  - Knowledge/_skills\n  - Projects/kit/skills\n");
    await expect.poll(() => heard.length, SOON).toBeGreaterThan(0);
  });

  it("refuses a missing folder, one outside the workspace, and any change over an unusable file", async () => {
    const { catalog, file } = await start();
    expect(await catalog.setFolders(["Projects/none"])).toEqual({ ok: false, folder: "Projects/none", reason: "There is no such folder in the workspace." });
    expect(await catalog.setFolders(["/elsewhere"])).toMatchObject({ ok: false, folder: "/elsewhere" });
    await mkdir(join(ws, "out"), { recursive: true });
    await symlink(tmpdir(), join(ws, "out", "tmp"));
    expect(await catalog.setFolders(["out/tmp"])).toEqual({ ok: false, folder: "out/tmp", reason: "It leads outside the workspace (a symlink): the catalog reads folders inside it." });

    // The data folder's watch is up once it reports a hand edit (FSEvents may miss what changes as it starts).
    await expect
      .poll(async () => {
        await writeFile(file, "skillFolders: []\n");
        return (await catalog.read()).folders.length;
      }, SOON)
      .toBe(0);
    await writeFile(file, "skillFolders: [\n");
    await expect.poll(async () => (await catalog.read()).foldersOff ?? "", SOON).toContain("cannot be used");
    expect((await catalog.read()).folders.map((f) => f.path)).toEqual(["Agents/_shared/skills", "Knowledge/_skills"]);
    await expect(catalog.setFolders([])).rejects.toMatchObject({ code: "not-ready" });
    expect(await readFile(file, "utf8")).toBe("skillFolders: [\n");
  });
});
