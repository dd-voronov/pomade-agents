// Naming a session and moving it to another project through the built backend and the fake Pomade:
// the name is renamed in place in the detail panel — from its Rename button, a click on the name,
// F2 or the row menu — Enter or leaving the field saves it through `sessions.rename`, Esc keeps the
// old one and an empty name makes the session unnamed again; Move to project, from the panel's
// button or the row menu, offers every project and the Workspace with the current one checked, a
// session moved out of the tab's project leaves its rows and the panel closes, and Undo brings it
// back. Every change shows a toast. Two projects on one folder: move-shared-folder.spec.ts.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { FrameLocator, Locator, Page } from "@playwright/test";
import type { JsonValue } from "pomade-kit/protocol";

import type { FakePomade } from "../harness/fake-pomade.ts";
import type { Sandbox } from "../harness/sandbox.ts";
import { SESSIONS_SET_STATUS_METHOD } from "../src/shared/sessions.ts";
import { expect, test, type Shell } from "./fixtures.ts";
import { claudeSession, projectFolder, prompt } from "./transcripts.ts";

const S = Array.from({ length: 3 }, (_, i) => `8b8b8b8b-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
const PROMPTS = ["Release notes for 0.1", "Fix the flaky drag spec", "Port the bulk bar"];
const id = (i: number): string => S[i] as string;

async function seedThree(sandbox: Sandbox): Promise<void> {
  const alpha = projectFolder(sandbox, "alpha");
  for (const [i, sessionId] of S.entries()) {
    await claudeSession(sandbox, sessionId, prompt(PROMPTS[i] ?? "", new Date(Date.UTC(2026, 10, 20 - i, 9)).toISOString(), alpha));
  }
}

/** Every session has its record (the first run adopted them as Done); all are made Active. */
async function ready(pomade: FakePomade, ids: readonly string[]): Promise<void> {
  const set = (params: JsonValue) => pomade.fake.callApi(SESSIONS_SET_STATUS_METHOD, params);
  await expect.poll(async () => set({ ids: [...ids], status: "active" }).then(() => true, () => false), { timeout: 10_000 }).toBe(true);
}

async function openSessions(page: Page, openShell: (page: Page) => Promise<Shell>, pomade: FakePomade, projectId: string): Promise<{ shell: Shell; tab: FrameLocator }> {
  pomade.fake.setActiveProject(projectId);
  const shell = await openShell(page);
  await shell.panel.getByTestId("open-sessions").click();
  return { shell, tab: shell.tabFrame(projectId) };
}

const row = (frame: FrameLocator, sessionId: string): Locator => frame.locator(`[data-testid="session-row"][data-session-id="${sessionId}"]`);
const record = (sandbox: Sandbox, appId: string, sessionId: string): Promise<string> =>
  readFile(join(sandbox.workspace, "Apps", appId, "sessions", `${sessionId}.yaml`), "utf8");

test.describe("renaming and moving", () => {
  test.use({ seed: { into: seedThree }, viewport: { width: 1280, height: 720 } });

  test("renames in place: the Rename button, a click on the name, F2 and the row menu; Enter or leaving saves, Esc keeps, empty makes it unnamed", async ({
    page,
    openShell,
    pomade,
    sandbox,
    manifest,
    backend,
  }) => {
    await ready(pomade, S);
    const { tab: alpha } = await openSessions(page, openShell, pomade, "alpha");
    const name = alpha.getByTestId("detail-name");
    const field = alpha.getByTestId("name-input");
    const toast = alpha.getByTestId("toast-text");

    // The Rename button: the name becomes a focused field; Enter saves it.
    await row(alpha, id(0)).click();
    await expect(name).toHaveText("Unnamed session");
    await alpha.getByTestId("detail-rename").click();
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("");
    await field.fill("  Ship the release notes ");
    await field.press("Enter");
    await expect(name).toHaveText("Ship the release notes");
    await expect(name).not.toHaveAttribute("data-unnamed");
    await expect(row(alpha, id(0)).getByTestId("session-name")).toHaveText("Ship the release notes");
    await expect(toast).toHaveText("Renamed to “Ship the release notes”");
    await expect.poll(() => record(sandbox, manifest.id, id(0))).toMatch(/^name: Ship the release notes$/m);

    // F2 opens the field on the name; Esc keeps the name and the panel.
    await page.keyboard.press("F2");
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("Ship the release notes");
    await field.fill("Something else");
    await field.press("Escape");
    await expect(name).toHaveText("Ship the release notes");
    await expect(alpha.getByTestId("detail-panel")).toBeVisible();
    expect(await record(sandbox, manifest.id, id(0))).toMatch(/^name: Ship the release notes$/m);

    // A click on the name; an empty name makes the session unnamed: the first message in grey.
    await name.click();
    await field.fill("");
    await field.press("Enter");
    await expect(name).toHaveText("Unnamed session");
    await expect(name).toHaveAttribute("data-unnamed", "");
    await expect(row(alpha, id(0)).getByTestId("session-name")).toHaveText(PROMPTS[0] ?? "");
    await expect(row(alpha, id(0)).getByTestId("session-name")).toHaveAttribute("data-unnamed", "");
    await expect(toast).toHaveText("Name removed — the session is unnamed again");
    await expect.poll(() => record(sandbox, manifest.id, id(0))).not.toMatch(/^name:/m);

    // The row menu, from the table: the row is selected, its name a field; leaving the field saves.
    await page.keyboard.press("Escape");
    await expect(alpha.getByTestId("detail-panel")).toHaveCount(0);
    await row(alpha, id(1)).click({ button: "right" });
    await expect(alpha.getByTestId("row-menu").getByTestId("menu-item-open")).toBeFocused();
    await alpha.getByTestId("menu-item-rename").click();
    await expect(alpha.getByTestId("detail-panel")).toHaveAttribute("data-session-id", id(1));
    await expect(field).toBeFocused();
    await field.fill("Fix the drag spec");
    await alpha.getByTestId("facts").click();
    await expect(name).toHaveText("Fix the drag spec");
    await expect.poll(() => record(sandbox, manifest.id, id(1))).toMatch(/^name: Fix the drag spec$/m);

    // F2 in the table renames the marked row (the one last selected) in its panel.
    await page.keyboard.press("Escape");
    await expect(alpha.getByTestId("detail-panel")).toHaveCount(0);
    await page.keyboard.press("F2");
    await expect(alpha.getByTestId("detail-panel")).toHaveAttribute("data-session-id", id(1));
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("Fix the drag spec");
    expect(backend.running()).toBe(true);
  });

  test("Move to project: the session leaves Alpha, the panel closes, the toast names the target and Undo brings it back", async ({
    page,
    openShell,
    pomade,
    sandbox,
    manifest,
    backend,
  }) => {
    await ready(pomade, S);
    const { tab: alpha } = await openSessions(page, openShell, pomade, "alpha");
    const menu = alpha.getByTestId("move-menu");

    // The panel's button: every project and the Workspace, Alpha checked.
    await row(alpha, id(0)).click();
    await alpha.getByTestId("detail-move").click();
    await expect(alpha.getByTestId("detail-move")).toHaveAttribute("aria-expanded", "true");
    await expect(menu.locator("[role^='menuitem']")).toHaveText(["Alpha", "Beta", "Workspace (no project)"]);
    await expect(menu.getByTestId("menu-item-move-alpha")).toHaveAttribute("aria-checked", "true");
    await expect(menu.getByTestId("menu-item-move-beta")).toHaveAttribute("aria-checked", "false");
    await menu.getByTestId("menu-item-move-beta").click();

    await expect(row(alpha, id(0))).toHaveCount(0);
    await expect(alpha.getByTestId("detail-panel")).toHaveCount(0);
    await expect(alpha.getByTestId("group-count-active")).toHaveText("2");
    await expect(alpha.getByTestId("toast-text")).toHaveText("Moved to Beta");
    const moved = await record(sandbox, manifest.id, id(0));
    expect(moved).toMatch(/^project: beta$/m);
    expect(moved).toMatch(/^projectOverride: true$/m);

    // Undo: back to its automatic project, Alpha; the panel stays closed.
    await alpha.getByTestId("toast-undo").click();
    await expect(row(alpha, id(0))).toHaveCount(1);
    await expect(alpha.getByTestId("detail-panel")).toHaveCount(0);
    await expect.poll(() => record(sandbox, manifest.id, id(0))).not.toMatch(/^projectOverride:/m);
    expect(await record(sandbox, manifest.id, id(0))).toMatch(/^project: alpha$/m);

    // The row menu: the row is selected and Move to project opens under the panel's button.
    await row(alpha, id(1)).click({ button: "right" });
    await alpha.getByTestId("menu-item-move").click();
    await expect(alpha.getByTestId("detail-panel")).toHaveAttribute("data-session-id", id(1));
    await expect(menu).toBeVisible();
    await expect(menu.getByTestId("menu-item-move-alpha")).toBeFocused();
    // The checked one changes nothing.
    await menu.getByTestId("menu-item-move-alpha").click();
    await expect(menu).toHaveCount(0);
    await expect(alpha.getByTestId("toast")).toHaveCount(0);
    await alpha.getByTestId("detail-move").click();
    await menu.getByTestId("menu-item-move-__workspace__").click();
    await expect(row(alpha, id(1))).toHaveCount(0);
    await expect(alpha.getByTestId("detail-panel")).toHaveCount(0);
    await expect(alpha.getByTestId("toast-text")).toHaveText("Moved to the Workspace");
    const toWorkspace = await record(sandbox, manifest.id, id(1));
    expect(toWorkspace).not.toMatch(/^project:/m);
    expect(toWorkspace).toMatch(/^projectOverride: true$/m);
    expect(backend.running()).toBe(true);
  });
});
