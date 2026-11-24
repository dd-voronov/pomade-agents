import { expect, test } from "./fixtures.ts";

test("the Agents icon's panel renders Live now with its two buttons", async ({ page, openShell, backend }) => {
  const { panel } = await openShell(page);
  await expect(page.getByTestId("strip-agents")).toHaveAttribute("title", "Agents");
  await expect(panel.getByTestId("live-now-panel")).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Live now" })).toBeVisible();
  await expect(panel.getByTestId("live-now-empty"), backend.output()).toContainText("No agents running");
  await expect(panel.getByRole("button", { name: "Sessions" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Roster" })).toBeVisible();
  await expect(panel.locator("html")).toHaveAttribute("data-surface", "panel");
});

test("the panel opens nothing on its own and sets no badge", async ({ page, openShell, pomade }) => {
  const { panel } = await openShell(page);
  await expect(panel.getByTestId("live-now-panel")).toBeVisible();
  expect(pomade.fake.openedTabs).toEqual([]);
  expect(pomade.fake.badges).toEqual({});
  await expect(page.getByRole("tab")).toHaveCount(0);
});
