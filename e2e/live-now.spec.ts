// The Live now panel (DESIGN §2.8): every agent tab that runs an agent, across projects, grouped by
// project with the active one first and tagged "current"; two-line rows ordered Needs you →
// Working → Idle; a click focuses the tab and Pomade switches to its project. The Agents icon's
// badge counts the Needs you rows — set by the backend, so it is right before the panel was ever
// opened — and clears when none is left. A Runner agent run is a ⏱ row with its job's name from its
// run started to its run finished; a click opens its attached terminal tab in its project.

import type { JsonValue } from "pomade-kit/protocol";

import { RUN_FINISHED_EVENT, RUN_STARTED_EVENT, type AgentRunStarted } from "../src/shared/runner-events.ts";
import { SESSIONS_RENAME_METHOD } from "../src/shared/sessions.ts";
import { expect, test } from "./fixtures.ts";
import { claudeSession, projectFolder, prompt } from "./transcripts.ts";

const NAMED = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const UNNAMED = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
const minutesAgo = (n: number): string => new Date(Date.now() - n * 60_000).toISOString();

test.describe("with agents running in two projects and the Workspace", () => {
  test.use({
    seed: {
      async into(sandbox) {
        await claudeSession(sandbox, NAMED, prompt("Write the G4 tickets", minutesAgo(30)));
        await claudeSession(sandbox, UNNAMED, prompt("why does the side panel flicker when I drag the divider", minutesAgo(20)));
      },
    },
    pomadeSeed: {
      agentTabs: [
        { tabId: "tab-idle", projectId: "alpha", agentId: "claude", sessionId: UNNAMED, state: "idle" },
        { tabId: "tab-named", projectId: "alpha", agentId: "claude", sessionId: NAMED, state: "needs-you" },
        { tabId: "tab-fresh", projectId: "alpha", agentId: "codex", sessionId: null, state: "working" },
        { tabId: "tab-beta", projectId: "beta", agentId: "codex", sessionId: null, state: "idle" },
        { tabId: "tab-ws", projectId: "__workspace__", agentId: "claude", sessionId: null, state: "working" },
        { tabId: "tab-exited", projectId: "beta", agentId: "claude", sessionId: null, state: "exited" },
      ],
    },
  });

  test("the badge counts Needs you from the start, before the panel was ever opened, and clears when none is left", async ({ pomade, backend }) => {
    await expect.poll(() => pomade.fake.badges, { message: backend.output() }).toEqual({ agents: { count: 1, urgent: true } });
    pomade.fake.updateAgentTab("tab-beta", { state: "needs-you" });
    await expect.poll(() => pomade.fake.badges).toEqual({ agents: { count: 2, urgent: true } });
    pomade.fake.updateAgentTab("tab-named", { state: "idle" });
    pomade.fake.updateAgentTab("tab-beta", { state: "working" });
    await expect.poll(() => pomade.fake.badges).toEqual({});
  });

  test("lists them grouped by project, the current one first, Needs you → Working → Idle, and follows the project in front", async ({ page, openShell, pomade, backend }) => {
    await expect
      .poll(() => pomade.fake.callApi(SESSIONS_RENAME_METHOD, { id: NAMED, name: "G4 tickets" }).then(() => true, () => false), { message: backend.output() })
      .toBe(true);
    const { panel } = await openShell(page);

    await expect(panel.getByTestId("live-now-count")).toHaveText("5 running · 1 needs you");
    const groups = panel.getByTestId("live-group");
    await expect(panel.getByTestId("live-group-head")).toHaveText(["Alphacurrent3", "Beta1", "Workspace1"]);

    const alpha = groups.nth(0);
    const names = alpha.getByTestId("live-row-name");
    await expect(names).toHaveText(["G4 tickets", "Codex", "why does the side panel flicker when I drag the divider"]);
    await expect(names.nth(0)).not.toHaveAttribute("data-unnamed");
    await expect(names.nth(2)).toHaveAttribute("data-unnamed", "true");
    await expect(alpha.getByTestId("live-row-state")).toHaveText(["Needs you", "Working", "Idle"]);
    await expect(alpha.getByTestId("live-row-agent")).toHaveText(["claude", "codex", "claude"]);
    await expect(alpha.getByTestId("live-row-since").first()).toHaveText(/^(now|\d+m)$/);
    expect(await alpha.getByTestId("live-mark").evaluateAll((marks) => marks.map((m) => m.getAttribute("data-state")))).toEqual(["needs-you", "working", "idle"]);

    pomade.fake.setActiveProject("beta");
    await expect(panel.getByTestId("live-group-head")).toHaveText(["Betacurrent1", "Alpha3", "Workspace1"]);

    // The agent in one tab exits: its row goes; another comes back to life: its row comes.
    pomade.fake.updateAgentTab("tab-fresh", { state: "exited" });
    pomade.fake.updateAgentTab("tab-exited", { state: "idle" });
    await expect(panel.getByTestId("live-group-head")).toHaveText(["Betacurrent2", "Alpha2", "Workspace1"]);
    await expect(panel.getByTestId("live-now-count")).toHaveText("5 running · 1 needs you");
  });

  test("a row's click focuses its tab and Pomade switches to its project; a group header's focuses that group's first tab", async ({ page, openShell, pomade, backend }) => {
    const { panel } = await openShell(page);
    await expect(panel.getByTestId("live-row"), backend.output()).toHaveCount(5);

    await panel.locator('[data-testid="live-row"][data-tab="tab-ws"]').click();
    await expect.poll(() => pomade.fake.focusedAgentTabs).toEqual(["tab-ws"]);
    expect(pomade.fake.activeProject.id).toBe("__workspace__");
    await expect(panel.getByTestId("live-group-current")).toHaveCount(1);
    await expect(panel.locator('[data-testid="live-group"][data-project="__workspace__"]').getByTestId("live-group-current")).toBeVisible();

    await panel.locator('[data-testid="live-group"][data-project="alpha"]').getByTestId("live-group-head").click();
    await expect.poll(() => pomade.fake.focusedAgentTabs).toEqual(["tab-ws", "tab-named"]);
    expect(pomade.fake.activeProject.id).toBe("alpha");
    expect(pomade.fake.openedTabs).toEqual([]);
  });
});

test("nothing running: \"No agents running\", no count, no badge", async ({ page, openShell, pomade, backend }) => {
  const { panel } = await openShell(page);
  await expect(panel.getByTestId("live-now-empty"), backend.output()).toContainText("No agents running");
  await expect(panel.getByTestId("live-now-count")).toHaveText("");
  expect(pomade.fake.badges).toEqual({});
});

test.describe("an agent tab that comes to life", () => {
  test.use({ pomadeSeed: { agentTabs: [{ tabId: "tab-later", projectId: "beta", agentId: "claude", sessionId: null, state: "exited" }] } });

  test("shows up as a row with the agent's name, and the empty state goes", async ({ page, openShell, pomade, backend }) => {
    const { panel } = await openShell(page);
    await expect(panel.getByTestId("live-now-empty"), backend.output()).toBeVisible();
    pomade.fake.updateAgentTab("tab-later", { state: "working" });
    await expect(panel.getByTestId("live-row-name")).toHaveText(["Claude"]);
    await expect(panel.getByTestId("live-now-empty")).toHaveCount(0);
    await expect(panel.getByTestId("live-now-count")).toHaveText("1 running");
  });
});

test.describe("an unattended run", () => {
  test.use({ pomadeSeed: { agentTabs: [{ tabId: "tab-alpha", projectId: "alpha", agentId: "claude", sessionId: null, state: "needs-you" }] } });

  test("is a ⏱ row with its job's name while it runs; a click opens its attached terminal in its project; run finished takes it away", async ({ page, openShell, pomade, sandbox, backend }) => {
    await expect.poll(() => pomade.fake.subscriptions, { message: backend.output() }).toEqual(expect.arrayContaining([RUN_STARTED_EVENT, RUN_FINISHED_EVENT]));
    const run: AgentRunStarted = {
      job: "reviews/nightly",
      name: "Nightly review",
      run: "20261124-030000-a1b2c3",
      kind: "agent",
      folder: "Projects/beta",
      project: "beta",
      trigger: "schedule",
      sessionId: null,
      agent: "codex",
      mode: "auto",
      cwd: projectFolder(sandbox, "beta"),
      startedByRunner: true,
      startedAt: new Date().toISOString(),
      terminal: "run:reviews.nightly:20261124-030000-a1b2c3",
    };
    const { panel } = await openShell(page);
    await expect(panel.getByTestId("live-row")).toHaveCount(1);
    pomade.fake.emitEvent(RUN_STARTED_EVENT, run as JsonValue);

    const row = panel.locator('[data-testid="live-row"][data-run="20261124-030000-a1b2c3"]');
    await expect(row.getByTestId("live-row-name")).toHaveText("Nightly review");
    await expect(row.getByTestId("live-row-run")).toBeVisible();
    await expect(row.getByTestId("live-row-state")).toHaveText("Working");
    await expect(row.getByTestId("live-row-agent")).toHaveText("unattended · codex");
    await expect(panel.getByTestId("live-group-head")).toHaveText(["Alphacurrent1", "Beta1"]);
    await expect(panel.getByTestId("live-now-count")).toHaveText("2 running · 1 needs you");
    expect(pomade.fake.badges).toEqual({ agents: { count: 1, urgent: true } });

    await row.click();
    await expect.poll(() => pomade.fake.openedTabs).toEqual([
      { kind: "attached", projectId: "beta", session: { app: "pomade-runner", session: "run:reviews.nightly:20261124-030000-a1b2c3" }, title: "Nightly review" },
    ]);
    expect(pomade.fake.focusedAgentTabs).toEqual([]);

    // A run whose run started names no terminal: the row is there, and its click opens nothing.
    const { terminal: _named, ...bareRun } = run;
    pomade.fake.emitEvent(RUN_STARTED_EVENT, { ...bareRun, run: "20261124-040000-d4e5f6" } as JsonValue);
    const bare = panel.locator('[data-testid="live-row"][data-run="20261124-040000-d4e5f6"]');
    await expect(bare).toBeDisabled();
    await expect(panel.getByTestId("live-now-count")).toHaveText("3 running · 1 needs you");

    pomade.fake.emitEvent(RUN_FINISHED_EVENT, { ...run, result: "done", exitCode: 0 } as JsonValue);
    await expect(row).toHaveCount(0);
    await expect(panel.getByTestId("live-now-count")).toHaveText("2 running · 1 needs you");
    expect(pomade.fake.openedTabs).toHaveLength(1);
  });
});
