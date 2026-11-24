import { lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { entryNameProblem, linkSkill, linkText, unlinkSkill } from "./skill-links.ts";

let root: string;
let ws: string;
let skills: string;
let shared: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "pa-skill-links-")));
  ws = join(root, "ws");
  skills = join(ws, "Agents", "claude-pm", "skills");
  shared = join(ws, "Agents", "_shared", "skills");
  await mkdir(skills, { recursive: true });
  await mkdir(join(shared, "grill-me"), { recursive: true });
  await writeFile(join(shared, "grill-me", "SKILL.md"), "---\nname: grill-me\n---\n");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const isLink = async (path: string): Promise<boolean> => (await lstat(path)).isSymbolicLink();

describe("entryNameProblem", () => {
  it.each([
    ["grill-me", null],
    ["a skill with spaces", null],
    ["", "The name is empty."],
    ["   ", "The name is empty."],
    ["..", "The name must not start with a dot."],
    [".", "The name must not start with a dot."],
    [".hidden", "The name must not start with a dot."],
    ["../escape", "The name must be one folder name, without slashes."],
    ["a/b", "The name must be one folder name, without slashes."],
    ["a\\b", "The name must be one folder name, without slashes."],
    ["a\0b", "The name must be one folder name, without slashes."],
    ["x".repeat(256), "The name is longer than 255 characters."],
  ])("%j → %j", (name, problem) => {
    expect(entryNameProblem(name)).toBe(problem);
  });
});

describe("linkText", () => {
  it("is relative to skills/ when both lie in the workspace, as the template's links are", () => {
    expect(linkText(join(ws, "Agents/claude-pm/skills"), join(ws, "Agents/_shared/skills/grill-me"), ws)).toBe("../../_shared/skills/grill-me");
    expect(linkText(join(ws, "Agents/claude-pm/skills"), join(ws, "Knowledge/_skills/wiki/wiki-query"), ws)).toBe("../../../Knowledge/_skills/wiki/wiki-query");
  });

  it("is absolute when skills/ or the target lies outside the workspace, or there is none", () => {
    expect(linkText("/home/me/.claude/skills", join(ws, "Agents/_shared/skills/grill-me"), ws)).toBe(join(ws, "Agents/_shared/skills/grill-me"));
    expect(linkText(join(ws, "Agents/claude-pm/skills"), "/elsewhere/skill", ws)).toBe("/elsewhere/skill");
    expect(linkText(join(ws, "Agents/claude-pm/skills"), join(ws, "x"), null)).toBe(join(ws, "x"));
    expect(linkText(`${ws}-other/skills`, join(ws, "x"), ws)).toBe(join(ws, "x"));
  });
});

describe("linkSkill", () => {
  it("makes the link in skills/, relative inside the workspace, pointing at the skill", async () => {
    expect(await linkSkill(skills, "grill-me", join(shared, "grill-me"), ws)).toEqual({ ok: true, target: join(shared, "grill-me") });
    expect(await readlink(join(skills, "grill-me"))).toBe("../../_shared/skills/grill-me");
    expect(await realpath(join(skills, "grill-me"))).toBe(join(shared, "grill-me"));
  });

  it("makes an absolute link from a skills/ outside the workspace, and makes skills/ when it is missing", async () => {
    const home = join(root, "home", ".claude");
    await mkdir(home, { recursive: true });
    expect(await linkSkill(join(home, "skills"), "grill-me", join(shared, "grill-me"), ws)).toEqual({ ok: true, target: join(shared, "grill-me") });
    expect(await readlink(join(home, "skills", "grill-me"))).toBe(join(shared, "grill-me"));
  });

  it("never replaces an entry: a link or an own folder of that name stays as it was", async () => {
    await symlink("../../_shared/skills/other", join(skills, "taken"));
    await mkdir(join(skills, "own"));
    await writeFile(join(skills, "own", "SKILL.md"), "mine\n");
    expect(await linkSkill(skills, "taken", join(shared, "grill-me"), ws)).toEqual({ ok: false, reason: "skills/taken already exists." });
    expect(await readlink(join(skills, "taken"))).toBe("../../_shared/skills/other");
    expect(await linkSkill(skills, "own", join(shared, "grill-me"), ws)).toEqual({ ok: false, reason: "skills/own already exists." });
    expect(await readFile(join(skills, "own", "SKILL.md"), "utf8")).toBe("mine\n");
  });

  it("refuses a name that leaves skills/, and a relative target", async () => {
    expect(await linkSkill(skills, "../escaped", join(shared, "grill-me"), ws)).toEqual({ ok: false, reason: "The name must be one folder name, without slashes." });
    expect(await linkSkill(skills, "..", join(shared, "grill-me"), ws)).toMatchObject({ ok: false });
    expect(await linkSkill(skills, "grill-me", "Agents/_shared/skills/grill-me", ws)).toEqual({ ok: false, reason: "The target must be an absolute path." });
    await expect(lstat(join(skills, "..", "escaped"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses a skills/ that is a symlink — writing through it would land elsewhere — or a file", async () => {
    const elsewhere = join(root, "elsewhere");
    await mkdir(elsewhere);
    const agent = join(ws, "Agents", "claude-coder");
    await mkdir(agent);
    await symlink(elsewhere, join(agent, "skills"));
    expect(await linkSkill(join(agent, "skills"), "grill-me", join(shared, "grill-me"), ws)).toMatchObject({ ok: false, reason: expect.stringContaining("is a symlink") as unknown });
    await expect(lstat(join(elsewhere, "grill-me"))).rejects.toMatchObject({ code: "ENOENT" });
    await writeFile(join(ws, "Agents", "file-skills"), "");
    expect(await linkSkill(join(ws, "Agents", "file-skills"), "grill-me", join(shared, "grill-me"), ws)).toMatchObject({ ok: false, reason: expect.stringContaining("is not a folder") as unknown });
  });

  it("does not make the agent's folder: a skills/ whose parent is gone is refused", async () => {
    expect(await linkSkill(join(ws, "Agents", "gone", "skills"), "grill-me", join(shared, "grill-me"), ws)).toMatchObject({ ok: false, reason: expect.stringContaining("does not exist") as unknown });
    await expect(lstat(join(ws, "Agents", "gone"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("unlinkSkill", () => {
  it("takes the link away and leaves its target as it was; answers the target, absolute", async () => {
    await symlink("../../_shared/skills/grill-me", join(skills, "grill-me"));
    expect(await unlinkSkill(skills, "grill-me")).toEqual({ ok: true, target: join(shared, "grill-me") });
    await expect(lstat(join(skills, "grill-me"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(shared, "grill-me", "SKILL.md"), "utf8")).toContain("grill-me");
  });

  it("takes a broken link away", async () => {
    await symlink("/nowhere/at/all", join(skills, "broken"));
    expect(await unlinkSkill(skills, "broken")).toEqual({ ok: true, target: "/nowhere/at/all" });
    await expect(lstat(join(skills, "broken"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("never removes an own skill (a real folder) or a file", async () => {
    await mkdir(join(skills, "own"));
    await writeFile(join(skills, "own", "SKILL.md"), "mine\n");
    await writeFile(join(skills, "notes.txt"), "x\n");
    expect(await unlinkSkill(skills, "own")).toEqual({ ok: false, reason: "skills/own is the agent's own skill, not a link: the app never removes it." });
    expect(await unlinkSkill(skills, "notes.txt")).toEqual({ ok: false, reason: "skills/notes.txt is not a link." });
    expect(await readFile(join(skills, "own", "SKILL.md"), "utf8")).toBe("mine\n");
    expect(await readFile(join(skills, "notes.txt"), "utf8")).toBe("x\n");
  });

  it("refuses a name that leaves skills/ — a link one level up stays", async () => {
    await symlink("_shared/skills/grill-me", join(ws, "Agents", "claude-pm", "up"));
    expect(await unlinkSkill(skills, "../up")).toEqual({ ok: false, reason: "The name must be one folder name, without slashes." });
    expect(await unlinkSkill(skills, "..")).toMatchObject({ ok: false });
    expect(await isLink(join(ws, "Agents", "claude-pm", "up"))).toBe(true);
  });

  it("refuses through a skills/ that is a symlink, and says when the entry is not there", async () => {
    const elsewhere = join(root, "elsewhere");
    await mkdir(elsewhere);
    await symlink(join(shared, "grill-me"), join(elsewhere, "grill-me"));
    const agent = join(ws, "Agents", "claude-coder");
    await mkdir(agent);
    await symlink(elsewhere, join(agent, "skills"));
    expect(await unlinkSkill(join(agent, "skills"), "grill-me")).toMatchObject({ ok: false, reason: expect.stringContaining("is a symlink") as unknown });
    expect(await isLink(join(elsewhere, "grill-me"))).toBe(true);
    expect(await unlinkSkill(skills, "missing")).toEqual({ ok: false, reason: "skills/missing is not there." });
  });
});
