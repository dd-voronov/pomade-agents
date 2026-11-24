// Live state on the Sessions tab (DESIGN §2.4, §2.7 "Marks") through the built backend and the fake
// Pomade: a session bound to an agent tab shows a round mark — spinner for Working, red dot for
// Needs you, grey dot for Idle, nothing once the agent exits — on its table row and its list row,
// within ~1 s of each change, with "<state> since <time>" as the tooltip; the detail panel says the
// state in words and since when, and a Closed session's last activity.

import type { FrameLocator, Page } from "@playwright/test";

import type { FakePomade } from "../harness/fake-pomade.ts";
import type { Sandbox } from "../harness/sandbox.ts";
import { expect, test, type Shell } from "./fixtures.ts";
import { answer, claudeSession, projectFolder, prompt } from "./transcripts.ts";

/** Bound to the agent tab `tab-live`. */
const LIVE = "0e0f1a2b-0000-4000-8000-000000000001";
/** Not bound to any tab. */
const CLOSED = "0e0f1a2b-0000-4000-8000-000000000002";

/** The live state shows within ~1 s. */
const WITHIN_MS = 1500;

async function seedLive(sandbox: Sandbox): Promise<void> {
  const alpha = projectFolder(sandbox, "alpha");
  await claudeSession(sandbox, LIVE, prompt("Draw the live marks", "2026-11-16T09:00:00.000Z", alpha) + answer({ model: "claude-opus-5-5", input: 20_000, at: "2026-11-16T09:01:00.000Z", cwd: alpha }));
  await claudeSession(sandbox, CLOSED, prompt("Check the closed rows", "2026-11-15T09:00:00.000Z", alpha) + answer({ model: "claude-opus-5-5", input: 20_000, at: "2026-11-15T09:01:00.000Z", cwd: alpha }));
}

async function openAlpha(page: Page, openShell: (page: Page) => Promise<Shell>, pomade: FakePomade): Promise<FrameLocator> {
  pomade.fake.setActiveProject("alpha");
  const { panel, tabFrame } = await openShell(page);
  await panel.getByTestId("open-sessions").click();
  return tabFrame("alpha");
}

const row = (frame: FrameLocator, id: string) => frame.locator(`[data-testid="session-row"][data-session-id="${id}"]`);

test.describe("a session bound to a live agent tab", () => {
  test.use({
    seed: { into: seedLive },
    pomadeSeed: { agentTabs: [{ tabId: "tab-live", projectId: "alpha", agentId: "claude", sessionId: LIVE, state: "working" }] },
  });

  test("its table row shows the spinner, the red dot, the grey dot, then no mark as the tab's state changes; a Closed row shows none", async ({ page, openShell, pomade, backend }) => {
    const alpha = await openAlpha(page, openShell, pomade);
    const mark = row(alpha, LIVE).getByTestId("live-mark");
    await expect(mark, backend.output()).toHaveAttribute("data-state", "working");
    await expect(mark).toHaveAttribute("title", /^Working since \d\d:\d\d$/);
    await expect(row(alpha, CLOSED)).toBeVisible();
    await expect(row(alpha, CLOSED).getByTestId("live-mark")).toHaveCount(0);

    pomade.fake.updateAgentTab("tab-live", { state: "needs-you" });
    await expect(mark).toHaveAttribute("data-state", "needs-you", { timeout: WITHIN_MS });
    await expect(mark).toHaveAttribute("title", /^Needs you since \d\d:\d\d$/);

    pomade.fake.updateAgentTab("tab-live", { state: "idle" });
    await expect(mark).toHaveAttribute("data-state", "idle", { timeout: WITHIN_MS });

    pomade.fake.updateAgentTab("tab-live", { state: "exited" });
    await expect(mark).toHaveCount(0, { timeout: WITHIN_MS });
  });

  test("its list row shows the mark, and the detail panel the state in words and since when; Closed, when it was last active", async ({ page, openShell, pomade, backend }) => {
    const alpha = await openAlpha(page, openShell, pomade);
    await row(alpha, LIVE).click();
    const panel = alpha.getByTestId("detail-panel");
    await expect(panel, backend.output()).toHaveAttribute("data-session-id", LIVE);
    const live = panel.getByTestId("detail-live");
    await expect(live).toHaveAttribute("data-state", "working");
    await expect(live).toHaveText(/^Working· since \d\d:\d\d$/);
    await expect(live.getByTestId("live-mark")).toHaveAttribute("data-state", "working");
    await expect(row(alpha, LIVE).getByTestId("live-mark")).toHaveAttribute("data-state", "working");

    pomade.fake.updateAgentTab("tab-live", { state: "needs-you" });
    await expect(row(alpha, LIVE).getByTestId("live-mark")).toHaveAttribute("data-state", "needs-you", { timeout: WITHIN_MS });
    await expect(live).toHaveText(/^Needs you· since \d\d:\d\d$/, { timeout: WITHIN_MS });

    pomade.fake.updateAgentTab("tab-live", { state: "exited" });
    await expect(row(alpha, LIVE).getByTestId("live-mark")).toHaveCount(0, { timeout: WITHIN_MS });
    await expect(live).toHaveAttribute("data-state", "closed", { timeout: WITHIN_MS });
    await expect(live).toHaveText(/^Closed· last active /);
    await expect(live.getByTestId("live-mark")).toHaveCount(0);
  });
});
