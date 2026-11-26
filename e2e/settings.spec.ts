// The app's Settings page and the skills catalog (ARCHITECTURE §3.4, §3.8): the gear at the right of the
// Sessions | Roster bar opens route `settings`; the skill folders show their skills and the links
// that point into them; Add folder… takes the folder Pomade's picker answers and its skills join the
// catalog an agent's Add skill reads; Remove warns naming the agents when links depend on the
// folder, takes its skills out of the catalog and leaves the links in place, marked; both offer
// Undo; `settings.yaml` keeps its other keys; a hand edit is followed; an unusable file is never
// written over.

import { lstat, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { FrameLocator, Page } from "@playwright/test";

import type { Sandbox } from "../harness/sandbox.ts";
import { SETTINGS_SET_SKILL_FOLDERS_METHOD, SKILLS_CATALOG_METHOD, isSkillsCatalog, type SkillsCatalog } from "../src/shared/skills.ts";
import type { FakePomade } from "../harness/fake-pomade.ts";
import { expect, test, type Shell } from "./fixtures.ts";

const LIBRA = "claude-libra";
const KIT = "Projects/kit/skills";
const SETTINGS = (sandbox: Sandbox): string => join(sandbox.workspace, "Apps", "pomade-agents", "settings.yaml");

async function skill(sandbox: Sandbox, path: string, name: string): Promise<void> {
  await mkdir(join(sandbox.workspace, path), { recursive: true });
  await writeFile(join(sandbox.workspace, path, "SKILL.md"), `---\nname: ${name}\ndescription: The ${name} skill.\n---\n\nBody.\n`);
}

async function link(at: string, target: string): Promise<void> {
  await mkdir(dirname(at), { recursive: true });
  await symlink(target, at);
}

async function catalog(pomade: FakePomade): Promise<SkillsCatalog> {
  const answer = await pomade.fake.callApi(SKILLS_CATALOG_METHOD);
  if (!isSkillsCatalog(answer)) throw new Error(`not a skills.catalog answer: ${JSON.stringify(answer)}`);
  return answer;
}

/** The agents' links are in place once the roster knows `claude-libra`. */
async function ready(pomade: FakePomade, output: string): Promise<void> {
  await expect
    .poll(async () => (await catalog(pomade).catch(() => null))?.agents.map((a) => a.agent) ?? [], { message: output })
    .toEqual(["claude", LIBRA]);
}

async function openSettings(page: Page, openShell: (page: Page) => Promise<Shell>): Promise<FrameLocator> {
  const { panel, tabFrame } = await openShell(page);
  await panel.getByTestId("open-roster").click();
  const tab = tabFrame("alpha");
  await tab.getByTestId("view-settings").click();
  await expect(tab.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  return tab;
}

const row = (tab: FrameLocator, path: string) => tab.locator(`[data-testid="skill-folder"][data-path="${path}"]`);

test.use({
  seed: {
    async into(sandbox) {
      await skill(sandbox, "Agents/_shared/skills/grill-me", "grill-me");
      await skill(sandbox, "Agents/_shared/skills/second-opinion", "second-opinion");
      await skill(sandbox, "Knowledge/_skills/wiki/wiki-query", "wiki-query");
      await skill(sandbox, "Knowledge/_skills/librarian/inbox-triage", "inbox-triage");
      await skill(sandbox, `${KIT}/kit-release`, "kit-release");
      await link(join(sandbox.workspace, "Agents", LIBRA, "skills", "grill-me"), "../../_shared/skills/grill-me");
      await link(join(sandbox.workspace, "Agents", LIBRA, "skills", "wiki-query"), "../../../Knowledge/_skills/wiki/wiki-query");
      await link(join(sandbox.home, ".claude", "skills", "wiki-query"), join(sandbox.workspace, "Knowledge/_skills/wiki/wiki-query"));
      await mkdir(dirname(SETTINGS(sandbox)), { recursive: true });
      await writeFile(SETTINGS(sandbox), "# my settings\nother: kept # by hand\n");
    },
  },
  // The picker answers from Pomade's view of the workspace.
  pomadeSeed: { files: { [`${KIT}/kit-release/SKILL.md`]: "---\nname: kit-release\n---\n" } },
});

test("the gear opens Settings: each skill folder with its skills and the links into it; Sessions and Roster are not selected", async ({ page, openShell, pomade, backend }) => {
  await ready(pomade, backend.output());
  const tab = await openSettings(page, openShell);
  await expect.poll(() => pomade.fake.appTabs.find((t) => t.projectId === "alpha")?.route).toBe("settings");
  await expect(tab.getByTestId("view-settings")).toHaveAttribute("aria-current", "page");
  await expect(tab.getByTestId("view-sessions")).not.toHaveAttribute("aria-current");
  await expect(tab.getByTestId("view-roster")).not.toHaveAttribute("aria-current");

  await expect(tab.getByTestId("skill-folder")).toHaveCount(2);
  await expect(row(tab, "Agents/_shared/skills").getByTestId("folder-skills")).toHaveText("2 skills");
  await expect(row(tab, "Agents/_shared/skills").getByTestId("folder-links")).toHaveText("1 link from 1 agent");
  await expect(row(tab, "Knowledge/_skills")).toContainText("and its subfolders");
  await expect(row(tab, "Knowledge/_skills").getByTestId("folder-links")).toHaveText("2 links from 2 agents");
  await expect(row(tab, "Knowledge/_skills").getByTestId("folder-links")).toHaveAttribute("title", `claude, ${LIBRA}`);

  await tab.getByTestId("view-roster").click();
  await expect(tab.getByTestId("view-roster")).toHaveAttribute("aria-current", "page");
  await expect(tab.getByTestId("view-settings")).not.toHaveAttribute("aria-current");
});

test("Add folder… lists the folder Pomade's picker answers: its skills join the catalog Add skill reads, settings.yaml keeps its other keys; Undo takes it back", async ({ page, openShell, pomade, sandbox, backend }) => {
  await ready(pomade, backend.output());
  expect((await catalog(pomade)).skills.map((s) => s.name)).not.toContain("kit-release");
  const tab = await openSettings(page, openShell);

  pomade.fake.answerPick(KIT);
  await tab.getByTestId("add-folder").click();
  await expect(row(tab, KIT).getByTestId("folder-skills")).toHaveText("1 skill");
  await expect(tab.getByTestId("toast-text")).toHaveText(`Added ${KIT}: Add skill now offers its 1 skill.`);
  expect(pomade.fake.pickRequests).toEqual([{ kind: "folder", root: "", initial: "" }]);
  const after = await catalog(pomade);
  expect(after.skills.find((s) => s.name === "kit-release")).toEqual({ name: "kit-release", folder: KIT, path: `${KIT}/kit-release`, description: "The kit-release skill.", agents: [] });
  const text = await readFile(SETTINGS(sandbox), "utf8");
  expect(text).toContain("# my settings\nother: kept # by hand\n");
  expect(text).toContain("skillFolders:\n  - Agents/_shared/skills\n  - Knowledge/_skills\n  - Projects/kit/skills\n");

  await tab.getByTestId("toast-undo").click();
  await expect(row(tab, KIT)).toHaveCount(0);
  await expect.poll(async () => (await catalog(pomade)).skills.map((s) => s.name)).not.toContain("kit-release");
  await expect.poll(() => readFile(SETTINGS(sandbox), "utf8")).toContain("skillFolders:\n  - Agents/_shared/skills\n  - Knowledge/_skills\n");
  expect(await readFile(SETTINGS(sandbox), "utf8")).not.toContain(KIT);
});

test("Remove warns naming the agents whose links depend on the folder; its skills leave the catalog and the links stay, marked; Undo brings it back", async ({ page, openShell, pomade, sandbox, backend }) => {
  await ready(pomade, backend.output());
  const tab = await openSettings(page, openShell);
  const knowledge = row(tab, "Knowledge/_skills");

  await knowledge.getByTestId("remove-folder").click();
  const warning = knowledge.getByTestId("remove-warning");
  await expect(warning).toContainText(`2 skill links in 2 agents depend on this folder (claude, ${LIBRA}).`);
  await warning.getByTestId("cancel-remove").click();
  await expect(warning).toHaveCount(0);
  await expect(knowledge).toBeVisible();

  await knowledge.getByTestId("remove-folder").click();
  await knowledge.getByTestId("confirm-remove").click();
  await expect(knowledge).toHaveCount(0);
  await expect(tab.getByTestId("toast-text")).toHaveText("Removed Knowledge/_skills from Skill folders.");

  const removed = await catalog(pomade);
  expect(removed.folders.map((f) => f.path)).toEqual(["Agents/_shared/skills"]);
  expect(removed.skills.map((s) => s.name)).toEqual(["grill-me", "second-opinion"]);
  expect(removed.agents.find((a) => a.agent === LIBRA)?.entries.find((e) => e.name === "wiki-query")).toEqual({
    name: "wiki-query",
    kind: "link",
    target: join(sandbox.workspace, "Knowledge/_skills/wiki/wiki-query"),
    targetPath: "Knowledge/_skills/wiki/wiki-query",
    broken: false,
    folder: null,
    listed: false,
    targetFolder: "Knowledge/_skills/wiki",
    description: "The wiki-query skill.",
  });
  expect((await lstat(join(sandbox.workspace, "Agents", LIBRA, "skills", "wiki-query"))).isSymbolicLink()).toBe(true);
  expect((await lstat(join(sandbox.home, ".claude", "skills", "wiki-query"))).isSymbolicLink()).toBe(true);

  await tab.getByTestId("toast-undo").click();
  await expect(knowledge.getByTestId("folder-links")).toHaveText("2 links from 2 agents");
  expect((await catalog(pomade)).folders.map((f) => f.path)).toEqual(["Agents/_shared/skills", "Knowledge/_skills"]);
});

test("a hand edit of settings.yaml is followed — a folder not found is marked and removed at once; a folder outside the workspace is refused; an unusable file is never written over", async ({ page, openShell, pomade, sandbox, backend }) => {
  await ready(pomade, backend.output());
  const tab = await openSettings(page, openShell);
  await expect(tab.getByTestId("skill-folder")).toHaveCount(2);

  await writeFile(SETTINGS(sandbox), "# my settings\nskillFolders: [Agents/_shared/skills, Projects/gone]\n");
  await expect(row(tab, "Projects/gone").getByTestId("folder-skills")).toHaveText("Not found");
  await expect(tab.getByTestId("skill-folder")).toHaveCount(2);
  await row(tab, "Projects/gone").getByTestId("remove-folder").click();
  await expect(row(tab, "Projects/gone")).toHaveCount(0);
  await expect(tab.getByTestId("remove-warning")).toHaveCount(0);
  await expect.poll(() => readFile(SETTINGS(sandbox), "utf8")).not.toContain("Projects/gone");
  expect(await readFile(SETTINGS(sandbox), "utf8")).toMatch(/^# my settings\nskillFolders:.*Agents\/_shared\/skills/s);

  expect(await pomade.fake.callApi(SETTINGS_SET_SKILL_FOLDERS_METHOD, { folders: ["Agents/_shared/skills", "../elsewhere"] })).toEqual({
    ok: false,
    folder: "../elsewhere",
    reason: "It is outside the workspace: the catalog reads folders inside it.",
  });

  await writeFile(SETTINGS(sandbox), "skillFolders: [\n");
  await expect(tab.getByTestId("folders-off")).toContainText("cannot be used");
  await expect(tab.getByTestId("add-folder")).toBeDisabled();
  await expect(tab.getByTestId("remove-folder").first()).toBeDisabled();
  await expect(pomade.fake.callApi(SETTINGS_SET_SKILL_FOLDERS_METHOD, { folders: [] })).rejects.toMatchObject({ code: "not-ready" });
  expect(await readFile(SETTINGS(sandbox), "utf8")).toBe("skillFolders: [\n");
});
