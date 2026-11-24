// The agent page's Model & modes tab through the built app and backend in the fake Pomade (DESIGN
// §3.4, §3.5): the effort and the default model are written to the agent's `settings.json` with
// every other byte kept, and the header follows without a reload; a `settings.json` that is not
// JSON is never written over; Codex is read-only; switching Full autonomy off writes `agent.yaml`
// and takes the mode out of `roster.list` and `roster.launchSpec`, with a `roster.changed` notice;
// each enabled mode's launch line is the backend's launch spec, and Copy puts it on the clipboard.
// Screenshots of every state at three widths, nothing scrolling sideways.

import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { JsonValue } from "pomade-kit/protocol";
import type { Page } from "@playwright/test";

import type { FakePomade } from "../harness/fake-pomade.ts";
import type { Sandbox } from "../harness/sandbox.ts";
import { ROSTER_CHANGED_EVENT, ROSTER_LAUNCH_SPEC_METHOD, ROSTER_LIST_METHOD, isRosterChanged } from "../src/shared/roster.ts";
import { agentRoute } from "../src/ui/core/routes.ts";
import { agentName } from "../src/backend/roster/first-sight.ts";
import { expect, test, type Shell } from "./fixtures.ts";

const ARTIFACTS = fileURLToPath(new URL("./artifacts", import.meta.url));
mkdirSync(ARTIFACTS, { recursive: true });

const LIBRA = "claude-libra";
const POMADE = { from: "pomade" };
const RUNNER = { from: "pomade-runner" };

const libraSettings = (sandbox: Sandbox): string => join(sandbox.workspace, "Agents", LIBRA, "settings.json");
const homeSettings = (sandbox: Sandbox): string => join(sandbox.home, ".claude", "settings.json");
const profileOf = (sandbox: Sandbox, id: string): string => join(sandbox.workspace, "Apps", "pomade-agents", "agents", id, "agent.yaml");
const frameOf = (page: Page) => page.frameLocator('[data-testid="tab-frame-alpha"]');

test.use({ viewport: { width: 1280, height: 800 } });

test.beforeEach(({ backend }) => {
  expect(backend.running()).toBe(true);
});

async function openModelTab(page: Page, openShell: (page: Page) => Promise<Shell>, pomade: FakePomade, agent: string): Promise<void> {
  const { tabFrame } = await openShell(page);
  pomade.fake.openAppTab({ projectId: "alpha", route: agentRoute(agent, "model") });
  const frame = tabFrame("alpha");
  await expect(frame.getByTestId("agent-name")).toHaveText(agentName(agent));
  await expect(frame.getByTestId("model-loading")).toHaveCount(0);
}

async function listedModes(pomade: FakePomade, agent: string): Promise<string[] | undefined> {
  const answer = (await pomade.fake.callApi(ROSTER_LIST_METHOD, {}, POMADE)) as { agents: { id: string; modes: { id: string }[] }[] };
  return answer.agents.find((a) => a.id === agent)?.modes.map((m) => m.id);
}

test("setting claude-libra's effort to high changes only effortLevel in its settings.json; the model follows, the header with it", async ({ page, openShell, pomade, sandbox, backend }) => {
  const before = await readFile(libraSettings(sandbox), "utf8");
  await openModelTab(page, openShell, pomade, LIBRA);
  const frame = frameOf(page);
  await expect(frame.getByTestId("model-select")).toHaveText("Provider default");
  await expect(frame.getByTestId("effort").locator('[aria-pressed="true"]')).toHaveCount(0);
  await expect(frame.getByTestId("model-hint")).toHaveText("Writes model and effortLevel in Agents/claude-libra/settings.json; no other key changes. Sessions already running keep theirs.");

  await frame.getByTestId("effort-high").click();
  await expect(frame.getByTestId("effort-high")).toHaveAttribute("aria-pressed", "true");
  await expect(frame.getByTestId("toast-text")).toContainText('settings.json: "effortLevel": "high"');
  const withEffort = before.replace(/\n\}\n$/, ',\n  "effortLevel": "high"\n}\n');
  expect(withEffort).not.toBe(before);
  await expect.poll(() => readFile(libraSettings(sandbox), "utf8"), { message: backend.output() }).toBe(withEffort);

  // The default model, from the menu; the header shows it with the effort, without a reload.
  await frame.getByTestId("model-select").click();
  await expect(frame.getByTestId("model-menu").getByRole("menuitemradio")).toHaveText(["opus", "sonnet", "haiku", "Provider defaultremoves the key"]);
  await frame.getByTestId("menu-item-model-sonnet").click();
  await expect(frame.getByTestId("model-select")).toHaveText("sonnet");
  const withModel = withEffort.replace(/\n\}\n$/, ',\n  "model": "sonnet"\n}\n');
  await expect.poll(() => readFile(libraSettings(sandbox), "utf8")).toBe(withModel);
  await expect(frame.getByTestId("agent-sub")).toHaveText("Claude Code·sonnet high·launches with claude-libra");

  // Provider default removes the key; the rest stays as it was.
  await frame.getByTestId("model-select").click();
  await frame.getByTestId("menu-item-model-default").click();
  await expect(frame.getByTestId("model-select")).toHaveText("Provider default");
  await expect.poll(() => readFile(libraSettings(sandbox), "utf8")).toBe(withEffort);
  await expect(frame.getByTestId("agent-sub")).toHaveText("Claude Code·provider default·launches with claude-libra");

  // A hand edit made on disk shows on the tab.
  await writeFile(libraSettings(sandbox), withEffort.replace('"high"', '"low"'));
  await expect(frame.getByTestId("effort-low")).toHaveAttribute("aria-pressed", "true", { timeout: 6000 });
});

test("the built-in claude's settings.json in the home folder keeps every other key; a model the file names outside the list stays offered", async ({ page, openShell, pomade, sandbox }) => {
  const before = await readFile(homeSettings(sandbox), "utf8");
  await openModelTab(page, openShell, pomade, "claude");
  const frame = frameOf(page);
  await expect(frame.getByTestId("model-select")).toHaveText("opus");
  await expect(frame.getByTestId("effort-high")).toHaveAttribute("aria-pressed", "true");
  await expect(frame.getByTestId("model-hint")).toContainText("~/.claude/settings.json");
  await frame.getByTestId("effort-xhigh").click();
  await expect.poll(() => readFile(homeSettings(sandbox), "utf8")).toBe(before.replace('"effortLevel": "high"', '"effortLevel": "xhigh"'));

  await writeFile(homeSettings(sandbox), before.replace('"opus"', '"claude-opus-4-8[1m]"'));
  await expect(frame.getByTestId("model-select")).toHaveText("claude-opus-4-8[1m]", { timeout: 6000 });
  await frame.getByTestId("model-select").click();
  await expect(frame.getByTestId("model-menu").getByRole("menuitemradio")).toHaveText(["opus", "sonnet", "haiku", "claude-opus-4-8[1m]", "Provider defaultremoves the key"]);
  await expect(frame.getByTestId("menu-item-model-claude-opus-4-8[1m]")).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
});

test("a settings.json that is not JSON is never written over: the tab says why and offers nothing to change", async ({ page, openShell, pomade, sandbox }) => {
  const broken = '{\n  "permissions": { "allow": [] },\n}\n';
  await writeFile(libraSettings(sandbox), broken);
  await openModelTab(page, openShell, pomade, LIBRA);
  const frame = frameOf(page);
  await expect(frame.getByTestId("model-problem")).toContainText("Agents/claude-libra/settings.json cannot be used: it is not valid JSON");
  await expect(frame.getByTestId("model-select")).toBeDisabled();
  for (const level of ["low", "medium", "high", "xhigh"]) await expect(frame.getByTestId(`effort-${level}`)).toBeDisabled();
  await expect(pomade.fake.callApi("roster.setModel", { agent: LIBRA, effort: "high" })).rejects.toMatchObject({ code: "io-error" });
  expect(await readFile(libraSettings(sandbox), "utf8")).toBe(broken);
  pomade.fake.writeFile("Agents/claude-libra/settings.json", broken);
  await frame.getByTestId("model-open-settings").click();
  await expect.poll(() => pomade.fake.openedTabs.filter((t) => t.kind === "file")).toEqual([{ kind: "file", projectId: "alpha", path: "Agents/claude-libra/settings.json" }]);
});

test("Codex's model is shown read-only from its config.toml, and its modes carry Codex's arguments", async ({ page, openShell, pomade, sandbox }) => {
  const before = await readFile(join(sandbox.home, ".codex", "config.toml"), "utf8");
  await openModelTab(page, openShell, pomade, "codex");
  const frame = frameOf(page);
  await expect(frame.getByTestId("model-fact-model")).toHaveText("gpt-5.2-codex");
  await expect(frame.getByTestId("model-fact-effort")).toHaveText("medium");
  await expect(frame.getByTestId("model-open-config")).toHaveText("~/.codex/config.toml");
  await expect(frame.getByTestId("model-select")).toHaveCount(0);
  await expect(frame.getByTestId("launch-line-normal")).toHaveText("codex");
  await expect(frame.getByTestId("launch-line-full-autonomy")).toHaveText("codex --dangerously-bypass-approvals-and-sandbox");
  await expect(frame.getByTestId("agent-modes")).toContainText("Codex can’t take a session id up front");
  await expect(pomade.fake.callApi("roster.setModel", { agent: "codex", model: "x" })).rejects.toMatchObject({ code: "invalid-params" });
  expect(await readFile(join(sandbox.home, ".codex", "config.toml"), "utf8")).toBe(before);
});

test("Full autonomy switched off leaves roster.list and roster.launchSpec, with a roster.changed notice; switched on, it is back", async ({ page, openShell, pomade, sandbox, backend }) => {
  await openModelTab(page, openShell, pomade, LIBRA);
  const frame = frameOf(page);
  await expect(frame.getByTestId("launch-line-normal")).toHaveText("claude-libra");
  await expect(frame.getByTestId("launch-line-full-autonomy")).toHaveText("claude-libra --dangerously-skip-permissions");
  await expect(frame.getByTestId("mode-switch-normal")).toBeDisabled();
  await expect(frame.getByTestId("mode-switch-normal")).toHaveAttribute("aria-checked", "true");
  expect(await listedModes(pomade, LIBRA)).toEqual(["normal", "full-autonomy"]);
  const heard: JsonValue[] = [];
  pomade.fake.subscribeAs("pomade", ROSTER_CHANGED_EVENT, heard);

  await frame.getByTestId("mode-switch-full-autonomy").click();
  await expect(frame.getByTestId("mode-switch-full-autonomy")).toHaveAttribute("aria-checked", "false");
  await expect(frame.getByTestId("mode-off-full-autonomy")).toHaveText("Not offered: not in the “+” menu, not by Runner, not on this agent’s Start session.");
  await expect(frame.getByTestId("launch-line-full-autonomy")).toHaveCount(0);
  await expect(frame.getByTestId("toast-text")).toContainText("Full autonomy is off for claude-libra");
  await expect.poll(() => readFile(profileOf(sandbox, LIBRA), "utf8"), { message: backend.output() }).toContain("  full-autonomy:\n    enabled: false\n");
  expect(await readFile(profileOf(sandbox, LIBRA), "utf8")).toContain("  normal:\n    enabled: true\n");
  await expect.poll(() => listedModes(pomade, LIBRA)).toEqual(["normal"]);
  await expect(pomade.fake.callApi(ROSTER_LAUNCH_SPEC_METHOD, { agent: LIBRA, mode: "full-autonomy" }, RUNNER)).rejects.toMatchObject({ code: "invalid-params", message: expect.stringContaining("Full autonomy") as unknown });
  expect(await pomade.fake.callApi(ROSTER_LAUNCH_SPEC_METHOD, { agent: LIBRA, mode: "normal" }, RUNNER)).toMatchObject({ line: "claude-libra" });
  await expect.poll(() => heard.length).toBeGreaterThan(0);
  expect(heard.every(isRosterChanged)).toBe(true);
  // Normal cannot be switched off, not even through the API.
  await expect(pomade.fake.callApi("roster.updateProfile", { agent: LIBRA, modes: { normal: false } })).rejects.toMatchObject({ code: "invalid-params" });

  await frame.getByTestId("mode-switch-full-autonomy").click();
  await expect(frame.getByTestId("launch-line-full-autonomy")).toHaveText("claude-libra --dangerously-skip-permissions");
  await expect.poll(() => listedModes(pomade, LIBRA)).toEqual(["normal", "full-autonomy"]);
  expect(await readFile(profileOf(sandbox, LIBRA), "utf8")).toContain("  full-autonomy:\n    enabled: true\n");
});

test("Copy puts a mode's launch line on the clipboard", async ({ page, openShell, pomade, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openModelTab(page, openShell, pomade, LIBRA);
  const frame = frameOf(page);
  await expect(frame.getByTestId("launch-line-full-autonomy")).toHaveText("claude-libra --dangerously-skip-permissions");
  await frame.getByTestId("copy-line-full-autonomy").click();
  await expect(frame.getByTestId("copy-line-full-autonomy")).toHaveAttribute("title", "Copied");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("claude-libra --dangerously-skip-permissions");
});

/** Nothing on the page scrolls sideways, and every row of the tab stays inside the body. */
async function expectContained(page: Page, note: string): Promise<void> {
  const frame = frameOf(page);
  const overflow = await frame.locator("html").evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow, `sideways scroll (${note})`).toBeLessThanOrEqual(0);
  const body = await frame.getByTestId("agent-body").evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(body, `body sideways scroll (${note})`).toBeLessThanOrEqual(0);
  const bodyBox = await frame.getByTestId("agent-body").boundingBox();
  if (bodyBox === null) throw new Error("no body");
  for (const row of await frame.locator('[data-testid^="mode-row-"], [data-testid="model-select"], [data-testid="effort"], [data-testid^="copy-line-"]').all()) {
    const box = await row.boundingBox();
    if (box === null) continue;
    expect(box.x + box.width, `${await row.getAttribute("data-testid")} right (${note})`).toBeLessThanOrEqual(bodyBox.x + bodyBox.width + 0.5);
  }
}

test("screenshots: the folder agent, the built-in claude, codex, an unusable settings.json, Full autonomy off, the menu — at three widths", async ({ page, openShell, pomade, sandbox }) => {
  const sizes = [
    ["wide", 1440],
    ["medium", 1000],
    ["narrow", 600],
  ] as const;
  const frame = frameOf(page);
  /** `open` runs after each resize: a resize closes an open menu. */
  const shoot = async (name: string, open?: () => Promise<void>): Promise<void> => {
    await expect(frame.getByTestId("toast")).toHaveCount(0, { timeout: 6000 });
    for (const [size, width] of sizes) {
      await page.setViewportSize({ width, height: 800 });
      await open?.();
      await expectContained(page, `${name} at ${size}`);
      await page.screenshot({ path: `${ARTIFACTS}/agent-model-${name}-${size}.png` });
    }
  };
  await openModelTab(page, openShell, pomade, LIBRA);
  await expect(frame.getByTestId("launch-line-full-autonomy")).toHaveText(/--dangerously-skip-permissions/);
  await shoot("folder");
  await shoot("menu", async () => {
    await frame.getByTestId("model-select").click();
    await expect(frame.getByTestId("model-menu")).toBeVisible();
  });
  await page.keyboard.press("Escape");
  await frame.getByTestId("mode-switch-full-autonomy").click();
  await expect(frame.getByTestId("toast-text")).toContainText("Full autonomy is off");
  await shoot("autonomy-off");
  await frame.getByTestId("mode-switch-full-autonomy").click();
  await expect(frame.getByTestId("launch-line-full-autonomy")).toBeVisible();
  await expect(frame.getByTestId("toast-text")).toContainText("offered for claude-libra again");

  for (const agent of ["claude", "codex"]) {
    pomade.fake.openAppTab({ projectId: "alpha", route: agentRoute(agent, "model") });
    await expect(frame.getByTestId("agent-name")).toHaveText(agentName(agent));
    await expect(frame.getByTestId("launch-line-full-autonomy")).toHaveText(/dangerously/);
    await shoot(agent === "claude" ? "builtin" : "codex");
  }

  await writeFile(libraSettings(sandbox), "{ not json\n");
  pomade.fake.openAppTab({ projectId: "alpha", route: agentRoute(LIBRA, "model") });
  await expect(frame.getByTestId("model-problem")).toBeVisible({ timeout: 6000 });
  await shoot("unusable");
});
