// Changing status at scale through the built backend and the fake Pomade: rows checked by their
// checkbox, Cmd+click, Shift+click, Shift+↑↓, Space and Cmd+A; the bulk bar in place of the toolbar
// sets one status on all of them in one `sessions.setStatus`; the row menu (right-click or ⋯) sets
// a row's status, or every checked row's; rows dragged onto a group header (the table) or a status
// tab (the list) take its status; every change — the detail panel's too — shows a toast whose Undo
// sets the earlier statuses back, and then no `session.statusChanged` is published.

import { chmod, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { FrameLocator, Locator, Page } from "@playwright/test";
import type { JsonValue } from "pomade-kit/protocol";

import type { FakePomade } from "../harness/fake-pomade.ts";
import type { Sandbox } from "../harness/sandbox.ts";
import { SESSION_STATUS_CHANGED_EVENT, STATUS_WINDOW_MS } from "../src/shared/session-events.ts";
import { SESSIONS_SET_STATUS_METHOD } from "../src/shared/sessions.ts";
import { expect, test, type Shell } from "./fixtures.ts";
import { answer, claudeSession, projectFolder, prompt } from "./transcripts.ts";

/** Five sessions in Alpha, the newest first. */
const S = Array.from({ length: 5 }, (_, i) => `7a7a7a7a-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
const PROMPTS = ["Release notes for 0.1", "Fix the flaky drag spec", "Port the bulk bar", "Read the G4 grill", "Tidy the tokens"];

async function seedFive(sandbox: Sandbox): Promise<void> {
  const alpha = projectFolder(sandbox, "alpha");
  for (const [i, id] of S.entries()) {
    const at = new Date(Date.UTC(2026, 10, 20 - i, 9)).toISOString();
    await claudeSession(sandbox, id, prompt(PROMPTS[i] ?? "", at, alpha) + answer({ model: "claude-sonnet-5-5", input: 20_000, at, cwd: alpha }));
  }
}

const id = (i: number): string => S[i] as string;

/** Every session has its record (the first run adopted them as Done); all five are made Active. */
async function ready(pomade: FakePomade): Promise<void> {
  const set = (params: JsonValue) => pomade.fake.callApi(SESSIONS_SET_STATUS_METHOD, params);
  await expect.poll(async () => set({ ids: S, status: "active" }).then(() => true, () => false), { timeout: 10_000 }).toBe(true);
}

async function openAlpha(page: Page, openShell: (page: Page) => Promise<Shell>, pomade: FakePomade): Promise<FrameLocator> {
  pomade.fake.setActiveProject("alpha");
  const { panel, tabFrame } = await openShell(page);
  await panel.getByTestId("open-sessions").click();
  const alpha = tabFrame("alpha");
  await expect(alpha.getByTestId("group-count-active")).toHaveText("5");
  return alpha;
}

const row = (frame: FrameLocator, sessionId: string): Locator => frame.locator(`[data-testid="session-row"][data-session-id="${sessionId}"]`);
const check = (frame: FrameLocator, sessionId: string): Locator => row(frame, sessionId).getByTestId("row-check");
const recordFile = (sandbox: Sandbox, appId: string, sessionId: string): string => join(sandbox.workspace, "Apps", appId, "sessions", `${sessionId}.yaml`);
const recordStatus = async (sandbox: Sandbox, appId: string, sessionId: string): Promise<string | undefined> =>
  /^status: (.+)$/m.exec(await readFile(recordFile(sandbox, appId, sessionId), "utf8"))?.[1];

/** The checked rows' ids, top to bottom. */
const checkedRows = (frame: FrameLocator): Promise<string[]> =>
  frame.locator('[data-testid="session-row"][data-checked]').evaluateAll((rows) => rows.map((r) => r.getAttribute("data-session-id") ?? ""));

test.describe("changing status at scale", () => {
  test.use({ seed: { into: seedFive }, viewport: { width: 1280, height: 720 } });

  test("three rows checked → Done in the bulk bar moves all three; Undo moves them back and nothing is published", async ({
    page,
    openShell,
    pomade,
    sandbox,
    manifest,
    backend,
  }) => {
    const heard: JsonValue[] = [];
    pomade.fake.subscribeAs("pomade-runner", SESSION_STATUS_CHANGED_EVENT, heard);
    await ready(pomade);
    // The five changes `ready` made are published once their window ends; from then on, nothing is pending.
    await expect.poll(() => heard.length, { timeout: STATUS_WINDOW_MS + 5000 }).toBe(S.length);
    heard.length = 0;
    const alpha = await openAlpha(page, openShell, pomade);

    // No checks: no bulk bar, the checkboxes hide until a row is hovered.
    await expect(alpha.getByTestId("bulk-bar")).toHaveCount(0);
    await expect(check(alpha, id(0))).toHaveCSS("opacity", "0");
    await row(alpha, id(0)).hover();
    await expect(check(alpha, id(0))).toHaveCSS("opacity", "1");

    await check(alpha, id(0)).click();
    await row(alpha, id(2)).click({ modifiers: ["ControlOrMeta"] });
    await check(alpha, id(3)).click();
    await expect(alpha.getByTestId("detail-panel")).toHaveCount(0);
    expect(await checkedRows(alpha)).toEqual([id(0), id(2), id(3)]);
    // While anything is checked every checkbox shows; the header's is mixed.
    await expect(check(alpha, id(4))).toHaveCSS("opacity", "1");
    await expect(alpha.getByTestId("check-all")).toHaveAttribute("aria-checked", "mixed");
    await expect(alpha.getByTestId("bulk-count")).toHaveText("3 selected");

    await alpha.getByTestId("bulk-status-done").click();
    await expect(alpha.getByTestId("group-count-done")).toHaveText("3");
    await expect(alpha.getByTestId("group-count-active")).toHaveText("2");
    await expect(alpha.getByTestId("bulk-bar")).toHaveCount(0);
    for (const i of [0, 2, 3]) expect(await recordStatus(sandbox, manifest.id, id(i))).toBe("done");
    await expect(alpha.getByTestId("toast-text")).toHaveText("3 sessions → Done");

    await alpha.getByTestId("toast-undo").click();
    await expect(alpha.getByTestId("toast")).toHaveCount(0);
    await expect(alpha.getByTestId("group-count-active")).toHaveText("5");
    for (const i of [0, 2, 3]) await expect.poll(() => recordStatus(sandbox, manifest.id, id(i))).toBe("active");

    // Taken back inside the backend's window: no event for any of them. A change made after the
    // Undo is published once its own window ends, by when theirs have ended too.
    await pomade.fake.callApi(SESSIONS_SET_STATUS_METHOD, { ids: [id(4)], status: "on-hold" });
    await expect.poll(() => heard.length, { timeout: STATUS_WINDOW_MS + 3000 }).toBe(1);
    expect(heard).toEqual([expect.objectContaining({ sessionId: id(4), from: "active", to: "on-hold" })]);
    expect(backend.running()).toBe(true);
  });

  test("Shift+click checks a range, Cmd+A every row shown, Shift+↑↓ and Space from the marked row; Esc clears the checks, then closes the panel", async ({
    page,
    openShell,
    pomade,
    backend,
  }) => {
    await ready(pomade);
    const alpha = await openAlpha(page, openShell, pomade);

    await check(alpha, id(1)).click();
    await row(alpha, id(3)).click({ modifiers: ["Shift"] });
    expect(await checkedRows(alpha)).toEqual([id(1), id(2), id(3)]);
    await expect(alpha.getByTestId("detail-panel")).toHaveCount(0);

    await page.keyboard.press("ControlOrMeta+a");
    expect(await checkedRows(alpha)).toEqual(S);
    await expect(alpha.getByTestId("check-all")).toHaveAttribute("aria-checked", "true");
    await expect(alpha.getByTestId("bulk-count")).toHaveText("5 selected");
    await alpha.getByTestId("check-all").click();
    expect(await checkedRows(alpha)).toEqual([]);
    await expect(alpha.getByTestId("check-all")).toHaveAttribute("aria-checked", "false");

    // The list: Space checks the selected row, Shift+↓ checks on down and moves the selection.
    await row(alpha, id(0)).click();
    await expect(alpha.getByTestId("detail-panel")).toHaveAttribute("data-session-id", id(0));
    await page.keyboard.press("Space");
    expect(await checkedRows(alpha)).toEqual([id(0)]);
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Shift+ArrowDown");
    expect(await checkedRows(alpha)).toEqual([id(0), id(1), id(2)]);
    await expect(alpha.getByTestId("detail-panel")).toHaveAttribute("data-session-id", id(2));
    await expect(alpha.getByTestId("bulk-count")).toHaveText("3 selected");

    // Esc clears the checks first, then closes the panel.
    await page.keyboard.press("Escape");
    await expect(alpha.getByTestId("bulk-bar")).toHaveCount(0);
    await expect(alpha.getByTestId("detail-panel")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(alpha.getByTestId("sessions-table")).toBeVisible();

    // The table: Shift+↑ from the marked row checks upward without opening the panel.
    await page.keyboard.press("Shift+ArrowUp");
    expect(await checkedRows(alpha)).toEqual([id(1), id(2)]);
    await expect(alpha.getByTestId("detail-panel")).toHaveCount(0);
    await expect(row(alpha, id(1))).toHaveAttribute("data-last-selected", "");
    expect(backend.running()).toBe(true);
  });

  test("right-click a row → On hold moves it; ⋯ on a checked row sets the status of every checked row", async ({ page, openShell, pomade, sandbox, manifest, backend }) => {
    await ready(pomade);
    const alpha = await openAlpha(page, openShell, pomade);

    await row(alpha, id(1)).click({ button: "right" });
    const menu = alpha.getByTestId("row-menu");
    await expect(menu.getByTestId("row-menu-head")).toHaveText("Set status");
    await expect(menu.getByTestId("menu-item-status-active")).toHaveAttribute("aria-checked", "true");
    await expect(menu.getByTestId("menu-item-status-on-hold")).toHaveAttribute("aria-checked", "false");
    await menu.getByTestId("menu-item-status-on-hold").click();
    await expect(menu).toHaveCount(0);
    await expect(row(alpha, id(1))).toHaveAttribute("data-status", "on-hold");
    await expect.poll(() => recordStatus(sandbox, manifest.id, id(1))).toBe("on-hold");
    await expect(alpha.getByTestId("toast-text")).toHaveText("“Fix the flaky drag spec” → On hold");

    // Esc closes the menu and leaves the checks.
    await check(alpha, id(2)).click();
    await check(alpha, id(4)).click();
    await row(alpha, id(4)).hover();
    await row(alpha, id(4)).getByTestId("row-more").click();
    await expect(menu.getByTestId("row-menu-head")).toHaveText("Set status · 2 sessions");
    await expect(menu.getByTestId("menu-item-status-done")).not.toHaveAttribute("aria-checked");
    await expect(menu.getByTestId("menu-item-status-active")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(alpha.getByTestId("bulk-count")).toHaveText("2 selected");

    await row(alpha, id(4)).getByTestId("row-more").click();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(row(alpha, id(2))).toHaveAttribute("data-status", "done");
    await expect(row(alpha, id(4))).toHaveAttribute("data-status", "done");
    await expect(alpha.getByTestId("toast-text")).toHaveText("2 sessions → Done");
    await expect(alpha.getByTestId("bulk-bar")).toHaveCount(0);

    // A menu on an unchecked row acts on that row alone.
    await check(alpha, id(0)).click();
    await row(alpha, id(3)).click({ button: "right" });
    await expect(menu.getByTestId("row-menu-head")).toHaveText("Set status");
    await menu.getByTestId("menu-item-status-done-skip").click();
    await expect(row(alpha, id(3))).toHaveAttribute("data-status", "done-skip");
    await expect(row(alpha, id(0))).toHaveAttribute("data-status", "active");
    expect(backend.running()).toBe(true);
  });

  test("two checked rows dragged onto Done–skip/Failed move both; in the list a row dragged onto a status tab moves", async ({ page, openShell, pomade, sandbox, manifest, backend }) => {
    await ready(pomade);
    const alpha = await openAlpha(page, openShell, pomade);

    await check(alpha, id(0)).click();
    await check(alpha, id(3)).click();
    await row(alpha, id(3)).dragTo(alpha.getByTestId("group-head-done-skip"));
    await expect(alpha.getByTestId("group-count-done-skip")).toHaveText("2");
    await expect(row(alpha, id(0))).toHaveAttribute("data-status", "done-skip");
    await expect(row(alpha, id(3))).toHaveAttribute("data-status", "done-skip");
    for (const i of [0, 3]) await expect.poll(() => recordStatus(sandbox, manifest.id, id(i))).toBe("done-skip");
    await expect(alpha.getByTestId("toast-text")).toHaveText("2 sessions → Done–skip/Failed");
    await expect(alpha.getByTestId("bulk-bar")).toHaveCount(0);

    // An unchecked row drags alone, even while others are checked.
    await check(alpha, id(4)).click();
    await row(alpha, id(1)).dragTo(alpha.getByTestId("group-head-on-hold"));
    await expect(row(alpha, id(1))).toHaveAttribute("data-status", "on-hold");
    await expect(row(alpha, id(4))).toHaveAttribute("data-status", "active");
    await check(alpha, id(4)).click();

    await row(alpha, id(2)).click();
    await expect(alpha.getByTestId("list-active").getByTestId("session-row")).toHaveCount(2);
    await row(alpha, id(4)).dragTo(alpha.getByTestId("status-tab-done"));
    await expect(alpha.getByTestId("status-tab-count-done")).toHaveText("1");
    await expect(alpha.getByTestId("list-active").getByTestId("session-row")).toHaveCount(1);
    await expect.poll(() => recordStatus(sandbox, manifest.id, id(4))).toBe("done");
    expect(backend.running()).toBe(true);
  });

  test("the detail panel's status change shows the toast too; Undo puts the session and its tab back", async ({ page, openShell, pomade, sandbox, manifest, backend }) => {
    await ready(pomade);
    const alpha = await openAlpha(page, openShell, pomade);
    await row(alpha, id(0)).click();
    await alpha.getByTestId("status-done").click();
    await expect(alpha.getByTestId("status-tab-done")).toHaveAttribute("aria-selected", "true");
    await expect(alpha.getByTestId("toast-text")).toHaveText("“Release notes for 0.1” → Done");
    await alpha.getByTestId("toast-undo").click();
    await expect(alpha.getByTestId("status-active")).toHaveAttribute("aria-pressed", "true");
    await expect(alpha.getByTestId("status-tab-active")).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => recordStatus(sandbox, manifest.id, id(0))).toBe("active");

    // The toast leaves by itself before the backend's window closes.
    await alpha.getByTestId("status-on-hold").click();
    await expect(alpha.getByTestId("toast")).toBeVisible();
    await expect(alpha.getByTestId("toast")).toHaveCount(0, { timeout: STATUS_WINDOW_MS });
    expect(backend.running()).toBe(true);
  });

  test("a refused bulk change says why in the toast and keeps the checks", async ({ page, openShell, pomade, sandbox, manifest, backend }) => {
    await ready(pomade);
    const alpha = await openAlpha(page, openShell, pomade);
    await check(alpha, id(0)).click();
    await check(alpha, id(1)).click();
    // Record files the backend cannot write.
    const folder = join(sandbox.workspace, "Apps", manifest.id, "sessions");
    await chmod(folder, 0o555);
    try {
      await alpha.getByTestId("bulk-status-on-hold").click();
      const toast = alpha.getByTestId("toast");
      await expect(toast.getByTestId("toast-text")).toHaveText("The status was not changed. The record file could not be written.");
      await expect(toast).toHaveAttribute("title", /could not be written \(EACCES/);
      await expect(toast.getByTestId("toast-undo")).toHaveCount(0);
      await expect(alpha.getByTestId("bulk-count")).toHaveText("2 selected");
      await expect(row(alpha, id(0))).toHaveAttribute("data-status", "active");
      await expect(row(alpha, id(1))).toHaveAttribute("data-status", "active");
    } finally {
      await chmod(folder, 0o755);
    }
    await alpha.getByTestId("bulk-status-on-hold").click();
    await expect(row(alpha, id(0))).toHaveAttribute("data-status", "on-hold");
    await expect(alpha.getByTestId("toast-text")).toHaveText("2 sessions → On hold");
    expect(backend.running()).toBe(true);
  });
});
