// Session names are tab names inside a real Pomade: an agent tab's first session is marked unnamed,
// a rename in the app becomes the tab's title on Pomade's tab strip, and the user renaming the tab
// there renames the session. The agent is a zsh stand-in mapped onto the fixture folder agent
// (`.pomade/agents.json`): its first prompt writes a Claude-shaped transcript into the folder
// agent's store, so Pomade binds the session and the backend reads it as from a real CLI.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { connectSocket } from "pomade-kit/node";
import type { HostClient } from "pomade-kit/sdk";

import { BUILD_DIR, readManifest } from "../../harness/app.ts";
import { createSandbox, type Sandbox } from "../../harness/sandbox.ts";
import { ROSTER_AGENTS_METHOD, isRosterAgentsAnswer } from "../../src/shared/roster.ts";
import { SESSIONS_LIST_METHOD, SESSIONS_RENAME_METHOD, isSessionsAnswer, type Session } from "../../src/shared/sessions.ts";
import { launchPomade, requireBuiltPomade } from "./pomade.ts";

const manifest = readManifest();
const AGENT = "claude-libra";
const PROMPT = "Grill the G4 agents design";
/** Screenshots for review land here. */
const ARTIFACTS = new URL("../artifacts", import.meta.url).pathname;

/** A Claude-shaped stand-in: ready at once; the first prompt starts a session in the folder agent's store. */
const FAKE_AGENT = (store: string): string => `#!/bin/zsh
current=""
dir="${store}/projects/\${\${PWD:A}//[^a-zA-Z0-9]/-}"
printf '\\e]0;✳ Claude\\a'
echo AGENT_READY
while IFS= read -r line; do
  if [[ "$line" == "/exit" ]]; then exit 0; fi
  if [[ -z "$current" ]]; then
    current="$(uuidgen | tr A-Z a-z)"
    mkdir -p "$dir"
    print -r -- "{\\"type\\":\\"user\\",\\"message\\":{\\"role\\":\\"user\\",\\"content\\":\\"$line\\"},\\"origin\\":{\\"kind\\":\\"human\\"},\\"promptSource\\":\\"typed\\",\\"timestamp\\":\\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\\",\\"cwd\\":\\"\${PWD:A}\\",\\"sessionId\\":\\"$current\\"}" >> "$dir/$current.jsonl"
  fi
  echo "AGENT_GOT: $line"
done
`;

/** Pomade's own client (the platform key) on the sandbox's Pomade: it calls the app's API. */
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

/** The session whose first message is `text`. */
async function sessionWith(host: HostClient, text: string): Promise<Session | undefined> {
  const answer = await host.apps.call(manifest.id, SESSIONS_LIST_METHOD, {});
  return isSessionsAnswer(answer) ? answer.sessions.find((s) => s.summary.firstMessage?.text === text) : undefined;
}

/** A session's name; `null`: unnamed; `undefined`: no record yet. */
const nameIn = (session: Session | undefined): string | null | undefined => (session?.record ? (session.record.name ?? null) : undefined);

test.describe("names are tab names in Pomade", () => {
  let sandbox: Sandbox;
  let app: ElectronApplication | null = null;
  let page: Page;
  let host: HostClient | null = null;

  test.beforeAll(async () => {
    requireBuiltPomade();
    sandbox = await createSandbox(manifest.id);
    const script = join(sandbox.workspace, "fake-claude.sh");
    await writeFile(script, FAKE_AGENT(join(sandbox.workspace, "Agents", AGENT)), { mode: 0o755 });
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

  test("a rename in the app is the tab's title; the user's tab rename renames the session", async () => {
    const pomade = host ?? (await platformClient(sandbox));
    // The backend answers, its roster with the agent in it, once Pomade started it.
    await expect
      .poll(async () => {
        const answer = await pomade.apps.call(manifest.id, ROSTER_AGENTS_METHOD, {}).catch(() => null);
        return isRosterAgentsAnswer(answer) ? answer.agents.map((a) => a.id) : [];
      }, { timeout: 20_000 })
      .toContain(AGENT);
    // The user starts the agent from the "+" menu and gives it its first prompt.
    await page.getByTestId("tab-add").click();
    const titles = (): Promise<string[]> => page.locator('[data-testid^="tab-title-"]').evaluateAll((els) => els.map((el) => el.getAttribute("data-testid") ?? ""));
    const before = await titles();
    await page.getByTestId(`tab-add-agent-${AGENT}`).click();
    // The agent's tab is the one the "+" menu added.
    let tabId = "";
    await expect.poll(async () => (tabId = (await titles()).find((id) => !before.includes(id))?.replace(/^tab-title-/, "") ?? ""), { timeout: 10_000 }).not.toBe("");
    await expect(page.getByText("AGENT_READY")).toBeVisible({ timeout: 10_000 });
    await page.keyboard.type(PROMPT);
    await page.keyboard.press("Enter");
    const sessionOf = (): Promise<Session | undefined> => sessionWith(pomade, PROMPT);
    await expect.poll(async () => (await sessionOf())?.record?.status, { timeout: 20_000 }).toBe("active");
    const sessionId = (await sessionOf())?.id ?? "";
    const nameOf = async (): Promise<string | null | undefined> => nameIn(await sessionOf());

    // The new session is unnamed: the tab carries the unnamed mark.
    const title = page.getByTestId(`tab-title-${tabId}`);
    await expect(page.getByTestId(`tab-unnamed-${tabId}`)).toBeVisible({ timeout: 10_000 });
    await expect(title).toHaveCSS("font-style", "italic");
    await expect.poll(nameOf).toBeNull();
    await mkdir(ARTIFACTS, { recursive: true });
    await page.getByTestId("tabstrip").screenshot({ path: join(ARTIFACTS, "tab-unnamed.png") });

    // Named in the app → the tab's title.
    await pomade.apps.call(manifest.id, SESSIONS_RENAME_METHOD, { id: sessionId, name: "G4 agents grill" });
    await expect(title).toHaveText("G4 agents grill", { timeout: 2000 });
    await expect(page.getByTestId(`tab-unnamed-${tabId}`)).toHaveCount(0);
    await page.getByTestId("tabstrip").screenshot({ path: join(ARTIFACTS, "tab-named.png") });

    // The user renames the tab → the session.
    await title.dblclick();
    const input = page.getByTestId(`tab-rename-input-${tabId}`);
    await input.fill("G4 tickets");
    await input.press("Enter");
    await expect(title).toHaveText("G4 tickets");
    await expect.poll(nameOf).toBe("G4 tickets");
  });
});
