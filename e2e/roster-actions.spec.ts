// The Roster's actions (ARCHITECTURE §3.3, T-021), on a card and a list row, over the real backend and the
// fake Pomade: Start session ▾ (the mode, then connected projects, the others, the Workspace) launches
// the agent there; Sessions opens the Workspace's Sessions tab on the agent; the ⋯ menu hides an agent
// from the "+" menu (with Undo) and opens its files; the role line and the tags are edited on the card
// without moving it; an orphan is re-linked to an unclaimed agent folder or its profile removed.
// `ROSTER_ACTION_SHOTS=<folder>` also writes screenshots of every surface.

import { mkdirSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { FrameLocator, Locator, Page } from "@playwright/test";
import { providerModes, type RosterAgent } from "pomade-kit/protocol";

import type { Sandbox } from "../harness/sandbox.ts";
import { ROSTER_LIST_METHOD } from "../src/shared/roster.ts";
import { expect, test, type Shell } from "./fixtures.ts";
import { LONG_ID, ROSTER_PROJECTS, seedRoster } from "./roster-fixtures.ts";

const SHOTS = process.env.ROSTER_ACTION_SHOTS;
if (SHOTS !== undefined) mkdirSync(SHOTS, { recursive: true });

/** The tab beside the 44 px strip and the 240 px side panel of the fake Pomade's window. */
const CHROME = 284;
const viewport = (tab: number): { width: number; height: number } => ({ width: tab + CHROME, height: 1000 });

const profileOf = (sandbox: Sandbox, id: string): string => join(sandbox.workspace, "Apps", "pomade-agents", "agents", id, "agent.yaml");

/** The roster seed, `claude-personal` with only Normal enabled, and the folder `claude-writer` was renamed to. */
async function seed(sandbox: Sandbox): Promise<void> {
  await seedRoster(sandbox, { sessions: false });
  await mkdir(join(sandbox.workspaceReal, "Agents", "claude-writer-v2"), { recursive: true });
  await writeFile(join(sandbox.workspaceReal, "Agents", "claude-writer-v2", "CLAUDE.md"), "# writer\n\n## Role\n\nDrafts essays and posts in the Owner's voice.\n");
  await mkdir(join(profileOf(sandbox, "claude-personal"), ".."), { recursive: true });
  await writeFile(
    profileOf(sandbox, "claude-personal"),
    "id: claude-personal\nprovider: claude\nkind: folder\nconfigDir: Agents/claude-personal\ncommand: claude-personal\nrole: Personal admin.\ntags: []\nhidden: false\nmodes:\n  normal:\n    enabled: true\n  full-autonomy:\n    enabled: false\n",
  );
}

/** The agents Pomade's launch takes: the ones the Roster offers. */
const ROSTER: RosterAgent[] = ["claude", "claude-coder", "claude-libra", "claude-personal", "claude-pm", LONG_ID].map((id) => ({ id, name: id, command: id, provider: "claude", modes: providerModes("claude") }));

test.use({ seed: { into: seed }, pomadeSeed: { projects: ROSTER_PROJECTS, activeProject: "agents", roster: ROSTER } });

async function openRoster(page: Page, openShell: (page: Page) => Promise<Shell>, width = 1316): Promise<FrameLocator> {
  await page.setViewportSize(viewport(width));
  const shell = await openShell(page);
  await shell.panel.getByTestId("open-roster").click();
  return shell.tabFrame("agents");
}

async function shoot(page: Page, name: string): Promise<void> {
  if (SHOTS !== undefined) await page.screenshot({ path: join(SHOTS, `T-021-${name}.png`) });
}

const launchItems = (menu: Locator): Promise<string[]> => menu.locator('[data-testid^="menu-item-launch-"]').evaluateAll((els) => els.map((el) => (el.getAttribute("data-testid") ?? "").replace("menu-item-launch-", "")));

test("Start session ▾ offers the enabled modes, then the connected projects, the others and the Workspace, and launches the agent there in that mode — on a card and a row", async ({ page, openShell, pomade, backend }) => {
  // Pomade launches in the project's folder: it must be there.
  for (const project of ROSTER_PROJECTS) pomade.fake.writeFile(`${project.root}/README.md`, "project\n");
  const tab = await openRoster(page, openShell);
  const card = tab.getByTestId("agent-card-claude-coder");
  await expect(card, backend.output()).toBeVisible();

  await card.getByTestId("agent-start-claude-coder").click();
  const menu = tab.getByTestId("start-menu");
  await expect(menu.getByTestId("menu-segment-mode-normal")).toHaveAttribute("aria-pressed", "true");
  await expect(menu.getByTestId("start-menu-head")).toHaveText(["Connected", "Not connected"]);
  // claude-coder is offered by these projects, in the Projects panel's order (Knowledge offers every agent).
  expect(await launchItems(menu)).toEqual(["pomade", "agents", "kit", "runner", "knowledge", "ske", "eval", "fabric", "wiki", "tax", "budget", "photos", "__workspace__"]);
  await shoot(page, "start-menu-modes");
  await menu.getByTestId("menu-segment-mode-full-autonomy").click();
  await expect(menu.getByTestId("menu-segment-mode-full-autonomy")).toHaveAttribute("aria-pressed", "true");
  await menu.getByTestId("menu-item-launch-tax").click();
  await expect(menu).toHaveCount(0);
  await expect.poll(() => pomade.fake.openedAgentTabs.at(-1)).toMatchObject({ agentId: "claude-coder", projectId: "tax", mode: "full-autonomy" });
  // Pomade switched to the new tab's project; back to the Roster's.
  await page.getByTestId("tab-agents").click();

  // Only Normal enabled: no mode to pick.
  await tab.getByTestId("agent-start-claude-personal").click();
  await expect(menu).toBeVisible();
  await expect(menu.getByTestId("menu-segment-mode")).toHaveCount(0);
  await shoot(page, "start-menu-normal-only");
  await menu.getByTestId("menu-item-launch-budget").click();
  await expect.poll(() => pomade.fake.openedAgentTabs.at(-1)).toMatchObject({ agentId: "claude-personal", projectId: "budget", mode: "normal" });
  await page.getByTestId("tab-agents").click();

  await tab.getByTestId("roster-view-list").click();
  await tab.getByTestId("agent-start-claude-coder").click();
  await menu.getByTestId("menu-item-launch-__workspace__").click();
  await expect.poll(() => pomade.fake.openedAgentTabs.at(-1)).toMatchObject({ agentId: "claude-coder", projectId: "__workspace__", mode: "normal" });
  expect(pomade.fake.openedAgentTabs).toHaveLength(3);
});

test("a launch Pomade refuses says so in a toast", async ({ page, openShell, pomade, backend }) => {
  const tab = await openRoster(page, openShell);
  await expect(tab.getByTestId("agent-card-claude-broken"), backend.output()).toBeVisible();
  // claude-broken is not in Pomade's roster: its launch is refused.
  await tab.getByTestId("agent-start-claude-broken").click();
  await tab.getByTestId("start-menu").getByTestId("menu-item-launch-pomade").click();
  await expect(tab.getByTestId("toast-text")).toHaveText("The session was not started. Pomade does not know the agent, or its command is not found.");
  expect(pomade.fake.openedAgentTabs).toHaveLength(0);
});

test("Sessions opens the Workspace's Sessions tab with the Agent filter; Open › and the ⋯ menu's Open agent page open its page — in both views", async ({ page, openShell, pomade, backend }) => {
  const tab = await openRoster(page, openShell);
  await expect(tab.getByTestId("agent-card-claude-libra"), backend.output()).toBeVisible();
  const apps = (): unknown[] => pomade.fake.openedTabs.filter((t) => t.kind === "app" && t.route.startsWith("sessions"));

  await tab.getByTestId("agent-sessions-claude-libra").click();
  await expect.poll(apps).toEqual([expect.objectContaining({ projectId: "__workspace__", route: "sessions?agent=claude-libra" })]);
  await page.getByTestId("tab-agents").click();

  await tab.getByTestId("roster-view-list").click();
  await tab.getByTestId("agent-more-claude-pm").click();
  const menu = tab.getByTestId("agent-menu-claude-pm");
  await expect(menu.getByRole("menuitem")).toHaveText(["Open agent page", "Sessions", "Clone…", "Hide from the “+” menu", "Open CLAUDE.md", "Open agent.yaml"]);
  await shoot(page, "more-menu-list");
  await menu.getByTestId("menu-item-sessions").click();
  await expect.poll(apps).toHaveLength(2);
  expect(apps()[1]).toMatchObject({ projectId: "__workspace__", route: "sessions?agent=claude-pm" });
  await page.getByTestId("tab-agents").click();

  await tab.getByTestId("agent-more-claude-pm").click();
  await menu.getByTestId("menu-item-open-agent").click();
  await expect(tab.getByTestId("agent-name")).toHaveText("claude-pm");
  await tab.getByTestId("agent-back").click();
  await tab.getByTestId("roster-view-cards").click();
  await tab.getByTestId("agent-open-claude-pm").click();
  await expect(tab.getByTestId("agent-name")).toHaveText("claude-pm");
});

test("Hide from the ⋯ menu moves the agent to the hidden section and out of roster.list, its Start session off; Undo and Show bring it back — in both views", async ({ page, openShell, pomade, sandbox, backend }) => {
  const tab = await openRoster(page, openShell);
  await expect(tab.getByTestId("agent-card-claude-pm"), backend.output()).toBeVisible();
  const listed = async (): Promise<string[]> => ((await pomade.fake.callApi(ROSTER_LIST_METHOD, {})) as { agents: { id: string }[] }).agents.map((a) => a.id);
  const hiddenIds = (): Promise<string[]> => tab.getByTestId("roster-cards-hidden").locator('[data-testid^="agent-card-"]').evaluateAll((els) => els.map((el) => (el.getAttribute("data-testid") ?? "").replace("agent-card-", "")));

  await tab.getByTestId("agent-more-claude-pm").click();
  await tab.getByTestId("agent-menu-claude-pm").getByTestId("menu-item-hide").click();
  await expect(tab.getByTestId("toast-text")).toHaveText("claude-pm is hidden from Pomade’s “+” menu.");
  await expect.poll(hiddenIds).toEqual(["codex", "claude-pm"]);
  await expect.poll(() => readFile(profileOf(sandbox, "claude-pm"), "utf8")).toContain("hidden: true");
  await expect.poll(listed).not.toContain("claude-pm");
  await expect(tab.getByTestId("agent-start-claude-pm")).toBeDisabled();
  await expect(tab.getByTestId("agent-start-claude-pm")).toHaveAttribute("title", /show it there to start a session/);
  await shoot(page, "hidden-agent");
  await tab.getByTestId("toast-undo").click();
  await expect.poll(hiddenIds).toEqual(["codex"]);
  await expect.poll(listed).toContain("claude-pm");

  // The list: Show a hidden agent again.
  await tab.getByTestId("roster-view-list").click();
  await tab.getByTestId("agent-more-codex").click();
  await expect(tab.getByTestId("agent-menu-codex").getByTestId("menu-item-hide")).toHaveText("Show in the “+” menu");
  await expect(tab.getByTestId("agent-menu-codex").getByTestId("menu-item-open-claude-md")).toHaveCount(0);
  await tab.getByTestId("agent-menu-codex").getByTestId("menu-item-hide").click();
  await expect(tab.getByTestId("toast-text")).toHaveText("Codex is back in Pomade’s “+” menu.");
  await expect(tab.getByTestId("roster-hidden-toggle")).toHaveCount(0);
  await expect.poll(listed).toContain("codex");
  expect(await readFile(profileOf(sandbox, "codex"), "utf8")).toContain("hidden: false");
});

test("the ⋯ menu's Open CLAUDE.md and Open agent.yaml open in Pomade's editor; an unusable profile's notice opens its agent.yaml", async ({ page, openShell, pomade, backend }) => {
  for (const path of ["Agents/claude-coder/CLAUDE.md", "Apps/pomade-agents/agents/claude-coder/agent.yaml", "Apps/pomade-agents/agents/claude-broken/agent.yaml"]) pomade.fake.writeFile(path, "text\n");
  const tab = await openRoster(page, openShell);
  await expect(tab.getByTestId("agent-card-claude-coder"), backend.output()).toBeVisible();
  const files = (): unknown[] => pomade.fake.openedTabs.filter((t) => t.kind === "file").map((t) => (t as { path: string }).path);
  await tab.getByTestId("agent-more-claude-coder").click();
  await tab.getByTestId("menu-item-open-claude-md").click();
  await tab.getByTestId("agent-more-claude-coder").click();
  await tab.getByTestId("menu-item-open-agent-yaml").click();
  await tab.getByTestId("agent-open-yaml-claude-broken").click();
  await expect.poll(files).toEqual(["Agents/claude-coder/CLAUDE.md", "Apps/pomade-agents/agents/claude-coder/agent.yaml", "Apps/pomade-agents/agents/claude-broken/agent.yaml"]);
});

test("the role line and the tags are edited on a card into agent.yaml; hovering and editing them never moves the card or anything in it", async ({ page, openShell, sandbox, backend }) => {
  const tab = await openRoster(page, openShell, 1094);
  const card = tab.getByTestId("agent-card-claude-pm");
  await expect(card, backend.output()).toBeVisible();
  const role = card.getByTestId("agent-role-claude-pm");
  const tags = card.getByTestId("agent-tags-claude-pm");
  const layout = async (): Promise<unknown> => ({
    card: await card.boundingBox(),
    tags: await tags.boundingBox(),
    facts: await card.locator("dl").boundingBox(),
    start: await card.getByTestId("agent-start-claude-pm").boundingBox(),
    next: await tab.getByTestId("agent-card-claude-writer").boundingBox(),
  });
  // The card at rest is the card once the counts are in: an agent with no sessions shows Needs login then.
  await expect(card.getByTestId("chip-needs-login-claude-pm")).toBeVisible();
  const resting = await layout();

  await role.hover();
  expect(await layout()).toEqual(resting);
  await shoot(page, "role-hover");
  await card.getByTestId("agent-role-claude-pm-text").click();
  const field = card.getByTestId("agent-role-claude-pm-field");
  await expect(field).toBeFocused();
  expect(await layout()).toEqual(resting);
  await field.fill("Product manager: grills, tickets, the backlog and the release notes of the Pomade family, and the Owner's weekly review of what shipped and what is stuck.");
  expect(await layout()).toEqual(resting);
  await shoot(page, "role-edit-long");
  await field.press("Enter");
  await expect(card.getByTestId("agent-role-claude-pm-text")).toContainText("Product manager: grills, tickets, the backlog");
  await expect.poll(() => readFile(profileOf(sandbox, "claude-pm"), "utf8")).toContain("role: \"Product manager: grills, tickets, the backlog and the release notes of the Pomade family, and the Owner's weekly review of what shipped and what is stuck.\"");
  expect(await layout()).toEqual(resting);
  await card.getByTestId("agent-role-claude-pm-text").click();
  await field.fill("");
  await field.press("Enter");
  await expect(card.getByTestId("agent-role-claude-pm-text")).toHaveText("No role line");
  await expect.poll(() => readFile(profileOf(sandbox, "claude-pm"), "utf8")).not.toContain("role:");
  expect(await layout()).toEqual(resting);
  await shoot(page, "role-empty");

  // Tags: the add button shows on hover in its own room; adding many keeps one row.
  await tags.hover();
  const add = tags.getByTestId("agent-tags-claude-pm-add");
  await expect(add).toHaveCSS("opacity", "1");
  expect(await layout()).toEqual(resting);
  await add.click();
  const tagField = tags.getByTestId("agent-tags-claude-pm-field");
  for (const tag of ["product", "backlog", "grills", "tickets", "release-notes", "weekly-review"]) {
    await tagField.fill(tag);
    await tagField.press("Enter");
  }
  await expect(tags.getByTestId("agent-tags-claude-pm-tag")).toHaveCount(6);
  expect(await layout()).toEqual(resting);
  await expect(tagField).toBeInViewport();
  await shoot(page, "tags-many-adding");
  await tagField.press("Escape");
  await expect.poll(() => readFile(profileOf(sandbox, "claude-pm"), "utf8")).toContain("- weekly-review");
  await tags.getByTestId("agent-tags-claude-pm-tag").first().hover();
  expect(await layout()).toEqual(resting);
  await tags.getByTestId("agent-tags-claude-pm-tag").first().getByTestId("agent-tags-claude-pm-remove").click();
  await expect(tags.getByTestId("agent-tags-claude-pm-tag")).toHaveCount(5);
  await expect.poll(() => readFile(profileOf(sandbox, "claude-pm"), "utf8")).not.toContain("- product");
  expect(await layout()).toEqual(resting);

  // An orphan's and an unusable profile's are not editable.
  await expect(tab.getByTestId("agent-role-claude-writer-text")).toBeDisabled();
  await expect(tab.getByTestId("agent-tags-claude-broken-add")).toHaveCount(0);
});

test("Re-link ▾ lists the unclaimed agent folders; picking the one the folder was renamed to makes the orphan whole again — on a card and a row", async ({ page, openShell, sandbox, backend }) => {
  const tab = await openRoster(page, openShell);
  const orphan = tab.getByTestId("agent-card-claude-writer");
  await expect(orphan.getByTestId("chip-orphan"), backend.output()).toBeVisible();
  // The renamed folder is a new agent of its own until it is re-linked.
  await expect(tab.getByTestId("agent-card-claude-writer-v2")).toBeVisible();

  await tab.getByTestId("roster-view-list").click();
  await tab.getByTestId("agent-relink-claude-writer").click();
  const menu = tab.getByTestId("relink-menu");
  await expect(menu.getByTestId("menu-item-relink-claude-writer-v2")).toHaveText("Agents/claude-writer-v2");
  // An agent folder whose profile was edited, or that another profile names, is not offered.
  await expect(menu.getByTestId("menu-item-relink-claude-coder")).toHaveCount(0);
  await shoot(page, "relink-menu-list");
  await page.keyboard.press("Escape");

  await tab.getByTestId("roster-view-cards").click();
  await orphan.getByTestId("agent-relink-claude-writer").click();
  await expect(menu.getByTestId("menu-item-relink-claude-writer-v2")).toBeVisible();
  await shoot(page, "relink-menu-card");
  await menu.getByTestId("menu-item-relink-claude-writer-v2").click();
  await expect(tab.getByTestId("toast-text")).toHaveText("claude-writer now points at Agents/claude-writer-v2. It is back in the “+” menu.");
  await expect(orphan.getByTestId("chip-orphan")).toHaveCount(0);
  await expect(orphan.getByTestId("agent-start-claude-writer")).toBeEnabled();
  await expect(tab.getByTestId("agent-card-claude-writer-v2")).toHaveCount(0);
  expect(await readFile(profileOf(sandbox, "claude-writer"), "utf8")).toContain("configDir: Agents/claude-writer-v2\n");
  await expect(readFile(profileOf(sandbox, "claude-writer-v2"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
});

test("a re-link's Undo puts both agent.yaml files and the roster back exactly as they were", async ({ page, openShell, sandbox, backend }) => {
  const tab = await openRoster(page, openShell);
  const orphan = tab.getByTestId("agent-card-claude-writer");
  await expect(orphan.getByTestId("chip-orphan"), backend.output()).toBeVisible();
  await expect(tab.getByTestId("agent-card-claude-writer-v2")).toBeVisible();
  const files = (): Promise<string[]> => Promise.all(["claude-writer", "claude-writer-v2"].map((id) => readFile(profileOf(sandbox, id), "utf8")));
  const cards = (): Promise<string[]> => tab.locator('[data-testid^="agent-card-"]').evaluateAll((els) => els.map((el) => `${el.getAttribute("data-testid") ?? ""}${el.hasAttribute("data-orphan") ? " orphan" : ""}`));
  const before = await files();
  const shown = await cards();

  await orphan.getByTestId("agent-relink-claude-writer").click();
  await tab.getByTestId("relink-menu").getByTestId("menu-item-relink-claude-writer-v2").click();
  await expect(tab.getByTestId("toast-text")).toHaveText("claude-writer now points at Agents/claude-writer-v2. It is back in the “+” menu.");
  await expect(tab.getByTestId("agent-card-claude-writer-v2")).toHaveCount(0);
  await shoot(page, "relink-toast-undo");
  await tab.getByTestId("toast-undo").click();
  await expect(tab.getByTestId("toast-text")).toHaveText("Re-link taken back: claude-writer is an orphan again, Agents/claude-writer-v2 an agent of its own.");
  await expect(orphan.getByTestId("chip-orphan")).toBeVisible();
  await expect.poll(cards).toEqual(shown);
  expect(await files()).toEqual(before);
});

test("Remove asks first, in place; Cancel keeps the orphan; Remove deletes its profile and touches no agent folder — on a row and a card", async ({ page, openShell, sandbox, backend }) => {
  const tab = await openRoster(page, openShell);
  await expect(tab.getByTestId("agent-card-claude-writer"), backend.output()).toBeVisible();
  const agentsBefore = await readdir(join(sandbox.workspaceReal, "Agents"));

  await tab.getByTestId("agent-remove-claude-writer").click();
  await expect(tab.getByTestId("agent-notice-claude-writer")).toContainText("Remove claude-writer’s profile? This deletes Apps/pomade-agents/agents/claude-writer/. No agent folder is touched.");
  await shoot(page, "remove-confirm-card");
  await tab.getByTestId("agent-remove-cancel-claude-writer").click();
  await expect(tab.getByTestId("agent-relink-claude-writer")).toBeVisible();

  await tab.getByTestId("roster-view-list").click();
  await tab.getByTestId("agent-remove-claude-writer").click();
  await expect(tab.getByTestId("agent-role-claude-writer")).toHaveText("Remove its profile? No agent folder is touched.");
  await shoot(page, "remove-confirm-list");
  await tab.getByTestId("agent-remove-confirm-claude-writer").click();
  await expect(tab.getByTestId("toast-text")).toHaveText("claude-writer’s profile is removed. No agent folder was touched.");
  await expect(tab.getByTestId("agent-card-claude-writer")).toHaveCount(0);
  await expect(readdir(join(sandbox.workspace, "Apps", "pomade-agents", "agents", "claude-writer"))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readdir(join(sandbox.workspaceReal, "Agents"))).toEqual(agentsBefore);
});

test("Start session ▾ and the ⋯ menu open inside the window at every width, in both views", async ({ page, openShell, backend }) => {
  const tab = await openRoster(page, openShell);
  await expect(tab.getByTestId("agent-card-claude-coder"), backend.output()).toBeVisible();
  /** Whether the menu's box lies inside the window. */
  const inWindow = (menu: Locator): Promise<boolean> =>
    menu.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const frame = el.ownerDocument.documentElement;
      return box.left >= 0 && box.top >= 0 && box.right <= frame.clientWidth && box.bottom <= frame.clientHeight;
    });
  for (const view of ["cards", "list"] as const) {
    await tab.getByTestId(`roster-view-${view}`).click();
    for (const width of [1316, 1094, 700, 400]) {
      await page.setViewportSize(viewport(width));
      await tab.getByTestId("agent-card-claude-coder").hover();
      await shoot(page, `${view}-${width}-hover`);
      await tab.getByTestId("agent-start-claude-coder").click();
      expect(await inWindow(tab.getByTestId("start-menu")), `Start session, ${view}, ${width}`).toBe(true);
      await shoot(page, `${view}-${width}-start-menu`);
      await page.keyboard.press("Escape");
      await tab.getByTestId("agent-more-claude-coder").click();
      expect(await inWindow(tab.getByTestId("agent-menu-claude-coder")), `⋯, ${view}, ${width}`).toBe(true);
      await shoot(page, `${view}-${width}-more-menu`);
      await page.keyboard.press("Escape");
    }
  }
});
