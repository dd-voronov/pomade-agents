// Hidden sessions in the Sessions tab through the built backend and the fake Pomade: a transcript
// holding only a `/clear` is not listed, counted, searched or filtered; the header says "1 hidden",
// and clicking it shows the session in its group, dimmed, with a "hidden — no messages" chip, until
// clicked again. Its first message makes it a normal row within ~2 s. Live now lists the agent tab
// that runs it all the same: the tab is real.

import type { FrameLocator, Locator, Page } from "@playwright/test";

import type { FakePomade } from "../harness/fake-pomade.ts";
import type { Sandbox } from "../harness/sandbox.ts";
import { SESSIONS_RENAME_METHOD } from "../src/shared/sessions.ts";
import { expect, test, type Shell } from "./fixtures.ts";
import { claudeSession, clearOnly, projectFolder, prompt, seedIntoProject } from "./transcripts.ts";

const CLEARED = "6a6a6a6a-0000-4000-8000-000000000001";
const TALKED = "6a6a6a6a-0000-4000-8000-000000000002";
/** The seeded Claude, folder-agent and Codex sessions, and the one that talked. */
const SHOWN = 4;
const at = (day: number, hour = 9): string => new Date(Date.UTC(2026, 10, day, hour)).toISOString();

/** The seeded sessions in Alpha, one that talked, and one holding only a `/clear` — the latest. */
async function seed(sandbox: Sandbox): Promise<void> {
  await seedIntoProject(sandbox, "alpha");
  const alpha = projectFolder(sandbox, "alpha");
  await claudeSession(sandbox, TALKED, prompt("Fix the flaky drag spec", at(16), alpha));
  await claudeSession(sandbox, CLEARED, clearOnly(at(20), alpha));
}

async function openSessions(page: Page, openShell: (page: Page) => Promise<Shell>, pomade: FakePomade): Promise<{ shell: Shell; alpha: FrameLocator }> {
  pomade.fake.setActiveProject("alpha");
  const shell = await openShell(page);
  await shell.panel.getByTestId("open-sessions").click();
  return { shell, alpha: shell.tabFrame("alpha") };
}

const row = (frame: FrameLocator, id: string): Locator => frame.locator(`[data-testid="session-row"][data-session-id="${id}"]`);
const rowIds = (frame: FrameLocator): Promise<string[]> =>
  frame.getByTestId("session-row").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-session-id") ?? ""));

test.describe("hidden sessions", () => {
  test.use({ seed: { into: seed }, viewport: { width: 1280, height: 720 } });

  test("a /clear-only session is not listed, counted, searched or filtered; \"1 hidden\" shows it dimmed with its chip, and hides it again", async ({
    page,
    openShell,
    pomade,
    backend,
  }) => {
    // Named, so a search can find it once shown.
    await expect
      .poll(() => pomade.fake.callApi(SESSIONS_RENAME_METHOD, { id: CLEARED, name: "Ghost of a clear" }).then(() => true, () => false), { timeout: 10_000, message: backend.output() })
      .toBe(true);
    const { alpha } = await openSessions(page, openShell, pomade);
    await expect(row(alpha, TALKED)).toBeVisible();
    await expect(row(alpha, CLEARED)).toHaveCount(0);
    expect(await rowIds(alpha)).toHaveLength(SHOWN);
    await expect(alpha.getByTestId("sessions-count")).toHaveAttribute("data-count", String(SHOWN));
    await expect(alpha.getByTestId("group-count-done")).toHaveText(String(SHOWN));
    const toggle = alpha.getByTestId("sessions-hidden");
    await expect(toggle).toHaveText("1 hidden");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    // Not searched, not in the filters' counts.
    const field = alpha.getByTestId("search-field");
    await field.fill("ghost");
    await expect(alpha.getByTestId("sessions-no-match")).toBeVisible();
    await alpha.getByTestId("filter-agent").click();
    await expect(alpha.getByTestId("menu-item-filter-agent-all")).toHaveText("All agents0");
    await page.keyboard.press("Escape");
    await field.fill("");

    // Shown: in its group, dimmed, with the chip; counted in its group, not in the header.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    const hidden = row(alpha, CLEARED);
    await expect(hidden).toHaveAttribute("data-hidden", "empty");
    await expect(alpha.getByTestId("group-done").getByTestId("session-row").first()).toHaveAttribute("data-session-id", CLEARED);
    await expect(hidden.getByTestId("chip-hidden")).toHaveText("hidden — no messages");
    expect(Number(await hidden.locator(":scope > div").first().evaluate((line) => getComputedStyle(line).opacity))).toBeLessThan(1);
    await expect(alpha.getByTestId("group-count-done")).toHaveText(String(SHOWN + 1));
    await expect(alpha.getByTestId("sessions-count")).toHaveAttribute("data-count", String(SHOWN));
    await expect(row(alpha, TALKED)).not.toHaveAttribute("data-hidden");

    // Shown, it is searched, and it opens in the list, dimmed there too.
    await field.fill("ghost");
    await expect.poll(() => rowIds(alpha)).toEqual([CLEARED]);
    await field.fill("");
    await hidden.click();
    await expect(alpha.getByTestId("detail-panel")).toHaveAttribute("data-session-id", CLEARED);
    await expect(row(alpha, CLEARED)).toHaveAttribute("data-hidden", "empty");

    // Hidden again: its row and the panel go.
    await toggle.click();
    await expect(row(alpha, CLEARED)).toHaveCount(0);
    await expect(alpha.getByTestId("detail-panel")).toHaveCount(0);
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(backend.running()).toBe(true);
  });

  test("its first message makes it a normal row within ~2 s, and the header has nothing hidden left", async ({ page, openShell, pomade, sandbox, backend }) => {
    const { alpha } = await openSessions(page, openShell, pomade);
    await expect(row(alpha, TALKED), backend.output()).toBeVisible();
    await expect(alpha.getByTestId("sessions-hidden")).toHaveText("1 hidden");

    await claudeSession(sandbox, CLEARED, prompt("Start over with the roster", at(20, 10), projectFolder(sandbox, "alpha")));
    await expect(row(alpha, CLEARED)).toBeVisible({ timeout: 2_500 });
    await expect(row(alpha, CLEARED)).not.toHaveAttribute("data-hidden");
    await expect(row(alpha, CLEARED).getByTestId("chip-hidden")).toHaveCount(0);
    await expect(row(alpha, CLEARED).getByTestId("session-name")).toHaveText("Start over with the roster");
    await expect(alpha.getByTestId("sessions-hidden")).toHaveCount(0);
    await expect(alpha.getByTestId("sessions-count")).toHaveAttribute("data-count", String(SHOWN + 1));
  });
});

test.describe("a hidden session with an agent tab", () => {
  test.use({
    seed: { into: seed },
    pomadeSeed: { agentTabs: [{ tabId: "tab-cleared", projectId: "alpha", agentId: "claude", sessionId: CLEARED, state: "idle" }] },
  });

  test("Live now lists its tab; the Sessions tab hides it", async ({ page, openShell, pomade, backend }) => {
    const { shell, alpha } = await openSessions(page, openShell, pomade);
    await expect(shell.panel.locator('[data-testid="live-row"][data-tab="tab-cleared"]'), backend.output()).toBeVisible();
    await expect(row(alpha, TALKED)).toBeVisible();
    await expect(row(alpha, CLEARED)).toHaveCount(0);
    await alpha.getByTestId("sessions-hidden").click();
    await expect(row(alpha, CLEARED).getByTestId("live-mark")).toHaveAttribute("data-state", "idle");
  });
});
