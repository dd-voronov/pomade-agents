// How the surfaces look, in the fake Pomade's window at Pomade's own metrics: screenshots for
// review land in e2e/artifacts/, in a light and a dark system appearance.

import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "./fixtures.ts";
import { APP_URL } from "./ports.ts";

const ARTIFACTS = fileURLToPath(new URL("./artifacts", import.meta.url));
mkdirSync(ARTIFACTS, { recursive: true });

/** `rgb(r, g, b)` of a frame's page background. */
const background = (body: HTMLElement): string => getComputedStyle(body).backgroundColor;

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} appearance`, () => {
    test.use({ colorScheme: scheme, viewport: { width: 1100, height: 640 } });

    test("the panel and each tab view", async ({ page, openShell, backend }) => {
      const { panel, tabFrame } = await openShell(page);
      await expect(panel.getByTestId("backend-status")).toHaveAttribute("data-status", "running");
      expect(backend.running()).toBe(true);
      // The panel sits on Pomade's side-panel background, a tab on its pane background.
      const panelBackground = await panel.locator("body").evaluate(background);
      expect(panelBackground).toBe(scheme === "light" ? "rgb(250, 251, 252)" : "rgb(27, 30, 34)");
      await page.screenshot({ path: `${ARTIFACTS}/panel-${scheme}.png` });

      await panel.getByTestId("open-sessions").click();
      const tab = tabFrame("alpha");
      await expect(tab.getByRole("heading", { name: "Sessions" })).toBeVisible();
      await expect(tab.getByTestId("sessions-count")).toHaveText("3 sessions indexed.");
      expect(await tab.locator("body").evaluate(background)).toBe(scheme === "light" ? "rgb(255, 255, 255)" : "rgb(31, 35, 39)");
      await page.screenshot({ path: `${ARTIFACTS}/sessions-${scheme}.png` });

      await tab.getByTestId("view-roster").click();
      await expect(tab.getByRole("heading", { name: "Roster" })).toBeVisible();
      await page.screenshot({ path: `${ARTIFACTS}/roster-${scheme}.png` });
    });

    test("the panel without a backend, and the no-host state", async ({ page, openShell }) => {
      const { panel } = await openShell(page);
      await expect(panel.getByTestId("backend-status")).toHaveAttribute("data-status", "down");
      await page.screenshot({ path: `${ARTIFACTS}/panel-backend-down-${scheme}.png` });

      await page.goto(APP_URL);
      await expect(page.getByTestId("no-host")).toBeVisible();
      await page.screenshot({ path: `${ARTIFACTS}/no-host-${scheme}.png` });
    });
  });
}
