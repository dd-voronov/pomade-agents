// Two projects on one folder, through the built backend and the fake Pomade: a session started in
// the folder from a plain terminal shows in both with the "shared folder" chip; Move to project
// offers both unchecked and pins it to one, where it shows alone, without the chip. Renaming a
// session an agent tab runs says the tab's title follows the name.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { FrameLocator, Locator } from "@playwright/test";

import { FIXTURE_PROJECTS } from "../harness/app.ts";
import { startFakePomade } from "../harness/fake-pomade.ts";
import type { Sandbox } from "../harness/sandbox.ts";
import { SESSIONS_SET_STATUS_METHOD } from "../src/shared/sessions.ts";
import { expect, test as base } from "./fixtures.ts";
import { claudeSession, projectFolder, prompt } from "./transcripts.ts";

const row = (frame: FrameLocator, sessionId: string): Locator => frame.locator(`[data-testid="session-row"][data-session-id="${sessionId}"]`);
const record = (sandbox: Sandbox, appId: string, sessionId: string): Promise<string> =>
  readFile(join(sandbox.workspace, "Apps", appId, "sessions", `${sessionId}.yaml`), "utf8");

const SHARED = "9c9c9c9c-0000-4000-8000-0000000000b1";
const LIVE = "9c9c9c9c-0000-4000-8000-0000000000b2";

/** Alpha twin shares Alpha's folder; an agent tab in Alpha runs `LIVE`. */
const test = base.extend({
  pomade: async ({ manifest, sandbox }, use) => {
    const pomade = await startFakePomade({
      manifest,
      socketPath: sandbox.socketPath,
      appKey: sandbox.appKey,
      host: {
        projects: [...FIXTURE_PROJECTS, { id: "twin", name: "Alpha twin", root: "Projects/alpha" }],
        activeProject: "alpha",
        workspaceRoot: sandbox.workspace,
        pomadeVersion: "0.0.0-e2e",
        agentTabs: [{ tabId: "tab-a", projectId: "alpha", agentId: "claude", sessionId: LIVE, cwd: projectFolder(sandbox, "alpha"), state: "idle" }],
      },
    });
    await use(pomade);
    await pomade.close();
  },
});

test.describe("two projects on one folder", () => {
  async function seed(sandbox: Sandbox): Promise<void> {
    const alpha = projectFolder(sandbox, "alpha");
    await claudeSession(sandbox, SHARED, prompt("From a terminal", "2026-11-20T09:00:00.000Z", alpha));
    await claudeSession(sandbox, LIVE, prompt("From the alpha tab", "2026-11-21T09:00:00.000Z", alpha));
  }
  test.use({ seed: { into: seed }, viewport: { width: 1280, height: 720 } });

  test("a shared-folder session moved to one project shows only there, without the chip; renaming a session an agent tab runs says the tab title follows", async ({
    page,
    openShell,
    pomade,
    sandbox,
    manifest,
    backend,
  }) => {
    // The first run adopted both as Done; both are made Active.
    const set = () => pomade.fake.callApi(SESSIONS_SET_STATUS_METHOD, { ids: [SHARED, LIVE], status: "active" });
    await expect.poll(async () => set().then(() => true, () => false), { timeout: 10_000 }).toBe(true);
    const shell = await openShell(page);
    await shell.panel.getByTestId("open-sessions").click();
    const alpha = shell.tabFrame("alpha");
    await expect(row(alpha, SHARED).getByTestId("chip-shared-folder")).toBeVisible();

    // The session an agent tab runs: the toast says the tab's title follows the name.
    await row(alpha, LIVE).click();
    await alpha.getByTestId("detail-rename").click();
    await alpha.getByTestId("name-input").fill("Alpha tab work");
    await alpha.getByTestId("name-input").press("Enter");
    await expect(alpha.getByTestId("toast-text")).toHaveText("Renamed — the tab title follows: “Alpha tab work”");

    // The shared-folder session shows in both; nothing is checked; moving pins it to Alpha twin.
    await row(alpha, SHARED).click();
    await expect(alpha.getByTestId("marker-shared-folder")).toContainText("Move to project pins it to one.");
    await alpha.getByTestId("detail-move").click();
    const menu = alpha.getByTestId("move-menu");
    await expect(menu.getByTestId("menu-item-move-alpha")).toHaveAttribute("aria-checked", "false");
    await expect(menu.getByTestId("menu-item-move-twin")).toHaveAttribute("aria-checked", "false");
    await menu.getByTestId("menu-item-move-twin").click();
    await expect(row(alpha, SHARED)).toHaveCount(0);
    await expect(alpha.getByTestId("toast-text")).toHaveText("Moved to Alpha twin");
    expect(await record(sandbox, manifest.id, SHARED)).toMatch(/^projectOverride: true$/m);

    pomade.fake.setActiveProject("twin");
    await shell.panel.getByTestId("open-sessions").click();
    const twin = shell.tabFrame("twin");
    await expect(row(twin, SHARED)).toHaveCount(1);
    await expect(row(twin, SHARED).getByTestId("chip-shared-folder")).toHaveCount(0);
    expect(backend.running()).toBe(true);
  });
});
