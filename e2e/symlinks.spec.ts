// Sessions started through symlinked folders, through the built backend and the fake Pomade: a
// transcript that records its start folder through a symlink into a project shows in that project,
// and "Started in" is relative to the project also when the project's root is itself a symlink
// inside the workspace.

import { mkdir, rename, symlink } from "node:fs/promises";
import { join } from "node:path";

import type { FrameLocator, Page } from "@playwright/test";

import type { FakePomade } from "../harness/fake-pomade.ts";
import type { Sandbox } from "../harness/sandbox.ts";
import { SESSIONS_LIST_METHOD, SESSIONS_SET_STATUS_METHOD, isSessionsAnswer, type Session } from "../src/shared/sessions.ts";
import { expect, test, type Shell } from "./fixtures.ts";
import { claudeSession, projectFolder, prompt } from "./transcripts.ts";

/** Started in Alpha's `docs/`, recorded through a symlink outside the workspace. */
const LINKED = "0c0d0e0f-0000-4000-8000-0000000000a1";
/** Started at Alpha's root, recorded as Alpha's folder with symlinks resolved. */
const AT_ROOT = "0c0d0e0f-0000-4000-8000-0000000000a2";

async function sessionOf(pomade: FakePomade, id: string): Promise<Session | undefined> {
  const listed = await pomade.fake.callApi(SESSIONS_LIST_METHOD).catch(() => null);
  return isSessionsAnswer(listed) ? listed.sessions.find((s) => s.id === id) : undefined;
}

/** The sessions have their records (the first run adopted them as Done) and are made Active. */
async function ready(pomade: FakePomade, ids: string[]): Promise<void> {
  const set = (status: string) => pomade.fake.callApi(SESSIONS_SET_STATUS_METHOD, { ids, status });
  await expect.poll(() => set("done").then(() => true, () => false), { timeout: 10_000 }).toBe(true);
  await set("active");
}

async function openSessions(page: Page, openShell: (page: Page) => Promise<Shell>, pomade: FakePomade, projectId: string): Promise<FrameLocator> {
  pomade.fake.setActiveProject(projectId);
  const { panel, tabFrame } = await openShell(page);
  await panel.getByTestId("open-sessions").click();
  return tabFrame(projectId);
}

const row = (frame: FrameLocator, id: string) => frame.locator(`[data-testid="session-row"][data-session-id="${id}"]`);

test.describe("a start folder recorded through a symlink", () => {
  /** `<sandbox>/alpha-link` leads to Alpha's folder; the transcript records the folder through it. */
  async function seed(sandbox: Sandbox): Promise<void> {
    const alpha = projectFolder(sandbox, "alpha");
    await mkdir(join(alpha, "docs"), { recursive: true });
    const link = join(sandbox.root, "alpha-link");
    await symlink(alpha, link);
    await claudeSession(sandbox, LINKED, prompt("Write the sessions doc", "2026-11-16T09:00:00.000Z", join(link, "docs")));
  }
  test.use({ seed: { into: seed }, viewport: { width: 1280, height: 720 } });

  test("places the session in the project the folder is in, Started in relative to it", async ({ page, openShell, pomade, sandbox, backend }) => {
    await expect
      .poll(async () => (await sessionOf(pomade, LINKED))?.attribution, { timeout: 10_000 })
      .toEqual({ projects: ["alpha"], by: "folder", sharedFolder: false });
    expect((await sessionOf(pomade, LINKED))?.summary.cwd).toBe(join(sandbox.root, "alpha-link", "docs"));
    await ready(pomade, [LINKED]);

    const alpha = await openSessions(page, openShell, pomade, "alpha");
    await row(alpha, LINKED).click();
    await expect(alpha.getByTestId("fact-project")).toHaveText("Alpha");
    await expect(alpha.getByTestId("fact-started-in")).toHaveText("docs/");
    expect(backend.running()).toBe(true);
  });
});

test.describe("a project whose root is a symlink inside the workspace", () => {
  /** Alpha's folder lives outside the workspace, `Projects/alpha` leads to it; the transcripts record
   *  the folder with the symlink resolved, as an agent started there does. */
  async function seed(sandbox: Sandbox): Promise<void> {
    const alpha = projectFolder(sandbox, "alpha");
    const real = join(sandbox.root, "alpha-real");
    await rename(alpha, real);
    await symlink(real, alpha);
    await mkdir(join(real, "docs"), { recursive: true });
    await claudeSession(sandbox, LINKED, prompt("Write the sessions doc", "2026-11-16T09:00:00.000Z", join(real, "docs")));
    await claudeSession(sandbox, AT_ROOT, prompt("Check the context bar thresholds", "2026-11-15T09:00:00.000Z", real));
  }
  test.use({ seed: { into: seed }, viewport: { width: 1280, height: 720 } });

  test("Started in is relative to the project", async ({ page, openShell, pomade, backend }) => {
    await ready(pomade, [LINKED, AT_ROOT]);
    const alpha = await openSessions(page, openShell, pomade, "alpha");
    await row(alpha, LINKED).click();
    await expect(alpha.getByTestId("fact-project")).toHaveText("Alpha");
    await expect(alpha.getByTestId("fact-started-in")).toHaveText("docs/");
    await row(alpha, AT_ROOT).click();
    await expect(alpha.getByTestId("detail-panel")).toHaveAttribute("data-session-id", AT_ROOT);
    await expect(alpha.getByTestId("fact-started-in")).toHaveText("./project root");
    expect(backend.running()).toBe(true);
  });
});
