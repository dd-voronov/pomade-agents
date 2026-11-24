// The `pomade-agents` command inside a real Pomade: Pomade writes the command's shim into its
// command folder, and an agent running in an agent tab runs `pomade-agents show --json` from its
// terminal's `PATH` — the shim, the tab's `POMADE_TAB_ID`, the socket and the broker all Pomade's —
// and gets the session that tab is bound to. The agent is the stand-in (`STAND_IN_AGENT`), mapped
// onto the fixture folder agent, resumed in its tab through `sessions.open`.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import type { HostClient } from "pomade-kit/sdk";

import { BUILD_DIR, readManifest } from "../../harness/app.ts";
import { createSandbox, type Sandbox } from "../../harness/sandbox.ts";
import { SESSIONS_GET_METHOD, SESSIONS_OPEN_METHOD, type Session } from "../../src/shared/sessions.ts";
import { STAND_IN_AGENT, launchPomade, platformClient, requireBuiltPomade } from "./pomade.ts";

const manifest = readManifest();
const AGENT = "claude-libra";
const SESSION = "5e6f7081-92a3-4b4c-8d5e-6f708192a3b4";

test.describe("the pomade-agents command in Pomade", () => {
  let sandbox: Sandbox;
  let pomadeHome: string;
  let store: string;
  let app: ElectronApplication | null = null;
  let page: Page;
  let host: HostClient | null = null;

  test.beforeAll(async () => {
    requireBuiltPomade();
    sandbox = await createSandbox(manifest.id);
    pomadeHome = join(sandbox.root, "pomade-home");
    store = join(sandbox.workspace, "Agents", AGENT);
    const folder = join(sandbox.workspace, "Projects", "alpha");
    const transcripts = join(store, "projects", folder.replace(/[^a-zA-Z0-9]/g, "-"));
    await mkdir(transcripts, { recursive: true });
    const line = { type: "user", message: { role: "user", content: "Name the tickets" }, origin: { kind: "human" }, promptSource: "typed", timestamp: "2026-11-20T09:00:00.000Z", cwd: folder, sessionId: SESSION };
    await writeFile(join(transcripts, `${SESSION}.jsonl`), `${JSON.stringify(line)}\n`);
    const script = join(sandbox.workspace, "fake-claude.sh");
    await writeFile(script, STAND_IN_AGENT(store), { mode: 0o755 });
    await mkdir(join(sandbox.workspace, ".pomade"), { recursive: true });
    await writeFile(join(sandbox.workspace, ".pomade", "agents.json"), JSON.stringify({ commands: { [AGENT]: script }, hidden: [] }));
    ({ app, page } = await launchPomade(sandbox, [BUILD_DIR], pomadeHome));
    await expect(page.getByTestId("app-shell")).toBeVisible();
    host = await platformClient(sandbox);
  });

  test.afterAll(async () => {
    host?.close();
    await app?.close();
    await sandbox.cleanup();
  });

  test("an agent in its tab runs pomade-agents show --json off PATH and gets that tab's session", async () => {
    const pomade = host ?? (await platformClient(sandbox));
    await expect.poll(() => existsSync(join(pomadeHome, "bin", "pomade-agents")), { timeout: 20_000 }).toBe(true);
    const session = async (): Promise<Session | undefined> => {
      const answer = (await pomade.apps.call(manifest.id, SESSIONS_GET_METHOD, { id: SESSION }).catch(() => null)) as { session?: Session } | null;
      return answer?.session;
    };
    await expect.poll(async () => (await session())?.record?.status, { timeout: 20_000 }).toBe("done");

    const opened = (await pomade.apps.call(manifest.id, SESSIONS_OPEN_METHOD, { id: SESSION }, { timeoutMs: 20_000 })) as { tabId: string };
    await expect(page.getByText(`AGENT_RESUMED ${SESSION}`)).toBeVisible({ timeout: 10_000 });
    await expect.poll(async () => (await session())?.tab?.tabId, { timeout: 10_000 }).toBe(opened.tabId);

    await page.keyboard.type("/show");
    await page.keyboard.press("Enter");
    await expect(page.getByText("AGENT_SHOWED 0")).toBeVisible({ timeout: 15_000 });
    const printed = JSON.parse(await readFile(join(store, "show.json"), "utf8")) as Session;
    expect(printed).toMatchObject({ id: SESSION, tab: { tabId: opened.tabId }, record: { id: SESSION, agent: AGENT, status: "active" } });
  });
});
