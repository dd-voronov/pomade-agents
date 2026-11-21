// The app inside a real Pomade: dev-linked from its build folder, then installed. It covers what
// only Pomade can show — the strip icon, the panel and tab frames Pomade creates, its broker
// between the panel and the backend, Pomade's own reads of the sessions contract and the roster
// (its "+" menu, and its own scan when the backend does not answer), and the backend's life with
// Pomade's.

import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { SESSIONS_APP_ID, SESSIONS_FOR_REPO_METHOD, SESSIONS_LIVE_IN_METHOD, checkLiveIn, checkRepoSessions } from "pomade-kit/protocol";
import { connectSocket } from "pomade-kit/node";
import type { HostClient } from "pomade-kit/sdk";

import { BUILD_DIR, FIXTURE_AGENTS, readManifest } from "../../harness/app.ts";
import { SEEDED_TRANSCRIPTS, createSandbox, fixtureSnapshots, type Sandbox } from "../../harness/sandbox.ts";
import { readRunRecord } from "../../src/backend/core/run-record.ts";
import { ROSTER_AGENTS_METHOD, isRosterAgentsAnswer } from "../../src/shared/roster.ts";
import { launchPomade, pomadeApps, requireBuiltPomade } from "./pomade.ts";

const manifest = readManifest();
const STRIP_ICON = `strip-app-${manifest.id}-agents`;
const PANEL_FRAME = `[data-testid="panel-frame-app-${manifest.id}-agents"]`;
const TAB_FRAME = `[data-testid="app-frame-${manifest.id}"]`;
/** Screenshots for review land here. */
const ARTIFACTS = fileURLToPath(new URL("../artifacts", import.meta.url));

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Pomade's own client (`pomade-git`'s identity: the platform key) on the sandbox's Pomade. */
async function platformClient(sandbox: Sandbox): Promise<HostClient> {
  const connected = await connectSocket({
    socketPath: sandbox.socketPath,
    appId: "pomade",
    keyFile: join(sandbox.userData, "app-keys", "pomade"),
    role: "command",
    env: {},
  });
  if (connected.status !== "connected") throw new Error(`could not reach Pomade as its platform client: ${connected.status}`);
  return connected.host;
}

test.describe.configure({ mode: "serial" });

test.describe("dev-linked into Pomade", () => {
  let sandbox: Sandbox;
  let app: ElectronApplication | null = null;
  let page: Page;
  let backendPid = 0;

  test.beforeAll(async () => {
    requireBuiltPomade();
    sandbox = await createSandbox(manifest.id);
    ({ app, page } = await launchPomade(sandbox, [BUILD_DIR]));
    await expect(page.getByTestId("app-shell")).toBeVisible();
  });

  test.afterAll(async () => {
    await app?.close();
    if (backendPid !== 0 && alive(backendPid)) process.kill(backendPid, "SIGKILL");
    await sandbox.cleanup();
  });

  test("the Agents icon fills the panel with Live now, and the backend answers through the broker", async () => {
    await expect(page.getByTestId(STRIP_ICON)).toBeVisible();
    await page.getByTestId(STRIP_ICON).click();
    const panel = page.frameLocator(PANEL_FRAME);
    await expect(panel.getByRole("heading", { name: "Live now" })).toBeVisible();
    await expect(panel.getByTestId("backend-status")).toHaveAttribute("data-status", "running", { timeout: 20_000 });
    await expect(panel.getByTestId("backend-version")).toHaveText(`v${manifest.version}`);
    await expect(page.getByTestId(STRIP_ICON)).toHaveAttribute("data-backend-state", "running");

    const record = await readRunRecord(join(sandbox.userData, "app-state", manifest.id));
    expect(record).toMatchObject({ version: manifest.version });
    backendPid = record?.pid ?? 0;
    expect(alive(backendPid)).toBe(true);
  });

  test("Pomade, as the caller pomade, gets well-formed forRepo and liveIn answers", async () => {
    const host = await platformClient(sandbox);
    try {
      const folder = sandbox.workspace;
      const forRepo = await host.apps.call(SESSIONS_APP_ID, SESSIONS_FOR_REPO_METHOD, { folder });
      expect(checkRepoSessions(forRepo)).toEqual((forRepo as { sessions: unknown }).sessions);
      const liveIn = await host.apps.call(SESSIONS_APP_ID, SESSIONS_LIVE_IN_METHOD, { folder });
      expect(checkLiveIn(liveIn)).toEqual({ ok: true, result: liveIn });
      // Pomade's own "agent live here?" joins this app's answer with its terminals.
      expect(await host.agents.liveIn(folder)).toEqual({ live: false, agents: [] });
    } finally {
      host.close();
    }
  });

  test("Sessions and Roster open, focus and navigate the one Agents tab", async () => {
    const panel = page.frameLocator(PANEL_FRAME);
    const tab = page.frameLocator(TAB_FRAME);
    await panel.getByTestId("open-sessions").click();
    await expect(tab.getByRole("heading", { name: "Sessions", exact: true })).toBeVisible();
    await panel.getByTestId("open-sessions").click();
    await expect(page.locator(TAB_FRAME)).toHaveCount(1);

    await panel.getByTestId("open-roster").click();
    await expect(tab.getByRole("heading", { name: "Roster" })).toBeVisible();
    await expect(page.locator(TAB_FRAME)).toHaveCount(1);
    await tab.getByTestId("view-sessions").click();
    await expect(tab.getByRole("heading", { name: "Sessions", exact: true })).toBeVisible();
    await mkdir(ARTIFACTS, { recursive: true });
    await page.screenshot({ path: join(ARTIFACTS, "in-pomade.png") });
  });

  test("the \"+\" menu lists the app's roster; with the backend not answering, Pomade's own scan", async () => {
    const host = await platformClient(sandbox);
    try {
      await expect
        .poll(async () => {
          const answer = await host.apps.call(manifest.id, ROSTER_AGENTS_METHOD, {}).catch(() => null);
          return isRosterAgentsAnswer(answer) ? answer.agents.filter((a) => a.profile !== null).map((a) => a.id) : [];
        })
        .toEqual(FIXTURE_AGENTS);
    } finally {
      host.close();
    }
    // Hidden in the app's roster only: Pomade's own scan still has it.
    const libra = join(sandbox.workspace, "Apps", manifest.id, "agents", "claude-libra", "agent.yaml");
    await writeFile(libra, (await readFile(libra, "utf8")).replace("hidden: false", "hidden: true"));

    const menuItem = (id: string) => page.getByTestId(`tab-add-agent-${id}`);
    await expect
      .poll(async () => {
        await page.getByTestId("tab-add").click();
        await expect(menuItem("claude")).toBeVisible();
        const hidden = (await menuItem("claude-libra").count()) === 0;
        await page.keyboard.press("Escape");
        return hidden;
      }, { message: "the app's roster, with claude-libra hidden, fills the menu" })
      .toBe(true);
    await page.getByTestId("tab-add").click();
    await expect(menuItem("codex")).toBeVisible();
    await mkdir(ARTIFACTS, { recursive: true });
    await page.getByTestId("tab-add-menu").screenshot({ path: join(ARTIFACTS, "plus-menu-app-roster.png") });
    await page.keyboard.press("Escape");

    // The backend stops answering (stopped, not gone): Pomade waits its 1.5 s, then uses its scan.
    process.kill(backendPid, "SIGSTOP");
    try {
      await page.getByTestId("tab-add").click();
      await expect(menuItem("claude-libra")).toBeVisible({ timeout: 10_000 });
      await expect(menuItem("claude")).toBeVisible();
      await expect(menuItem("codex")).toBeVisible();
      await page.getByTestId("tab-add-menu").screenshot({ path: join(ARTIFACTS, "plus-menu-own-scan.png") });
      await page.keyboard.press("Escape");
    } finally {
      process.kill(backendPid, "SIGCONT");
    }
  });

  test("quitting Pomade stops the backend; the stores were never written, and Apps/ holds only the app's settings, session records and agent profiles", async () => {
    await app?.close();
    app = null;
    await expect.poll(() => alive(backendPid), { timeout: 10_000 }).toBe(false);

    const fixtures = await fixtureSnapshots();
    const home = await sandbox.snapshot(sandbox.home);
    for (const [path, hash] of Object.entries(fixtures.home)) expect(home[path], path).toBe(hash);
    const apps = Object.keys(await sandbox.snapshot(join(sandbox.workspace, "Apps")));
    expect(apps.filter((path) => path.startsWith(`${manifest.id}/sessions/`) && path.endsWith(".yaml"))).toHaveLength(Object.keys(SEEDED_TRANSCRIPTS).length);
    expect(apps.filter((path) => !path.startsWith(`${manifest.id}/sessions/`)).sort()).toEqual(
      [...FIXTURE_AGENTS.map((id) => `${manifest.id}/agents/${id}/agent.yaml`), `${manifest.id}/settings.yaml`].sort(),
    );
  });
});

test.describe("installed into Pomade", () => {
  let sandbox: Sandbox;
  let app: ElectronApplication | null = null;
  let page: Page;
  const pids = new Set<number>();

  const backendPid = async (): Promise<number> => {
    const pid = (await readRunRecord(join(sandbox.userData, "app-state", manifest.id)))?.pid ?? 0;
    if (pid !== 0) pids.add(pid);
    return pid;
  };

  test.beforeAll(async () => {
    requireBuiltPomade();
    sandbox = await createSandbox(manifest.id);
    expect(pomadeApps(sandbox, "install", BUILD_DIR)).toContain(`${manifest.name} ${manifest.version} (${manifest.id})`);
    ({ app, page } = await launchPomade(sandbox));
    await expect(page.getByTestId("app-shell")).toBeVisible();
  });

  test.afterAll(async () => {
    await app?.close();
    for (const pid of pids) if (alive(pid)) process.kill(pid, "SIGKILL");
    await sandbox.cleanup();
  });

  test("the backend runs from the installed copy, which has no node_modules", async () => {
    await page.getByTestId(STRIP_ICON).click();
    const panel = page.frameLocator(PANEL_FRAME);
    await expect(panel.getByTestId("backend-status")).toHaveAttribute("data-status", "running", { timeout: 20_000 });
    expect(alive(await backendPid())).toBe(true);
  });

  test("installing a changed build updates the open panel and restarts the backend, without a Pomade restart", async () => {
    const before = await backendPid();
    const changed = join(sandbox.root, "build");
    await cp(BUILD_DIR, changed, { recursive: true });
    const next = { ...manifest, version: "9.9.9" };
    await writeFile(join(changed, "manifest.json"), JSON.stringify(next, null, 2));
    const script = join(changed, "assets", "index.js");
    await writeFile(script, `${await readFile(script, "utf8")}\ndocument.documentElement.dataset.build = "changed";\n`);
    expect(pomadeApps(sandbox, "install", changed)).toContain(`${manifest.name} 9.9.9 (${manifest.id})`);

    const panel = page.frameLocator(PANEL_FRAME);
    await expect(panel.locator("html")).toHaveAttribute("data-build", "changed", { timeout: 20_000 });
    await expect(panel.getByTestId("backend-status")).toHaveAttribute("data-status", "running", { timeout: 20_000 });
    await expect.poll(backendPid, { timeout: 20_000 }).not.toBe(before);
    await expect.poll(() => alive(before), { timeout: 10_000 }).toBe(false);
  });
});
