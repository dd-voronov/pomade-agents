// What every e2e test gets: its own sandbox (temp HOME with copies of the fixture stores, temp
// workspace, temp Pomade user data), its own fake Pomade, and — when it asks for `backend` — the
// built backend running in that sandbox. Nothing here reads or writes outside the sandbox.

import { test as base, expect, type FrameLocator, type Page } from "@playwright/test";

import { BUILT_BACKEND, FIXTURE_PROJECTS, readManifest, type AppManifest } from "../harness/app.ts";
import { spawnBackend, type BackendProcess } from "../harness/backend-process.ts";
import { startFakePomade, type FakePomade } from "../harness/fake-pomade/server.ts";
import { createSandbox, type Sandbox } from "../harness/sandbox.ts";
import { APP_URL, SHELL_URL } from "./ports.ts";

export interface Shell {
  /** The Live now panel's frame. */
  readonly panel: FrameLocator;
  /** The app's tab frame in a project's tab strip. */
  tabFrame(projectId: string): FrameLocator;
}

export interface Seed {
  into(sandbox: Sandbox): Promise<void>;
}

interface Fixtures {
  /** Writes into the sandbox before the backend starts (`test.use({ seed: { into } })`); none by default. */
  seed: Seed | null;
  /** Pomade names the sandbox's workspace through a symlink (`test.use({ workspaceLink: true })`). */
  workspaceLink: boolean;
  manifest: AppManifest;
  sandbox: Sandbox;
  pomade: FakePomade;
  backend: BackendProcess;
  /** Open the fake Pomade's window with the app in it. */
  openShell: (page: Page) => Promise<Shell>;
}

/** The fake Pomade's window, connected to `pomade`, hosting the built app. */
export function shellUrl(pomade: FakePomade): string {
  return `${SHELL_URL}?host=${encodeURIComponent(pomade.shellSocketUrl)}&app=${encodeURIComponent(APP_URL)}`;
}

export function shellOf(page: Page): Shell {
  return {
    panel: page.frameLocator('[data-testid="panel-frame"]'),
    tabFrame: (projectId) => page.frameLocator(`[data-testid="tab-frame-${projectId}"]`),
  };
}

export const test = base.extend<Fixtures>({
  seed: [null, { option: true }],
  workspaceLink: [false, { option: true }],
  manifest: async ({}, use) => {
    await use(readManifest());
  },
  sandbox: async ({ manifest, workspaceLink }, use) => {
    const sandbox = await createSandbox(manifest.id, { workspaceLink });
    await use(sandbox);
    await sandbox.cleanup();
  },
  pomade: async ({ manifest, sandbox }, use) => {
    const pomade = await startFakePomade({
      manifest,
      socketPath: sandbox.socketPath,
      appKey: sandbox.appKey,
      host: { projects: FIXTURE_PROJECTS, activeProject: "alpha", workspaceRoot: sandbox.workspace, pomadeVersion: "0.0.0-e2e" },
    });
    await use(pomade);
    await pomade.close();
  },
  backend: async ({ seed, sandbox, pomade }, use) => {
    if (seed !== null) await seed.into(sandbox);
    const backend = spawnBackend(sandbox, { entry: BUILT_BACKEND });
    await expect.poll(() => pomade.backendCount(), { message: `the backend connects\n${backend.output()}` }).toBe(1);
    await use(backend);
    await backend.stop();
  },
  openShell: async ({ pomade }, use) => {
    await use(async (page) => {
      await page.goto(shellUrl(pomade));
      return shellOf(page);
    });
  },
});

export { expect };
