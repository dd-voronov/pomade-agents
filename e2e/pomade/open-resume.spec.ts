// Open / Resume inside a real Pomade: a seeded Claude session of the fixture folder agent — Done,
// as the first run adopts it — resumes through `sessions.open` in a new agent tab bound to the
// same session id, and becomes Active; a second open focuses that tab and adds none; once its
// agent quits and hands the tab back to the shell, the session has no tab. The agent is the
// stand-in (`STAND_IN_AGENT`), mapped onto the folder agent (`.pomade/agents.json`), which Pomade
// starts with `--resume <id>`.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import type { HostClient } from "pomade-kit/sdk";

import { BUILD_DIR, readManifest } from "../../harness/app.ts";
import { createSandbox, type Sandbox } from "../../harness/sandbox.ts";
import { ROSTER_AGENTS_METHOD, isRosterAgentsAnswer } from "../../src/shared/roster.ts";
import { SESSIONS_GET_METHOD, SESSIONS_OPEN_METHOD, isSessionsOpenResult, type Session } from "../../src/shared/sessions.ts";
import { STAND_IN_AGENT, launchPomade, platformClient, requireBuiltPomade } from "./pomade.ts";

const manifest = readManifest();
const AGENT = "claude-libra";
const SESSION = "4d5e6f70-8192-4a3b-8c4d-5e6f708192a3";
const PROMPT = "Draft the resume spec";

test.describe("Open / Resume in Pomade", () => {
  let sandbox: Sandbox;
  let app: ElectronApplication | null = null;
  let page: Page;
  let host: HostClient | null = null;

  test.beforeAll(async () => {
    requireBuiltPomade();
    sandbox = await createSandbox(manifest.id);
    const store = join(sandbox.workspace, "Agents", AGENT);
    const folder = join(sandbox.workspace, "Projects", "alpha");
    const transcripts = join(store, "projects", folder.replace(/[^a-zA-Z0-9]/g, "-"));
    await mkdir(transcripts, { recursive: true });
    const line = { type: "user", message: { role: "user", content: PROMPT }, origin: { kind: "human" }, promptSource: "typed", timestamp: "2026-11-20T09:00:00.000Z", cwd: folder, sessionId: SESSION };
    await writeFile(join(transcripts, `${SESSION}.jsonl`), `${JSON.stringify(line)}\n`);
    const script = join(sandbox.workspace, "fake-claude.sh");
    await writeFile(script, STAND_IN_AGENT(store), { mode: 0o755 });
    await mkdir(join(sandbox.workspace, ".pomade"), { recursive: true });
    await writeFile(join(sandbox.workspace, ".pomade", "agents.json"), JSON.stringify({ commands: { [AGENT]: script }, hidden: [] }));
    ({ app, page } = await launchPomade(sandbox, [BUILD_DIR]));
    await expect(page.getByTestId("app-shell")).toBeVisible();
    host = await platformClient(sandbox);
  });

  test.afterAll(async () => {
    host?.close();
    await app?.close();
    await sandbox.cleanup();
  });

  test("a Done session resumes in a new agent tab bound to it and turns Active; Open again focuses that tab; once the agent quits it has no tab", async () => {
    const pomade = host ?? (await platformClient(sandbox));
    await expect
      .poll(async () => {
        const answer = await pomade.apps.call(manifest.id, ROSTER_AGENTS_METHOD, {}).catch(() => null);
        return isRosterAgentsAnswer(answer) ? answer.agents.map((a) => a.id) : [];
      }, { timeout: 20_000 })
      .toContain(AGENT);
    const session = async (): Promise<Session | undefined> => {
      const answer = (await pomade.apps.call(manifest.id, SESSIONS_GET_METHOD, { id: SESSION }).catch(() => null)) as { session?: Session } | null;
      return answer?.session;
    };
    await expect.poll(async () => (await session())?.record?.status, { timeout: 20_000 }).toBe("done");
    expect((await session())?.tab).toBeNull();

    // Resume: Pomade starts the agent with --resume in a new tab, bound to the session.
    const opened = await pomade.apps.call(manifest.id, SESSIONS_OPEN_METHOD, { id: SESSION }, { timeoutMs: 20_000 });
    expect(isSessionsOpenResult(opened)).toBe(true);
    expect(opened).toMatchObject({ opened: "resumed", tabId: expect.any(String) });
    const tabId = (opened as { tabId: string }).tabId;
    await expect(page.getByTestId(`tab-title-${tabId}`)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(`AGENT_RESUMED ${SESSION}`)).toBeVisible({ timeout: 10_000 });
    await expect.poll(async () => (await session())?.tab?.tabId, { timeout: 10_000 }).toBe(tabId);
    await expect.poll(async () => (await session())?.record?.status).toBe("active");

    // Open again: the bound tab is focused; no second tab.
    const tabs = page.locator('[data-testid^="tab-title-"]');
    const count = await tabs.count();
    const again = await pomade.apps.call(manifest.id, SESSIONS_OPEN_METHOD, { id: SESSION });
    expect(again).toMatchObject({ opened: "tab", tabId });
    await expect(tabs).toHaveCount(count);

    // The agent quits and hands the tab back to its shell: the session has no tab any more.
    await page.keyboard.type("/exit");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await session())?.tab ?? null, { timeout: 10_000 }).toBeNull();
  });
});
