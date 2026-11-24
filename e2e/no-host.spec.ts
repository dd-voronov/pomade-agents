import { startFakePomade } from "../harness/fake-pomade.ts";
import { expect, shellOf, shellUrl, test } from "./fixtures.ts";
import { APP_URL } from "./ports.ts";

test("opened outside Pomade, the app shows the no-host state", async ({ page }) => {
  await page.goto(APP_URL);
  await expect(page.getByTestId("no-host")).toBeVisible();
  await expect(page.getByRole("heading", { name: "No Pomade host" })).toBeVisible();
  await expect(page.getByTestId("no-host")).toContainText("Open it from the Agents icon in Pomade's left strip.");
  await expect(page.getByTestId("live-now-panel")).toHaveCount(0);
});

test("in a Pomade that speaks a newer Host API, the app says it needs an update", async ({ page, manifest, sandbox }) => {
  const newer = await startFakePomade({ manifest, socketPath: sandbox.socketPath, appKey: sandbox.appKey, host: { hostApi: 1 } });
  try {
    await page.goto(shellUrl(newer));
    await expect(shellOf(page).panel.getByRole("heading", { name: "Agents needs an update" })).toBeVisible();
    await expect(shellOf(page).panel.getByTestId("live-now-panel")).toHaveCount(0);
  } finally {
    await newer.close();
  }
});
