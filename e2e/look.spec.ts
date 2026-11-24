// How the surfaces look, in the fake Pomade's window at Pomade's own metrics: screenshots for
// review land in e2e/artifacts/. The app is light only, whatever the system appearance.

import { mkdirSync } from "node:fs";
import { chmod } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Sandbox } from "../harness/sandbox.ts";
import { SESSIONS_SET_STATUS_METHOD } from "../src/shared/sessions.ts";
import { expect, test } from "./fixtures.ts";
import { APP_URL } from "./ports.ts";
import { answer, claudeSession, projectFolder, prompt, seedIntoProject } from "./transcripts.ts";

const ARTIFACTS = fileURLToPath(new URL("./artifacts", import.meta.url));
mkdirSync(ARTIFACTS, { recursive: true });

/** `rgb(r, g, b)` of a frame's page background. */
const background = (body: HTMLElement): string => getComputedStyle(body).backgroundColor;

const ids = (prefix: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${prefix}-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
const ALPHA = ids("1a1a1a1a", 6);
const BETA = ids("2b2b2b2b", 15);
const SEEDED_CLAUDE = "5b0e8f52-3c1d-4a7e-9f21-6d8c0b4a7e13";
const SEEDED_CODEX = "019a7c3e-5b2d-7f10-8c4e-1d2f3a4b5c6d";
const PROMPTS = [
  "Run the e2e suite five times and report every flaky spec",
  "Why does the side panel flicker when I drag the column divider past the minimum width of the tree",
  "Check the context bar thresholds",
  "Quick grep: which css modules still use a bare z-index",
  "Review the G4 tickets",
  "Port the prototype table onto the app's tokens",
];

/** Alpha holds the seeded sessions and six more of mixed models; Beta fifteen; one is the Workspace's. */
async function seedLook(sandbox: Sandbox): Promise<void> {
  await seedIntoProject(sandbox, "alpha");
  const alpha = projectFolder(sandbox, "alpha");
  const models = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-mystery-1", "claude-haiku-5-5", "claude-opus-5-5", "claude-fable-5-2"];
  const inputs = [790_000, 120_000, 50_000, 30_000, 940_000, 400_000];
  for (const [i, id] of ALPHA.entries()) {
    const at = new Date(Date.UTC(2026, 10, 14 + (i % 4), 8 + i)).toISOString();
    await claudeSession(sandbox, id, prompt(PROMPTS[i] ?? "", at, alpha) + answer({ model: models[i] ?? "", input: inputs[i] ?? 0, output: 4000 * (i + 1), at, cwd: alpha }));
  }
  const beta = projectFolder(sandbox, "beta");
  for (const [i, id] of BETA.entries()) {
    const at = new Date(Date.UTC(2026, 9, 20 + i, 9)).toISOString();
    await claudeSession(sandbox, id, prompt(`Tidy up batch ${i + 1}`, at, beta) + answer({ model: "claude-sonnet-5-5", input: 60_000, at, cwd: beta }));
  }
  await claudeSession(sandbox, "3c3c3c3c-0000-4000-8000-000000000001", prompt("Ad-hoc question about the workspace", "2026-11-16T09:00:00.000Z", "/elsewhere"));
}

test.use({ colorScheme: "dark", viewport: { width: 1280, height: 720 } });

test("the panel and each tab view are light, even on a dark system appearance", async ({ page, openShell, backend }) => {
  const { panel, tabFrame } = await openShell(page);
  await expect(panel.getByTestId("backend-status")).toHaveAttribute("data-status", "running");
  expect(backend.running()).toBe(true);
  // The panel sits on Pomade's side-panel background, a tab on its pane background.
  expect(await panel.locator("body").evaluate(background)).toBe("rgb(250, 251, 252)");
  await page.screenshot({ path: `${ARTIFACTS}/panel.png` });

  await panel.getByTestId("open-sessions").click();
  const tab = tabFrame("alpha");
  await expect(tab.getByRole("heading", { name: "Sessions", exact: true })).toBeVisible();
  await expect(tab.getByTestId("sessions-empty")).toBeVisible();
  expect(await tab.locator("body").evaluate(background)).toBe("rgb(255, 255, 255)");
  await page.screenshot({ path: `${ARTIFACTS}/sessions-empty.png` });

  await tab.getByTestId("view-roster").click();
  await expect(tab.getByRole("heading", { name: "Roster" })).toBeVisible();
  await page.screenshot({ path: `${ARTIFACTS}/roster.png` });
});

test.describe("the Sessions table", () => {
  test.use({ seed: { into: seedLook } });

  test("a project, a narrow tab, a long Done group and the Workspace", async ({ page, openShell, pomade, backend }) => {
    const set = (list: string[], status: string, note?: string) => pomade.fake.callApi(SESSIONS_SET_STATUS_METHOD, note === undefined ? { ids: list, status } : { ids: list, status, note });
    // Records exist once the first run has adopted every session.
    await expect.poll(async () => set([...ALPHA, ...BETA], "done").then(() => true, () => false), { timeout: 10_000 }).toBe(true);
    await set([ALPHA[0] ?? "", ALPHA[1] ?? "", ALPHA[3] ?? "", SEEDED_CLAUDE], "active");
    await set([ALPHA[4] ?? ""], "on-hold", "Waiting for my live test of the grey active border");
    await set([SEEDED_CODEX], "done-skip", "Wrong approach, restarted in a new session");

    const { panel, tabFrame } = await openShell(page);
    await panel.getByTestId("open-sessions").click();
    const alpha = tabFrame("alpha");
    await expect(alpha.getByTestId("session-row")).toHaveCount(3 + ALPHA.length);
    await expect(alpha.getByTestId("group-count-on-hold")).toHaveText("1");
    await alpha.getByTestId("session-row").nth(1).hover();
    await page.screenshot({ path: `${ARTIFACTS}/sessions-project.png` });

    await page.setViewportSize({ width: 760, height: 720 });
    await expect(alpha.getByTestId("sessions-table")).not.toHaveAttribute("data-columns", /model/);
    await page.screenshot({ path: `${ARTIFACTS}/sessions-narrow.png` });
    await page.setViewportSize({ width: 1280, height: 720 });

    pomade.fake.setActiveProject("beta");
    await panel.getByTestId("open-sessions").click();
    const beta = tabFrame("beta");
    await expect(beta.getByTestId("group-more-done")).toBeVisible();
    await page.screenshot({ path: `${ARTIFACTS}/sessions-long-done.png` });
    // Scrolled: the column header and the group's header stick.
    await beta.getByRole("button", { name: "Show all 15" }).click();
    await beta.getByTestId("sessions-table").evaluate((el) => el.scrollTo({ top: 140 }));
    await expect.poll(() => beta.getByTestId("sessions-table").evaluate((el) => el.scrollTop)).toBe(140);
    await page.screenshot({ path: `${ARTIFACTS}/sessions-long-done-scrolled.png` });

    pomade.fake.setActiveProject(null);
    await panel.getByTestId("open-sessions").click();
    const workspace = tabFrame("__workspace__");
    await expect(workspace.getByTestId("sessions-count")).toHaveAttribute("data-count", String(3 + ALPHA.length + BETA.length + 1));
    await workspace.getByTestId("group-toggle-done").click();
    await page.screenshot({ path: `${ARTIFACTS}/sessions-workspace.png`, animations: "disabled" });
    expect(backend.running()).toBe(true);
  });
});

const DETAIL = "4d4d4d4d-0000-4000-8000-000000000001";
const DETAIL_ANSWER = [
  "Here is the shorter version, five bullets per section:",
  "",
  "1. The table shows while nothing is selected; a click opens the list with the detail panel.",
  "2. The open status tab follows the selected session; another tab keeps the selection.",
  "3. The status is four buttons; the note under them is saved on Enter or when you leave it.",
  "4. A refused change says so in the panel and leaves the row as it was.",
  "5. Esc or the close button returns to the table, scrolled to the row.",
  "",
  "I left the toolbar, the bulk bar and Resume out: they arrive with their own tickets.",
  "Shall I also cut the glossary section down to the four new names?",
].join("\n");

/** `seedLook`, plus a session started in Alpha's `docs/` on a branch, with two prompts and a long answer. */
async function seedDetailLook(sandbox: Sandbox): Promise<void> {
  await seedLook(sandbox);
  const docs = join(projectFolder(sandbox, "alpha"), "docs");
  await claudeSession(
    sandbox,
    DETAIL,
    prompt(
      [
        "Write the sessions doc for the detail panel: what the list shows, what the panel shows, which keys move the selection, and what happens when a change cannot be written.",
        "Keep it in the voice of the other docs: present tense, no history.",
        "Put the keys in a table.",
        "Mention that the selection is kept in the tab's route, so a reload keeps it.",
        "Then list what is left for the next tickets.",
      ].join("\n"),
      "2026-11-17T08:00:00.000Z",
      docs,
      "feature/session-detail",
    ) +
      answer({ model: "claude-opus-5-5", effort: "high", input: 420_000, output: 9000, at: "2026-11-17T08:04:00.000Z", cwd: docs, text: "A first draft." }) +
      prompt("Make it shorter: five bullets per section at most", "2026-11-17T08:20:00.000Z", docs, "feature/session-detail") +
      answer({ model: "claude-opus-5-5", effort: "high", input: 450_000, output: 3000, at: "2026-11-17T08:22:00.000Z", cwd: docs, text: DETAIL_ANSWER }),
  );
}

test.describe("the list with the detail panel", () => {
  test.use({ seed: { into: seedDetailLook } });

  test("a project, a long answer, a refused change, a narrow tab, the Workspace and the table after Esc", async ({ page, openShell, pomade, sandbox, manifest, backend }) => {
    const set = (list: string[], status: string, note?: string) => pomade.fake.callApi(SESSIONS_SET_STATUS_METHOD, note === undefined ? { ids: list, status } : { ids: list, status, note });
    await expect.poll(async () => set([...ALPHA, ...BETA, DETAIL], "done").then(() => true, () => false), { timeout: 10_000 }).toBe(true);
    await set([ALPHA[0] ?? "", ALPHA[1] ?? "", ALPHA[3] ?? "", SEEDED_CLAUDE, DETAIL], "active");
    await set([ALPHA[4] ?? ""], "on-hold", "Waiting for my live test of the grey active border");
    await set([SEEDED_CODEX], "done-skip", "Wrong approach, restarted in a new session");
    await set([DETAIL], "active", "Review the bullets before the round");

    const { panel, tabFrame } = await openShell(page);
    await panel.getByTestId("open-sessions").click();
    const alpha = tabFrame("alpha");
    await alpha.locator(`[data-testid="session-row"][data-session-id="${DETAIL}"]`).click();
    await expect(alpha.getByTestId("detail-panel")).toBeVisible();
    await alpha.locator(`[data-testid="session-row"][data-session-id="${ALPHA[1] ?? ""}"]`).hover();
    await page.screenshot({ path: `${ARTIFACTS}/detail-project.png` });

    await alpha.getByTestId("last-answer-more").click();
    await alpha.getByTestId("first-message-more").click();
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `${ARTIFACTS}/detail-expanded.png` });
    await alpha.getByTestId("detail-panel").evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await page.screenshot({ path: `${ARTIFACTS}/detail-expanded-scrolled.png` });
    await alpha.getByTestId("detail-panel").evaluate((el) => el.scrollTo({ top: 0 }));

    const folder = join(sandbox.workspace, "Apps", manifest.id, "sessions");
    await chmod(folder, 0o555);
    try {
      await alpha.getByTestId("status-on-hold").click();
      await expect(alpha.getByTestId("change-failure")).toBeVisible();
      await alpha.getByTestId("note-input").focus();
      await page.screenshot({ path: `${ARTIFACTS}/detail-failed.png` });
    } finally {
      await chmod(folder, 0o755);
    }
    await alpha.getByTestId("facts").click();

    await page.setViewportSize({ width: 860, height: 720 });
    await page.screenshot({ path: `${ARTIFACTS}/detail-narrow.png` });
    await page.setViewportSize({ width: 1280, height: 720 });

    await page.keyboard.press("Escape");
    await expect(alpha.getByTestId("sessions-table")).toBeVisible();
    await page.screenshot({ path: `${ARTIFACTS}/detail-closed-table.png` });

    pomade.fake.setActiveProject(null);
    await panel.getByTestId("open-sessions").click();
    const workspace = tabFrame("__workspace__");
    await workspace.locator(`[data-testid="session-row"][data-session-id="${SEEDED_CODEX}"]`).click();
    await expect(workspace.getByTestId("detail-panel")).toBeVisible();
    await page.screenshot({ path: `${ARTIFACTS}/detail-workspace.png` });
    await workspace.getByTestId("status-tab-done").click();
    await page.screenshot({ path: `${ARTIFACTS}/detail-workspace-done-tab.png` });
    expect(backend.running()).toBe(true);
  });
});

test("the panel without a backend, and the no-host state", async ({ page, openShell }) => {
  const { panel } = await openShell(page);
  await expect(panel.getByTestId("backend-status")).toHaveAttribute("data-status", "down");
  await page.screenshot({ path: `${ARTIFACTS}/panel-backend-down.png` });

  await page.goto(APP_URL);
  await expect(page.getByTestId("no-host")).toBeVisible();
  await page.screenshot({ path: `${ARTIFACTS}/no-host.png` });
});
