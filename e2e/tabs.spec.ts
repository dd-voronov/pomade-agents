import { expect, test } from "./fixtures.ts";

test("Sessions opens the app's tab at Sessions; a second click focuses it instead of opening another", async ({ page, openShell, pomade }) => {
  const { panel, tabFrame } = await openShell(page);
  await panel.getByTestId("open-sessions").click();

  const tab = tabFrame("alpha");
  await expect(tab.getByRole("heading", { name: "Sessions", exact: true })).toBeVisible();
  await expect(tab.getByTestId("view-sessions")).toHaveAttribute("aria-current", "page");
  await expect(tab.locator("html")).toHaveAttribute("data-surface", "tab");
  await expect(page.getByRole("tab")).toHaveCount(1);
  expect(pomade.fake.openedTabs).toEqual([{ kind: "app", projectId: "alpha", route: "sessions" }]);

  await panel.getByTestId("open-sessions").click();
  await expect.poll(() => pomade.fake.openedTabs.length).toBe(2);
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.locator('iframe[data-testid^="tab-frame-"]')).toHaveCount(1);
  await expect(page.getByTestId("tab-alpha")).toHaveAttribute("aria-selected", "true");
  await expect(tab.getByRole("heading", { name: "Sessions", exact: true })).toBeVisible();
});

test("Roster opens the tab at the Roster; a second click focuses it", async ({ page, openShell, pomade }) => {
  const { panel, tabFrame } = await openShell(page);
  await panel.getByTestId("open-roster").click();

  const tab = tabFrame("alpha");
  await expect(tab.getByRole("heading", { name: "Roster" })).toBeVisible();
  await expect(tab.getByTestId("view-roster")).toHaveAttribute("aria-current", "page");
  expect(pomade.fake.openedTabs).toEqual([{ kind: "app", projectId: "alpha", route: "roster" }]);

  await panel.getByTestId("open-roster").click();
  await expect.poll(() => pomade.fake.openedTabs.length).toBe(2);
  await expect(page.locator('iframe[data-testid^="tab-frame-"]')).toHaveCount(1);
  await expect(tab.getByRole("heading", { name: "Roster" })).toBeVisible();
});

test("Sessions and Roster share the project's one tab: Pomade navigates it, the frame stays loaded", async ({ page, openShell }) => {
  const { panel, tabFrame } = await openShell(page);
  await panel.getByTestId("open-sessions").click();
  const tab = tabFrame("alpha");
  await expect(tab.getByRole("heading", { name: "Sessions", exact: true })).toBeVisible();
  await tab.locator("body").evaluate((body) => body.setAttribute("data-kept", "yes"));

  await panel.getByTestId("open-roster").click();
  await expect(tab.getByRole("heading", { name: "Roster" })).toBeVisible();
  await expect(page.locator('iframe[data-testid^="tab-frame-"]')).toHaveCount(1);
  await expect(tab.locator("body")).toHaveAttribute("data-kept", "yes");
});

test("the Sessions | Roster switch moves the tab by itself: the route is recorded, Pomade opens nothing", async ({ page, openShell, pomade }) => {
  const { panel, tabFrame } = await openShell(page);
  await panel.getByTestId("open-sessions").click();
  const tab = tabFrame("alpha");
  await expect(tab.getByRole("heading", { name: "Sessions", exact: true })).toBeVisible();
  await tab.locator("body").evaluate((body) => body.setAttribute("data-kept", "yes"));
  const opened = pomade.fake.openedTabs.length;
  const tabRoute = (): string | undefined => pomade.fake.appTabs.find((t) => t.projectId === "alpha")?.route;

  await tab.getByTestId("view-roster").click();
  await expect(tab.getByRole("heading", { name: "Roster" })).toBeVisible();
  await expect(tab.getByTestId("view-roster")).toHaveAttribute("aria-current", "page");
  await expect.poll(tabRoute).toBe("roster");

  await tab.getByTestId("view-sessions").click();
  await expect(tab.getByRole("heading", { name: "Sessions", exact: true })).toBeVisible();
  await expect(tab.getByTestId("view-sessions")).toHaveAttribute("aria-current", "page");
  await expect.poll(tabRoute).toBe("sessions");
  await expect(tab.locator("body")).toHaveAttribute("data-kept", "yes");
  expect(pomade.fake.openedTabs).toHaveLength(opened);

  // The route stands: a reload of the frame opens it at the Roster.
  await tab.getByTestId("view-roster").click();
  await expect.poll(tabRoute).toBe("roster");
  await page.locator('[data-testid="tab-frame-alpha"]').evaluate((frame: HTMLIFrameElement) => {
    frame.src = frame.src;
  });
  await expect(tab.getByRole("heading", { name: "Roster" })).toBeVisible();
  await expect(tab.locator("body")).not.toHaveAttribute("data-kept", "yes");
});

test("each project gets its own tab", async ({ page, openShell, pomade }) => {
  const { panel, tabFrame } = await openShell(page);
  await panel.getByTestId("open-sessions").click();
  await expect(tabFrame("alpha").getByRole("heading", { name: "Sessions", exact: true })).toBeVisible();

  pomade.fake.setActiveProject("beta");
  await panel.getByTestId("open-roster").click();
  await expect(tabFrame("beta").getByRole("heading", { name: "Roster" })).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.getByTestId("tab-beta")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("tab-alpha")).toHaveAttribute("aria-selected", "false");
});
