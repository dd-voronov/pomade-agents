// The Roster's small defects, each walked on the real backend in the fake Pomade: the Codex model
// hint names no ticket; a role line of 200 characters and 20 tags of 24 are kept whole on New agent
// and by `roster.create` / `roster.updateProfile`, one more of any is not; the agent's page is
// titled with its name as its card is, the id still on it; a list row that Needs login keeps its
// chip and offers the setup prompt at every width; an agent hidden by an unusable `agent.yaml`
// carries the hidden mark on its page as on its card; picking another clone source on New agent
// keeps what was typed. `ROSTER_SHOTS=<folder>` also writes screenshots.

import { mkdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { FrameLocator, Page } from "@playwright/test";
import type { RosterAgent } from "pomade-kit/protocol";

import type { FakePomade } from "../harness/fake-pomade.ts";
import type { Sandbox } from "../harness/sandbox.ts";
import { ROLE_MAX, ROSTER_AGENTS_METHOD, ROSTER_CREATE_METHOD, ROSTER_UPDATE_PROFILE_METHOD, TAGS_MAX, TAG_MAX, isRosterAgentsAnswer } from "../src/shared/roster.ts";
import { agentRoute } from "../src/ui/core/routes.ts";
import { expect, test, type Shell } from "./fixtures.ts";

const SHOTS = process.env.ROSTER_SHOTS;
if (SHOTS !== undefined) mkdirSync(SHOTS, { recursive: true });

const LIBRA = "claude-libra";
const OTHER = "claude-other";
const FRESH = "claude-fresh";
/** The tab beside the 44 px strip and the 240 px side panel of the fake Pomade's window. */
const CHROME = 284;

const launchable = (...ids: string[]): RosterAgent[] => ids.map((id) => ({ id, name: id, command: id, provider: "claude" }));
const profileOf = (sandbox: Sandbox, id: string): string => join(sandbox.workspace, "Apps", "pomade-agents", "agents", id, "agent.yaml");

async function rosterReady(pomade: FakePomade): Promise<void> {
  await expect
    .poll(async () => {
      const roster = await pomade.fake.callApi(ROSTER_AGENTS_METHOD).catch(() => null);
      return isRosterAgentsAnswer(roster) && roster.agents.length > 0 && roster.agents.every((a) => a.profile !== null);
    })
    .toBe(true);
}

async function openTab(page: Page, openShell: (page: Page) => Promise<Shell>, pomade: FakePomade, route: string): Promise<FrameLocator> {
  const { tabFrame } = await openShell(page);
  pomade.fake.openAppTab({ projectId: "alpha", route });
  return tabFrame("alpha");
}

async function shoot(page: Page, name: string): Promise<void> {
  if (SHOTS !== undefined) await page.screenshot({ path: join(SHOTS, `T-037-${name}.png`) });
}

/** `n` distinct one-word tags. */
const tagNames = (n: number): string[] => Array.from({ length: n }, (_, i) => `tag-${i + 1}`);

test.describe("the agent's page", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("the Codex model hint names no ticket", async ({ page, openShell, pomade, backend }) => {
    await rosterReady(pomade);
    const tab = await openTab(page, openShell, pomade, agentRoute("codex", "model"));
    await expect(tab.getByTestId("model-hint"), backend.output()).toHaveText("Read-only here: editing Codex’s model comes with Codex-based agents.");
    await shoot(page, "codex-hint");
  });

  test("is titled with the agent's name as its card is, and shows the id", async ({ page, openShell, pomade, backend }) => {
    await rosterReady(pomade);
    const tab = await openTab(page, openShell, pomade, "roster");
    await expect(tab.getByTestId("agent-name-claude"), backend.output()).toHaveText("Claude");
    await tab.getByTestId("agent-name-claude").click();
    await expect(tab.getByTestId("agent-name")).toHaveText("Claude");
    await expect(tab.getByTestId("agent-id")).toHaveText("claude");
    await shoot(page, "agent-page-title");

    // A folder agent's name is its id: the title says it, and the id is not repeated.
    await tab.getByTestId("agent-back").click();
    await tab.getByTestId(`agent-name-${LIBRA}`).click();
    await expect(tab.getByTestId("agent-name")).toHaveText(LIBRA);
    await expect(tab.getByTestId("agent-id")).toHaveCount(0);
  });
});

test.describe("an agent hidden by an unusable agent.yaml", () => {
  test.use({
    viewport: { width: 1280, height: 800 },
    seed: {
      async into(sandbox) {
        await mkdir(join(sandbox.workspace, ".pomade"), { recursive: true });
        await writeFile(join(sandbox.workspace, ".pomade", "agents.json"), JSON.stringify({ commands: {}, hidden: [LIBRA] }));
        await mkdir(join(sandbox.workspace, "Apps", "pomade-agents", "agents", LIBRA), { recursive: true });
        await writeFile(profileOf(sandbox, LIBRA), "id: [\n");
      },
    },
  });

  test("carries the hidden mark on its page as on its card", async ({ page, openShell, pomade, backend, sandbox }) => {
    const tab = await openTab(page, openShell, pomade, "roster");
    const card = tab.getByTestId(`agent-card-${LIBRA}`);
    await expect(card.getByTestId("chip-unreadable"), backend.output()).toBeVisible();
    await expect(card.getByTestId("chip-hidden")).toHaveText("hidden");
    await card.getByTestId(`agent-name-${LIBRA}`).click();
    await expect(tab.getByTestId("agent-chip-unreadable")).toBeVisible();
    await expect(tab.getByTestId("agent-chip-hidden")).toHaveText("hidden");
    await expect(tab.getByTestId("agent-chip-hidden")).toHaveAttribute("title", "Left out of Pomade’s “+” menu");
    await shoot(page, "agent-page-hidden-unusable");
    expect(await readFile(profileOf(sandbox, LIBRA), "utf8")).toBe("id: [\n");
  });
});

test.describe("a list row that Needs login", () => {
  test.use({ pomadeSeed: { roster: launchable(FRESH) } });

  test("keeps the chip and offers the setup prompt at every width", async ({ page, openShell, pomade, backend }) => {
    await rosterReady(pomade);
    const created = await pomade.fake.callApi(ROSTER_CREATE_METHOD, { name: FRESH, role: "Tries things.", tags: ["lab"], projects: [], createId: "fresh" });
    expect(created).toMatchObject({ name: FRESH });
    await page.setViewportSize({ width: 1200 + CHROME, height: 900 });
    const tab = await openTab(page, openShell, pomade, "roster");
    await tab.getByTestId("roster-view-list").click();
    const row = tab.getByTestId(`agent-card-${FRESH}`);
    const prompt = `Use the creating-claude-agent skill to set up ${FRESH}: role “Tries things.”, tags lab.`;

    for (const width of [1200, 800, 600, 500, 420]) {
      await page.setViewportSize({ width: width + CHROME, height: 900 });
      await expect(row.getByTestId(`chip-needs-login-${FRESH}`), `${width}px\n${backend.output()}`).toBeVisible();
      await expect(row.getByTestId(`agent-needs-login-${FRESH}-copy`), `${width}px`).toBeVisible();
      await expect(row.getByTestId(`agent-needs-login-${FRESH}-copy`)).toHaveAttribute("title", new RegExp(prompt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      // Nothing of the row hangs over its edge.
      const box = await row.boundingBox();
      for (const part of [row.getByTestId(`chip-needs-login-${FRESH}`), row.getByTestId(`agent-needs-login-${FRESH}-copy`), row.getByTestId(`agent-start-${FRESH}`)]) {
        const inner = await part.boundingBox();
        expect(inner !== null && box !== null && inner.x >= box.x - 0.5 && inner.x + inner.width <= box.x + box.width + 0.5, `${width}px: a part hangs over the row`).toBe(true);
      }
      await shoot(page, `list-needs-login-${width}`);
    }

    await page.setViewportSize({ width: 1200 + CHROME, height: 900 });
    await expect(row.getByTestId(`agent-needs-login-${FRESH}`)).toContainText("Log in with /login in its tab, then paste the setup prompt.");
    await row.getByTestId(`agent-needs-login-${FRESH}-copy`).click();
    await expect(row.getByTestId(`agent-needs-login-${FRESH}-copy`)).toHaveText("Copied");
  });
});

test.describe("the limits of a role line and tags", () => {
  test.use({ viewport: { width: 1280, height: 900 }, pomadeSeed: { roster: launchable("claude-limits") } });

  test("New agent stops at 200 characters and 20 tags of 24, and Create keeps them whole", async ({ page, openShell, pomade, sandbox, backend }) => {
    await rosterReady(pomade);
    const tab = await openTab(page, openShell, pomade, "roster/new");
    await expect(tab.getByRole("heading", { name: "New agent" })).toBeVisible();
    await tab.getByTestId("new-agent-name").fill("claude-limits");
    await expect(tab.getByTestId("new-agent-name-message")).toHaveAttribute("data-state", "ok");

    const role = "r".repeat(ROLE_MAX);
    await expect(tab.getByTestId("new-agent-role")).toHaveAttribute("maxlength", String(ROLE_MAX));
    await tab.getByTestId("new-agent-role").fill(role);
    await expect(tab.getByTestId("new-agent-role")).toHaveValue(role);

    // A tag stops at 24 characters; 20 tags fill the list and the field is closed.
    await tab.getByTestId("new-agent-tag").fill("x".repeat(TAG_MAX + 6));
    await expect(tab.getByTestId("new-agent-tag")).toHaveValue("x".repeat(TAG_MAX));
    await tab.getByTestId("new-agent-tag").press("Enter");
    const rest = tagNames(TAGS_MAX - 1);
    for (const tag of rest) {
      await tab.getByTestId("new-agent-tag").fill(tag);
      await tab.getByTestId("new-agent-tag").press("Enter");
    }
    await expect(tab.getByTestId("new-agent-tag-chip")).toHaveCount(TAGS_MAX);
    await expect(tab.getByTestId("new-agent-tag")).toBeDisabled();
    await expect(tab.getByTestId("new-agent-tags-hint")).toHaveText(`${TAGS_MAX} tags are the most: remove one to add another.`);
    await shoot(page, "new-agent-limits");

    await tab.getByTestId("new-agent-create").click();
    await expect(tab.getByRole("heading", { name: "claude-limits created" }), backend.output()).toBeVisible({ timeout: 30_000 });
    const yaml = await readFile(profileOf(sandbox, "claude-limits"), "utf8");
    expect(yaml).toContain(`role: ${role}\n`);
    expect(yaml).toContain(`  - ${"x".repeat(TAG_MAX)}\n`);
    expect(yaml.match(/^ {2}- /gm)).toHaveLength(TAGS_MAX);
  });

  test("roster.create and roster.updateProfile refuse one more of any, and take the limits", async ({ pomade, sandbox, backend }) => {
    await rosterReady(pomade);
    expect(backend.running()).toBe(true);
    const create = (over: Record<string, unknown>) => pomade.fake.callApi(ROSTER_CREATE_METHOD, { name: "claude-api", role: "Role.", tags: [], projects: [], createId: "api", ...over });
    await expect(create({ role: "r".repeat(ROLE_MAX + 1) })).rejects.toThrow(/at most 200 characters/);
    await expect(create({ tags: tagNames(TAGS_MAX + 1) })).rejects.toThrow(/at most 20 tags/);
    await expect(create({ tags: ["x".repeat(TAG_MAX + 1)] })).rejects.toThrow(/at most 24 characters/);
    const update = (over: Record<string, unknown>) => pomade.fake.callApi(ROSTER_UPDATE_PROFILE_METHOD, { agent: LIBRA, ...over });
    await expect(update({ role: "r".repeat(ROLE_MAX + 1) })).rejects.toThrow(/at most 200 characters/);
    await expect(update({ tags: tagNames(TAGS_MAX + 1) })).rejects.toThrow(/at most 20 tags/);
    await expect(update({ tags: ["x".repeat(TAG_MAX + 1)] })).rejects.toThrow(/at most 24 characters/);
    await update({ role: "r".repeat(ROLE_MAX), tags: [...tagNames(TAGS_MAX - 1), "x".repeat(TAG_MAX)] });
    expect(await readFile(profileOf(sandbox, LIBRA), "utf8")).toContain(`role: ${"r".repeat(ROLE_MAX)}\n`);
  });

  test("an agent's page and card stop adding tags at 20", async ({ page, openShell, pomade, backend }) => {
    await rosterReady(pomade);
    await pomade.fake.callApi(ROSTER_UPDATE_PROFILE_METHOD, { agent: LIBRA, tags: tagNames(TAGS_MAX - 1) });
    const tab = await openTab(page, openShell, pomade, agentRoute(LIBRA));
    const tags = tab.getByTestId("agent-tags");
    await expect(tags.getByTestId("agent-tags-tag"), backend.output()).toHaveCount(TAGS_MAX - 1);
    await tags.getByTestId("agent-tags-add").click();
    await tags.getByTestId("agent-tags-field").fill("last, over, more");
    await tags.getByTestId("agent-tags-field").press("Enter");
    await expect(tags.getByTestId("agent-tags-tag")).toHaveCount(TAGS_MAX);
    await expect(tags.getByTestId("agent-tags-tag").last()).toHaveText("last");
    await tags.getByTestId("agent-tags-field").press("Escape");
    await expect(tags.getByTestId("agent-tags-add")).toBeDisabled();
    await shoot(page, "agent-page-tags-full");
  });
});

test.describe("picking another clone source on New agent", () => {
  test.use({
    viewport: { width: 1280, height: 900 },
    seed: {
      async into(sandbox) {
        await mkdir(join(sandbox.workspaceReal, "Agents", OTHER), { recursive: true });
        await writeFile(join(sandbox.workspaceReal, "Agents", OTHER, "CLAUDE.md"), "# other\n\n## Role\n\nThe other one.\n");
      },
    },
  });

  test("keeps a role, tags and projects already typed; the untouched fields take the new source's values", async ({ page, openShell, pomade, backend }) => {
    await rosterReady(pomade);
    await pomade.fake.callApi(ROSTER_UPDATE_PROFILE_METHOD, { agent: LIBRA, role: "Keeps the vault in order.", tags: ["vault"] });
    await pomade.fake.callApi(ROSTER_UPDATE_PROFILE_METHOD, { agent: OTHER, role: "The other role.", tags: ["other"] });
    pomade.fake.updateProject("beta", { visibleAgents: ["claude", LIBRA] });
    pomade.fake.updateProject("alpha", { visibleAgents: ["claude", OTHER] });
    const tab = await openTab(page, openShell, pomade, `roster/new?clone=${LIBRA}`);
    await expect(tab.getByTestId("new-agent-role"), backend.output()).toHaveValue("Keeps the vault in order.");
    await expect(tab.getByTestId("new-agent-tag-chip")).toHaveText(["vault"]);
    await expect(tab.getByTestId("new-agent-project-beta")).toHaveAttribute("aria-checked", "true");

    // Nothing typed yet: another source replaces all three.
    const pick = async (id: string): Promise<void> => {
      await tab.getByTestId("new-agent-clone-source").click();
      await tab.getByTestId(`menu-item-clone-source-${id}`).click();
      await expect(tab.getByTestId("new-agent-clone-source")).toHaveText(id);
    };
    await pick(OTHER);
    await expect(tab.getByTestId("new-agent-role")).toHaveValue("The other role.");
    await expect(tab.getByTestId("new-agent-tag-chip")).toHaveText(["other"]);
    await expect(tab.getByTestId("new-agent-project-beta")).toHaveAttribute("aria-checked", "false");
    await expect(tab.getByTestId("new-agent-project-alpha")).toHaveAttribute("aria-checked", "true");

    // The role typed, a tag added: only the projects follow the next source.
    await tab.getByTestId("new-agent-role").fill("Mine.");
    await tab.getByTestId("new-agent-tag").fill("mine");
    await tab.getByTestId("new-agent-tag").press("Enter");
    await pick(LIBRA);
    await expect(tab.getByTestId("new-agent-role")).toHaveValue("Mine.");
    await expect(tab.getByTestId("new-agent-tag-chip")).toHaveText(["other", "mine"]);
    await expect(tab.getByTestId("new-agent-project-beta")).toHaveAttribute("aria-checked", "true");
    await expect(tab.getByTestId("new-agent-project-alpha")).toHaveAttribute("aria-checked", "false");
    await shoot(page, "new-agent-clone-switch");

    // A project picked by hand stays as well: the next source adds nothing to it.
    await tab.getByTestId("new-agent-project-alpha").click();
    await pick(OTHER);
    await expect(tab.getByTestId("new-agent-project-alpha")).toHaveAttribute("aria-checked", "true");
    await expect(tab.getByTestId("new-agent-project-beta")).toHaveAttribute("aria-checked", "true");
    await expect(tab.getByTestId("new-agent-role")).toHaveValue("Mine.");
  });
});
