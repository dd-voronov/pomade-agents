// Session names are tab names, both ways, through the built backend and the fake Pomade's agent
// tabs: a name set in the app is the tab's title within a second; the user renaming the tab renames
// the session, in its record and its row; `/clear` marks the tab unnamed and leaves the old session
// its name; an in-session `/resume` gives the tab the resumed session's name; a tab the user named
// before its first session names that session; and a restored tab shows its session's name.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { AgentTabInfo, JsonValue } from "pomade-kit/protocol";

import { BUILT_BACKEND, FIXTURE_PROJECTS, type AppManifest } from "../harness/app.ts";
import { spawnBackend, type BackendProcess } from "../harness/backend-process.ts";
import { startFakePomade, type FakePomade } from "../harness/fake-pomade.ts";
import type { Sandbox } from "../harness/sandbox.ts";
import { SESSIONS_LIST_METHOD, SESSIONS_RENAME_METHOD, isSessionsAnswer, type Session } from "../src/shared/sessions.ts";
import { expect, shellOf, shellUrl, test } from "./fixtures.ts";
import { claudeSession, projectFolder, prompt } from "./transcripts.ts";

/** The epic's bound for a name to reach the tab. */
const WITHIN_MS = 1000;
const NAMED = "6c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const CLEARED = "7d2e3f4a-5b6c-4d7e-8f0a-1b2c3d4e5f6a";
const FIRST = "8e3f4a5b-6c7d-4e8f-9a1b-2c3d4e5f6a7b";

/** A moment after now: a session started after the first run. */
const soon = (): string => new Date(Date.now() + 1000).toISOString();

async function sessionOf(pomade: FakePomade, id: string): Promise<Session | undefined> {
  const answer = await pomade.fake.callApi(SESSIONS_LIST_METHOD).catch(() => null);
  return isSessionsAnswer(answer) ? answer.sessions.find((s) => s.id === id) : undefined;
}

const nameOf = async (pomade: FakePomade, id: string): Promise<string | null | undefined> => {
  const session = await sessionOf(pomade, id);
  return session?.record === undefined || session.record === null ? undefined : (session.record.name ?? null);
};

const tabOf = (pomade: FakePomade, tabId: string): Pick<AgentTabInfo, "title" | "titleSource" | "unnamed"> | undefined => {
  const tab = pomade.fake.agentTabs.find((t) => t.tabId === tabId);
  return tab && { title: tab.title, titleSource: tab.titleSource, unnamed: tab.unnamed };
};

const rename = (pomade: FakePomade, id: string, name: string | null): Promise<unknown> => pomade.fake.callApi(SESSIONS_RENAME_METHOD, { id, name } as JsonValue);

async function fakePomade(sandbox: Sandbox, manifest: AppManifest, agentTabs: { tabId: string; sessionId?: string }[]): Promise<FakePomade> {
  return startFakePomade({
    manifest,
    socketPath: sandbox.socketPath,
    appKey: sandbox.appKey,
    host: {
      projects: FIXTURE_PROJECTS,
      activeProject: "alpha",
      workspaceRoot: sandbox.workspace,
      agentTabs: agentTabs.map((t) => ({ projectId: "alpha", agentId: "claude", cwd: projectFolder(sandbox, "alpha"), ...t })),
    },
  });
}

async function connected(pomade: FakePomade, sandbox: Sandbox): Promise<BackendProcess> {
  const backend = spawnBackend(sandbox, { entry: BUILT_BACKEND, pomade });
  await expect.poll(() => pomade.backendCount(), { message: backend.output() }).toBe(1);
  return backend;
}

test("a name set in the app is the tab's title; the user's tab rename renames the session; /clear marks the tab unnamed; /resume and a restored tab show the name", async ({ page, sandbox, manifest }) => {
  const alpha = projectFolder(sandbox, "alpha");
  await claudeSession(sandbox, NAMED, prompt("Grill the G4 agents design", soon(), alpha));
  let pomade = await fakePomade(sandbox, manifest, [{ tabId: "tab-a", sessionId: NAMED }]);
  let backend = await connected(pomade, sandbox);
  try {
    // An unnamed session's tab carries the unnamed mark.
    await expect.poll(() => tabOf(pomade, "tab-a"), { message: backend.output() }).toEqual({ title: "Claude", titleSource: "default", unnamed: true });

    // Named in the app → the tab's title, within a second.
    await expect.poll(() => nameOf(pomade, NAMED)).toBeNull();
    const asked = Date.now();
    await rename(pomade, NAMED, "G4 agents grill");
    await expect.poll(() => tabOf(pomade, "tab-a"), { timeout: WITHIN_MS }).toEqual({ title: "G4 agents grill", titleSource: "app", unnamed: false });
    expect(Date.now() - asked).toBeLessThan(WITHIN_MS);

    // The user renames the tab → the session, its record and its row.
    await page.goto(shellUrl(pomade));
    const shell = shellOf(page);
    await shell.panel.getByTestId("open-sessions").click();
    const row = shell.tabFrame("alpha").locator(`[data-testid="session-row"][data-session-id="${NAMED}"]`);
    await expect(row).toContainText("G4 agents grill");
    pomade.fake.renameAgentTab("tab-a", "G4 tickets");
    await expect(row).toContainText("G4 tickets");
    expect(await nameOf(pomade, NAMED)).toBe("G4 tickets");
    expect(await readFile(join(sandbox.workspace, "Apps", manifest.id, "sessions", `${NAMED}.yaml`), "utf8")).toContain("name: G4 tickets");
    expect(tabOf(pomade, "tab-a")).toEqual({ title: "G4 tickets", titleSource: "user", unnamed: false });

    // /clear: a new session in the same tab — unnamed and Active, the tab marked unnamed; the old one keeps its name.
    await claudeSession(sandbox, CLEARED, prompt("Start over", soon(), alpha));
    pomade.fake.updateAgentTab("tab-a", { sessionId: CLEARED });
    await expect.poll(() => tabOf(pomade, "tab-a")).toEqual({ title: "Claude", titleSource: "default", unnamed: true });
    expect(await sessionOf(pomade, CLEARED)).toMatchObject({ record: { status: "active" } });
    expect(await nameOf(pomade, CLEARED)).toBeNull();
    expect(await nameOf(pomade, NAMED)).toBe("G4 tickets");
    const cleared = shell.tabFrame("alpha").locator(`[data-testid="session-row"][data-session-id="${CLEARED}"]`);
    await expect(cleared.locator("[data-unnamed]")).toHaveText("Start over");
    await expect(row).toContainText("G4 tickets");

    // An in-session /resume of the named session: the tab shows its name.
    pomade.fake.updateAgentTab("tab-a", { sessionId: NAMED });
    await expect.poll(() => tabOf(pomade, "tab-a")).toEqual({ title: "G4 tickets", titleSource: "app", unnamed: false });

    // Pomade restarts: the restored tab, at its default title, shows the session's name again.
    expect((await backend.stop()).code).toBe(0);
    await pomade.close();
    pomade = await fakePomade(sandbox, manifest, [{ tabId: "tab-a", sessionId: NAMED }]);
    expect(tabOf(pomade, "tab-a")).toEqual({ title: "Claude", titleSource: "default", unnamed: false });
    backend = await connected(pomade, sandbox);
    await expect.poll(() => tabOf(pomade, "tab-a"), { message: backend.output() }).toEqual({ title: "G4 tickets", titleSource: "app", unnamed: false });
  } finally {
    await backend.stop();
    await pomade.close();
  }
});

test("a tab the user named before its first session names that session; removing a name marks the tab unnamed", async ({ sandbox, manifest }) => {
  const pomade = await fakePomade(sandbox, manifest, [{ tabId: "tab-b" }]);
  const backend = await connected(pomade, sandbox);
  try {
    await expect.poll(() => pomade.fake.subscriptions, { message: backend.output() }).toContain("agentTab.changed");
    pomade.fake.renameAgentTab("tab-b", "Spike");
    await claudeSession(sandbox, FIRST, prompt("Try the idea", soon(), projectFolder(sandbox, "alpha")));
    pomade.fake.updateAgentTab("tab-b", { sessionId: FIRST });
    await expect.poll(() => nameOf(pomade, FIRST), { message: backend.output() }).toBe("Spike");
    expect(tabOf(pomade, "tab-b")).toEqual({ title: "Spike", titleSource: "user", unnamed: false });

    await rename(pomade, FIRST, null);
    await expect.poll(() => tabOf(pomade, "tab-b"), { timeout: WITHIN_MS }).toEqual({ title: "Claude", titleSource: "default", unnamed: true });
  } finally {
    await backend.stop();
    await pomade.close();
  }
});
