// A re-linked agent keeps its sessions (T-036): a session's agent is the agent whose profile holds
// its store. The agent folder is renamed outside the app while it runs; the renamed folder is an
// agent of its own and holds the sessions until the orphan is re-linked to it — then the agent's card
// shows the last activity and counts it had, and the Sessions tab's Agent filter names it once,
// under its id. The re-link's Undo gives the sessions back to the folder's own agent.
// `RELINK_SESSION_SHOTS=<folder>` also writes screenshots of the re-linked card and the Agent filter.

import { mkdirSync } from "node:fs";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { FrameLocator, Locator, Page } from "@playwright/test";
import { providerModes, type RosterAgent } from "pomade-kit/protocol";

import type { Sandbox } from "../harness/sandbox.ts";
import { expect, test, type Shell } from "./fixtures.ts";
import { ROSTER_PROJECTS, agentSession } from "./roster-fixtures.ts";

const SHOTS = process.env.RELINK_SESSION_SHOTS;
if (SHOTS !== undefined) mkdirSync(SHOTS, { recursive: true });

async function shoot(page: Page, name: string): Promise<void> {
  if (SHOTS !== undefined) await page.screenshot({ path: join(SHOTS, `T-036-${name}.png`) });
}

const AGENT = "claude-writer";
const RENAMED = "claude-writer-v2";
const HOUR = 3_600_000;
/** The agent's sessions: three in pomade-agents within hours, one in Tax 2026 two days ago. */
const SESSIONS: readonly [project: string, agoMs: number][] = [
  ["agents", 0],
  ["agents", 3 * HOUR],
  ["agents", 6 * HOUR],
  ["tax", 48 * HOUR],
];

async function seed(sandbox: Sandbox): Promise<void> {
  const folder = join(sandbox.workspaceReal, "Agents", AGENT);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "CLAUDE.md"), "# writer\n\n## Role\n\nDrafts essays and posts in the Owner's voice.\n");
  for (const [i, [project, ago]] of SESSIONS.entries()) await agentSession(sandbox, AGENT, project, ago, `draft ${i + 1}`);
}

const ROSTER: RosterAgent[] = ["claude", AGENT, RENAMED].map((id) => ({ id, name: id, command: id, provider: "claude", modes: providerModes("claude") }));

test.use({ seed: { into: seed }, pomadeSeed: { projects: ROSTER_PROJECTS, activeProject: "agents", roster: ROSTER }, viewport: { width: 1600, height: 1000 } });

async function openRoster(page: Page, openShell: (page: Page) => Promise<Shell>): Promise<{ shell: Shell; roster: FrameLocator }> {
  const shell = await openShell(page);
  await shell.panel.getByTestId("open-roster").click();
  return { shell, roster: shell.tabFrame("agents") };
}

/** What the agent's card says of its sessions: the last activity and this week's count. */
const activity = async (roster: FrameLocator, agent: string): Promise<[string, string]> => [
  (await roster.getByTestId(`agent-last-${agent}`).textContent()) ?? "",
  (await roster.getByTestId(`agent-week-${agent}`).textContent()) ?? "",
];

/** The `agent` of the agent's session records: those whose transcript is in its folder, renamed or not. */
const recordAgents = async (sandbox: Sandbox): Promise<string[]> => {
  const folder = join(sandbox.workspace, "Apps", "pomade-agents", "sessions");
  const files = (await readdir(folder).catch(() => [])).filter((name) => name.endsWith(".yaml"));
  const texts = await Promise.all(files.map((name) => readFile(join(folder, name), "utf8")));
  return texts
    .filter((text) => /^transcript: .*\/Agents\/claude-writer(-v2)?\//m.test(text))
    .map((text) => /^agent: (.+)$/m.exec(text)?.[1] ?? "")
    .sort();
};

/** Renames the agent's folder outside the app, and waits for the roster to see the orphan and the new folder's agent. */
async function renameFolder(sandbox: Sandbox, roster: FrameLocator): Promise<void> {
  await rename(join(sandbox.workspaceReal, "Agents", AGENT), join(sandbox.workspaceReal, "Agents", RENAMED));
  await expect(roster.getByTestId(`agent-card-${AGENT}`).getByTestId("chip-orphan")).toBeVisible();
  await expect(roster.getByTestId(`agent-card-${RENAMED}`)).toBeVisible();
}

async function relink(roster: FrameLocator): Promise<void> {
  await roster.getByTestId(`agent-relink-${AGENT}`).click();
  await roster.getByTestId("relink-menu").getByTestId(`menu-item-relink-${RENAMED}`).click();
  await expect(roster.getByTestId("toast-text")).toHaveText(`${AGENT} now points at Agents/${RENAMED}. It is back in the “+” menu.`);
}

/** The Agent filter's entry for `agent`. */
const agentItem = (frame: FrameLocator, agent: string): Locator => frame.locator(`[data-testid="menu-item-filter-agent-${agent}"]`);

test("re-linking the orphan to its renamed folder gives it back its sessions: the card's last activity and counts, the Agent filter under its id, the records", async ({ page, openShell, sandbox, backend }) => {
  const { shell, roster } = await openRoster(page, openShell);
  await expect(roster.getByTestId(`agent-last-${AGENT}`), backend.output()).toHaveText("now");
  const before = await activity(roster, AGENT);
  expect(before[1]).toMatch(/^\d+ sessions?/);
  await expect.poll(() => recordAgents(sandbox)).toEqual(SESSIONS.map(() => AGENT));

  // Renamed outside the app: the folder's own agent holds the sessions; the orphan has none.
  await renameFolder(sandbox, roster);
  await expect(roster.getByTestId(`agent-last-${RENAMED}`)).toHaveText("now");
  expect(await activity(roster, RENAMED)).toEqual(before);

  await relink(roster);
  await expect(roster.getByTestId(`agent-card-${RENAMED}`)).toHaveCount(0);
  await expect(roster.getByTestId(`agent-last-${AGENT}`)).toHaveText("now");
  expect(await activity(roster, AGENT)).toEqual(before);
  await shoot(page, "relinked-card");
  await expect.poll(() => recordAgents(sandbox)).toEqual(SESSIONS.map(() => AGENT));

  // The Sessions action's preset, and the Agent filter: the agent once, under its id, with all its sessions.
  await roster.getByTestId(`agent-sessions-${AGENT}`).click();
  const sessions = shell.tabFrame("__workspace__");
  await expect(sessions.getByTestId("filter-agent")).toHaveText(AGENT);
  await expect(sessions.getByTestId("session-row")).toHaveCount(SESSIONS.length);
  await sessions.getByTestId("filter-agent").click();
  await expect(agentItem(sessions, AGENT)).toHaveCount(1);
  await expect(agentItem(sessions, AGENT)).toContainText(String(SESSIONS.length));
  await expect(agentItem(sessions, RENAMED)).toHaveCount(0);
  await shoot(page, "agent-filter");
});

test("the re-link's Undo gives the sessions back to the renamed folder's own agent", async ({ page, openShell, sandbox, backend }) => {
  const { roster } = await openRoster(page, openShell);
  await expect(roster.getByTestId(`agent-last-${AGENT}`), backend.output()).toHaveText("now");
  const before = await activity(roster, AGENT);
  await renameFolder(sandbox, roster);
  await expect(roster.getByTestId(`agent-last-${RENAMED}`)).toHaveText("now");

  await relink(roster);
  await expect(roster.getByTestId(`agent-last-${AGENT}`)).toHaveText("now");
  await roster.getByTestId("toast-undo").click();
  await expect(roster.getByTestId("toast-text")).toHaveText(`Re-link taken back: ${AGENT} is an orphan again, Agents/${RENAMED} an agent of its own.`);
  await expect(roster.getByTestId(`agent-card-${AGENT}`).getByTestId("chip-orphan")).toBeVisible();
  await expect(roster.getByTestId(`agent-last-${RENAMED}`)).toHaveText("now");
  expect(await activity(roster, RENAMED)).toEqual(before);
  await expect.poll(() => recordAgents(sandbox)).toEqual(SESSIONS.map(() => RENAMED));
});
