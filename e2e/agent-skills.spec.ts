// An agent's Skills tab through the built app and backend in the fake Pomade (ARCHITECTURE §3.4): the
// agent's `skills/` entries grouped by skill folder — the listed folders in the Settings order, a
// folder no longer listed (marked), then its own — with "also in"; a switch takes a link away and
// makes it again, with Undo, and the row stays in place; a broken link is shown and can be taken
// away; an own skill has no switch; **Add skill** links a skill of the catalog, searchable, and
// the link points at the shared skill — relative from a folder agent, absolute from `~/.claude`;
// Codex has no skills. Every assertion of a write reads the sandbox's file system.

import { mkdirSync } from "node:fs";
import { lstat, mkdir, readFile, readlink, realpath, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { FrameLocator, Page } from "@playwright/test";

import type { FakePomade } from "../harness/fake-pomade.ts";
import type { Sandbox } from "../harness/sandbox.ts";
import { SKILLS_CATALOG_METHOD, isSkillsCatalog } from "../src/shared/skills.ts";
import { agentRoute } from "../src/ui/core/routes.ts";
import { agentName } from "../src/backend/roster/first-sight.ts";
import { expect, test, type Shell } from "./fixtures.ts";

const ARTIFACTS = fileURLToPath(new URL("./artifacts", import.meta.url));
mkdirSync(ARTIFACTS, { recursive: true });

const LIBRA = "claude-libra";
const SHARED = "Agents/_shared/skills";
const LIBRA_SKILLS = (sandbox: Sandbox): string => join(sandbox.workspace, "Agents", LIBRA, "skills");
const CLAUDE_SKILLS = (sandbox: Sandbox): string => join(sandbox.home, ".claude", "skills");

async function skill(sandbox: Sandbox, path: string, name: string, description: string): Promise<void> {
  await mkdir(join(sandbox.workspace, path), { recursive: true });
  await writeFile(join(sandbox.workspace, path, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\nBody.\n`);
}

async function link(at: string, target: string): Promise<void> {
  await mkdir(dirname(at), { recursive: true });
  await symlink(target, at);
}

/** The shared and Knowledge skills; `claude-libra` links two of them, one into a folder Settings
 *  does not list, one broken, and has an own skill; the built-in `claude` links `grill-me`. */
async function seedSkills(sandbox: Sandbox): Promise<void> {
  await skill(sandbox, `${SHARED}/grill-me`, "grill-me", "Interview the user relentlessly about a plan.");
  await skill(sandbox, `${SHARED}/second-opinion`, "second-opinion", "Ask another model for a second opinion.");
  await skill(sandbox, "Knowledge/_skills/wiki/wiki-query", "wiki-query", "Answer a question from the wiki.");
  await skill(sandbox, "Knowledge/_skills/librarian/inbox-triage", "inbox-triage", "Sort the inbox into the vault.");
  await skill(sandbox, "Projects/kit/skills/kit-release", "kit-release", "Release the kit.");
  await skill(sandbox, `Agents/${LIBRA}/skills/vault-audit`, "vault-audit", "Audit the vault's links.");
  await link(join(LIBRA_SKILLS(sandbox), "grill-me"), "../../_shared/skills/grill-me");
  await link(join(LIBRA_SKILLS(sandbox), "wiki-query"), "../../../Knowledge/_skills/wiki/wiki-query");
  await link(join(LIBRA_SKILLS(sandbox), "kit-release"), "../../../Projects/kit/skills/kit-release");
  await link(join(LIBRA_SKILLS(sandbox), "gone"), "../../_shared/skills/gone");
  await link(join(CLAUDE_SKILLS(sandbox), "grill-me"), join(sandbox.workspace, SHARED, "grill-me"));
}

test.use({ seed: { into: seedSkills }, viewport: { width: 1280, height: 800 } });

/** The catalog reads the agents' links once the roster knows `claude-libra`. */
async function ready(pomade: FakePomade, output: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const answer = await pomade.fake.callApi(SKILLS_CATALOG_METHOD).catch(() => null);
        return isSkillsCatalog(answer) ? answer.agents.map((a) => a.agent) : [];
      },
      { message: output },
    )
    .toEqual(["claude", LIBRA]);
}

async function openSkills(page: Page, openShell: (page: Page) => Promise<Shell>, pomade: FakePomade, agent: string): Promise<FrameLocator> {
  const { tabFrame } = await openShell(page);
  pomade.fake.openAppTab({ projectId: "alpha", route: agentRoute(agent, "skills") });
  const frame = tabFrame("alpha");
  await expect(frame.getByTestId("agent-name")).toHaveText(agentName(agent));
  return frame;
}

const row = (frame: FrameLocator, name: string) => frame.locator(`[data-testid="skill-row"][data-name="${name}"]`);
const group = (frame: FrameLocator, label: string) => frame.locator(`[data-testid="skill-group"][data-label="${label}"]`);
const gone = async (path: string): Promise<boolean> => lstat(path).then(
  () => false,
  (err: NodeJS.ErrnoException) => err.code === "ENOENT",
);

test.beforeEach(({ backend }) => {
  expect(backend.running()).toBe(true);
});

test("the tab groups the links by skill folder in the Settings order, then a folder not listed (marked), then own; also in; a broken link shows", async ({ page, openShell, pomade, backend }) => {
  await ready(pomade, backend.output());
  const frame = await openSkills(page, openShell, pomade, LIBRA);

  await expect(frame.getByTestId("skill-group")).toHaveCount(4);
  const groups = await frame.getByTestId("skill-group").evaluateAll((els) => els.map((el) => [el.getAttribute("data-label"), el.getAttribute("data-kind")]));
  expect(groups).toEqual([
    [SHARED, "folder"],
    ["Knowledge/_skills", "folder"],
    ["Projects/kit/skills", "unlisted"],
    ["Own", "own"],
  ]);
  const names = await frame.getByTestId("skill-row").evaluateAll((els) => els.map((el) => el.getAttribute("data-name")));
  expect(names).toEqual(["gone", "grill-me", "wiki-query", "kit-release", "vault-audit"]);

  await expect(group(frame, SHARED).getByTestId("skill-group-count")).toHaveText("2");
  await expect(group(frame, "Projects/kit/skills").getByTestId("skill-group-note")).toHaveText("not in Skill folders");
  await expect(group(frame, SHARED).getByTestId("skill-group-note")).toHaveCount(0);

  await expect(row(frame, "grill-me")).toContainText("Interview the user relentlessly about a plan.");
  await expect(row(frame, "grill-me").getByTestId("skill-also")).toHaveText("also in claude");
  await expect(row(frame, "wiki-query").getByTestId("skill-also")).toHaveText("only here");
  await expect(row(frame, "gone").getByTestId("skill-broken")).toHaveText(`Nothing at ${SHARED}/gone`);
  await expect(row(frame, "gone")).toContainText("broken link");

  // An own skill has no switch; the links each have one, on.
  await expect(row(frame, "vault-audit").getByTestId("skill-switch")).toHaveCount(0);
  await expect(row(frame, "vault-audit")).toContainText("own");
  await expect(row(frame, "grill-me").getByTestId("skill-switch")).toHaveAttribute("aria-checked", "true");

  await expect(frame.getByTestId("agent-skills")).toContainText(`Links in Agents/${LIBRA}/skills/ to skills in the Skill folders…`);
  await frame.getByTestId("skills-settings").click();
  await expect(frame.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
});

test("off takes the link away and leaves the skill; the row stays in place; Undo makes it again; on makes it again", async ({ page, openShell, pomade, sandbox, backend }) => {
  await ready(pomade, backend.output());
  const frame = await openSkills(page, openShell, pomade, LIBRA);
  const at = join(LIBRA_SKILLS(sandbox), "grill-me");
  const sw = row(frame, "grill-me").getByTestId("skill-switch");
  const before = await row(frame, "grill-me").boundingBox();

  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "false");
  expect(await gone(at)).toBe(true);
  expect(await readFile(join(sandbox.workspace, SHARED, "grill-me", "SKILL.md"), "utf8")).toContain("grill-me");
  await expect(frame.getByTestId("toast-text")).toHaveText(`Removed the link Agents/${LIBRA}/skills/grill-me`);
  await expect(row(frame, "grill-me")).toHaveAttribute("data-on", "false");
  expect(await row(frame, "grill-me").boundingBox()).toEqual(before);
  await expect(group(frame, SHARED).getByTestId("skill-group-count")).toHaveText("1");

  await frame.getByTestId("toast-undo").click();
  await expect(sw).toHaveAttribute("aria-checked", "true");
  expect(await readlink(at)).toBe("../../_shared/skills/grill-me");

  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "false");
  expect(await gone(at)).toBe(true);
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "true");
  expect(await readlink(at)).toBe("../../_shared/skills/grill-me");
  await expect(frame.getByTestId("toast-text")).toHaveText(`Linked Agents/${LIBRA}/skills/grill-me → ${SHARED}/grill-me`);
  expect(await row(frame, "grill-me").boundingBox()).toEqual(before);
});

test("a broken link is taken away by its switch; an own skill is never touched", async ({ page, openShell, pomade, sandbox, backend }) => {
  await ready(pomade, backend.output());
  const frame = await openSkills(page, openShell, pomade, LIBRA);
  await row(frame, "gone").getByTestId("skill-switch").click();
  await expect(row(frame, "gone")).toHaveAttribute("data-on", "false");
  expect(await gone(join(LIBRA_SKILLS(sandbox), "gone"))).toBe(true);
  expect((await lstat(join(LIBRA_SKILLS(sandbox), "vault-audit"))).isDirectory()).toBe(true);
});

test("Add skill offers the catalog's skills the agent has no link to, searchable, each with its agent count; picking one links it to the shared skill; Undo takes it away", async ({ page, openShell, pomade, sandbox, backend }) => {
  await ready(pomade, backend.output());
  const frame = await openSkills(page, openShell, pomade, LIBRA);
  await frame.getByTestId("add-skill").click();
  const menu = frame.getByTestId("add-skill-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByTestId("add-skill-menu-search")).toBeFocused();
  await expect(menu.getByTestId("add-skill-menu-head")).toHaveText([SHARED, "Knowledge/_skills"]);
  await expect(menu.getByTestId("menu-item-add-second-opinion")).toBeVisible();
  await expect(menu.getByTestId("menu-item-add-inbox-triage")).toBeVisible();
  await expect(menu.getByTestId("menu-item-add-grill-me")).toHaveCount(0);
  await expect(menu.getByTestId("menu-item-add-wiki-query")).toHaveCount(0);
  await expect(menu.getByTestId("menu-item-add-kit-release")).toHaveCount(0);
  await expect(menu.getByTestId("menu-item-skill-folders")).toContainText("2 in Settings");

  await menu.getByTestId("add-skill-menu-search").fill("vault");
  await expect(menu.getByTestId("menu-item-add-inbox-triage")).toBeVisible();
  await expect(menu.getByTestId("menu-item-add-second-opinion")).toHaveCount(0);
  await menu.getByTestId("add-skill-menu-search").fill("nothing like it");
  await expect(menu.getByTestId("add-skill-menu-note")).toHaveText("Nothing matches — or every skill is already linked.");
  await menu.getByTestId("add-skill-menu-search").fill("OPINION");
  await expect(menu.getByTestId("menu-item-add-second-opinion")).toContainText("Ask another model for a second opinion.");
  await page.screenshot({ path: `${ARTIFACTS}/agent-skills-add-search.png` });
  await menu.getByTestId("menu-item-add-second-opinion").click();
  await expect(menu).toHaveCount(0);

  const at = join(LIBRA_SKILLS(sandbox), "second-opinion");
  await expect(row(frame, "second-opinion").getByTestId("skill-switch")).toHaveAttribute("aria-checked", "true");
  expect(await readlink(at)).toBe("../../_shared/skills/second-opinion");
  expect(await realpath(at)).toBe(await realpath(join(sandbox.workspace, SHARED, "second-opinion")));
  await expect(frame.getByTestId("toast-text")).toHaveText(`Linked Agents/${LIBRA}/skills/second-opinion → ${SHARED}/second-opinion`);
  await page.screenshot({ path: `${ARTIFACTS}/agent-skills-undo-toast.png` });

  await frame.getByTestId("toast-undo").click();
  await expect(row(frame, "second-opinion")).toHaveAttribute("data-on", "false");
  expect(await gone(at)).toBe(true);

  // Taken away again, it is offered again — with no agent count, as no agent links it.
  await frame.getByTestId("add-skill").click();
  await expect(menu.getByTestId("menu-item-add-second-opinion")).toBeVisible();
  await expect(menu.getByTestId("menu-item-add-second-opinion")).not.toContainText(/in \d/);
});

test("the built-in claude's links live in ~/.claude/skills and point at the workspace by an absolute path", async ({ page, openShell, pomade, sandbox, backend }) => {
  await ready(pomade, backend.output());
  const frame = await openSkills(page, openShell, pomade, "claude");
  await expect(frame.getByTestId("agent-skills")).toContainText("Links in ~/.claude/skills/");
  await expect(row(frame, "grill-me").getByTestId("skill-also")).toHaveText(`also in ${LIBRA}`);
  await frame.getByTestId("add-skill").click();
  await expect(frame.getByTestId("menu-item-add-wiki-query")).toContainText("in 1");
  await frame.getByTestId("menu-item-add-wiki-query").click();
  const at = join(CLAUDE_SKILLS(sandbox), "wiki-query");
  await expect(row(frame, "wiki-query").getByTestId("skill-switch")).toHaveAttribute("aria-checked", "true");
  expect(await readlink(at)).toBe(join(sandbox.workspace, "Knowledge/_skills/wiki/wiki-query"));
  await expect(frame.getByTestId("toast-text")).toHaveText("Linked ~/.claude/skills/wiki-query → Knowledge/_skills/wiki/wiki-query");
});

test("Codex has no skills: the tab says so", async ({ page, openShell, pomade }) => {
  const frame = await openSkills(page, openShell, pomade, "codex");
  await expect(frame.getByTestId("skills-none")).toHaveText("Codex reads no skills/ folder. Skills for Codex-based agents come later.");
  await expect(frame.getByTestId("add-skill")).toHaveCount(0);
});

test("at every width the rows stay inside the tab and nothing scrolls sideways; screenshots", async ({ page, openShell, pomade, backend }) => {
  await ready(pomade, backend.output());
  const frame = await openSkills(page, openShell, pomade, LIBRA);
  await expect(frame.getByTestId("skill-row")).toHaveCount(5);
  for (const [name, width] of [
    ["wide", 1440],
    ["medium", 1000],
    ["narrow", 600],
  ] as const) {
    await page.setViewportSize({ width, height: 800 });
    const list = await frame.getByTestId("skills-list").evaluate((el) => el.getBoundingClientRect().toJSON() as DOMRect);
    for (const box of await frame.getByTestId("skill-row").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect))) {
      expect(box.x + box.width, `a row's right edge at ${name}`).toBeLessThanOrEqual(list.x + list.width + 0.5);
      expect(box.height, `a row's height at ${name}`).toBe(28);
    }
    expect(await frame.locator("html").evaluate((el) => el.scrollWidth - el.clientWidth), `sideways scroll at ${name}`).toBeLessThanOrEqual(0);
    expect(await frame.getByTestId("agent-body").evaluate((el) => el.scrollWidth - el.clientWidth), `body sideways scroll at ${name}`).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${ARTIFACTS}/agent-skills-${name}.png` });
    await frame.getByTestId("add-skill").click();
    const menu = (await frame.getByTestId("add-skill-menu").boundingBox()) ?? { x: 0, width: Infinity };
    expect(menu.x + menu.width, `the menu's right edge at ${name}`).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${ARTIFACTS}/agent-skills-add-${name}.png` });
    await page.keyboard.press("Escape");
    await expect(frame.getByTestId("add-skill-menu")).toHaveCount(0);
  }
  await page.setViewportSize({ width: 1000, height: 800 });
  await row(frame, "grill-me").getByTestId("skill-switch").click();
  await expect(frame.getByTestId("toast")).toBeVisible();
  await expect(row(frame, "grill-me").getByTestId("skill-switch")).toBeEnabled();
  await page.screenshot({ path: `${ARTIFACTS}/agent-skills-off-toast.png`, animations: "disabled" });
});
