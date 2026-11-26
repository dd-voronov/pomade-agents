// Open / Resume through the built backend and the fake Pomade (ARCHITECTURE §2.1): a session with no tab
// resumes in a new agent tab in its project and start folder (`agentTabs.resume`) and a Done one
// becomes Active; a session bound to an open tab focuses that tab, never a second one — from the
// detail panel's primary button, a row's hover button, the row menu's first entry, Enter and a
// double-click. A refused resume says why in the toast and changes nothing.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { FrameLocator, Locator, Page } from "@playwright/test";

import type { FakePomade } from "../harness/fake-pomade.ts";
import type { Sandbox } from "../harness/sandbox.ts";
import { SESSIONS_LIST_METHOD, isSessionsAnswer } from "../src/shared/sessions.ts";
import { expect, test, type Shell } from "./fixtures.ts";
import { answer, claudeSession, clearOnly, projectFolder, prompt } from "./transcripts.ts";

/** Done, no tab; the fake Pomade finds it in Alpha's `docs/`. */
const DONE = "9a9a9a9a-0000-4000-8000-000000000001";
/** Bound to the open tab `tab-open`. */
const OPEN = "9a9a9a9a-0000-4000-8000-000000000002";
/** Holds only a `/clear`: hidden as empty, nothing to resume. */
const EMPTY = "9a9a9a9a-0000-4000-8000-000000000004";
/** Done, no tab; the fake Pomade does not find it. */
const LOST = "9a9a9a9a-0000-4000-8000-000000000003";

/** Screenshots for review. */
const SHOTS = fileURLToPath(new URL("./artifacts", import.meta.url));

const daysAgo = (n: number): string => new Date(Date.now() - n * 86_400_000).toISOString();

const row = (frame: FrameLocator, sessionId: string): Locator => frame.locator(`[data-testid="session-row"][data-session-id="${sessionId}"]`);
const recordStatus = async (sandbox: Sandbox, appId: string, sessionId: string): Promise<string | undefined> =>
  /^status: (.+)$/m.exec(await readFile(join(sandbox.workspace, "Apps", appId, "sessions", `${sessionId}.yaml`), "utf8").catch(() => ""))?.[1];

/** The three sessions have their records (the first run adopted them as Done). */
async function ready(pomade: FakePomade): Promise<void> {
  await expect
    .poll(
      async () => {
        const answer = await pomade.fake.callApi(SESSIONS_LIST_METHOD).catch(() => null);
        return isSessionsAnswer(answer) ? answer.sessions.filter((s) => [DONE, OPEN, LOST].includes(s.id) && s.record !== null).length : 0;
      },
      { timeout: 10_000 },
    )
    .toBe(3);
}

async function openAlpha(page: Page, openShell: (page: Page) => Promise<Shell>): Promise<FrameLocator> {
  const shell = await openShell(page);
  await shell.panel.getByTestId("open-sessions").click();
  return shell.tabFrame("alpha");
}

test.describe("Open / Resume", () => {
  test.use({
    viewport: { width: 1280, height: 720 },
    seed: {
      async into(sandbox) {
        const alpha = projectFolder(sandbox, "alpha");
        await claudeSession(sandbox, DONE, prompt("Write the release notes", daysAgo(3), join(alpha, "docs")));
        await claudeSession(sandbox, OPEN, prompt("Fix the flaky drag spec", daysAgo(2), alpha));
        await claudeSession(sandbox, LOST, prompt("Port the bulk bar", daysAgo(1), alpha) + answer({ model: "claude-opus-5-5", input: 1000, at: daysAgo(1), cwd: alpha, text: "Ported; the zebra stripes stay." }));
        await claudeSession(sandbox, EMPTY, clearOnly(daysAgo(1), alpha));
      },
    },
    pomadeSeed: {
      files: { "Projects/alpha/docs/notes.md": "", "Projects/beta/README.md": "" },
      sessions: [{ agentId: "claude", sessionId: DONE, cwd: "Projects/alpha/docs" }],
      agentTabs: [{ tabId: "tab-open", projectId: "alpha", agentId: "claude", sessionId: OPEN, state: "idle" }],
    },
  });

  test("resumes a Done session in a new agent tab in its project and folder and makes it Active; then Open tab focuses that tab", async ({
    page,
    openShell,
    pomade,
    sandbox,
    manifest,
    backend,
  }) => {
    await ready(pomade);
    const alpha = await openAlpha(page, openShell);
    await expect(row(alpha, DONE), backend.output()).toHaveAttribute("data-status", "done");

    await row(alpha, DONE).click();
    const open = alpha.getByTestId("detail-open");
    await expect(open).toHaveText("Resume");
    await expect(alpha.getByTestId("detail-open-hint")).toHaveText("Resume sets the status back to Active.");
    await open.click();

    await expect.poll(() => pomade.fake.openedAgentTabs).toEqual([
      { kind: "agent", tabId: "agent-tab-1", projectId: "alpha", agentId: "claude", cwd: "Projects/alpha/docs", mode: "normal", sessionId: DONE },
    ]);
    await expect(alpha.getByTestId("toast-text")).toHaveText("Resumed in a new agent tab in Alpha · status set to Active");
    await expect(row(alpha, DONE)).toHaveAttribute("data-status", "active");
    await expect.poll(() => recordStatus(sandbox, manifest.id, DONE)).toBe("active");

    // The new tab is bound to the session: the button opens it, and a second Open adds no tab.
    await expect(open).toHaveText("Open tab");
    await expect(alpha.getByTestId("detail-open-hint")).toHaveCount(0);
    await open.click();
    await expect.poll(() => pomade.fake.focusedAgentTabs).toEqual(["agent-tab-1"]);
    await expect(alpha.getByTestId("toast-text")).toHaveText("Focused the open tab “Write the release notes”");
    expect(pomade.fake.openedAgentTabs).toHaveLength(1);
  });

  test("a session with an open tab focuses it from the row's button, the row menu, Enter and a double-click — never a second tab", async ({ page, openShell, pomade, backend }) => {
    await ready(pomade);
    const alpha = await openAlpha(page, openShell);
    const focused = (): string[] => pomade.fake.focusedAgentTabs;

    // The row's hover button, in the table: Open tab for a bound session, Resume for the others.
    await row(alpha, OPEN).hover();
    const button = row(alpha, OPEN).getByTestId("row-open");
    await expect(button, backend.output()).toHaveAttribute("title", "Open tab");
    await expect(row(alpha, DONE).getByTestId("row-open")).toHaveAttribute("title", "Resume");
    await button.click();
    await expect.poll(focused).toEqual(["tab-open"]);
    await expect(alpha.getByTestId("detail-panel")).toHaveCount(0);

    // The row menu's first entry.
    await row(alpha, OPEN).click({ button: "right" });
    const first = alpha.getByTestId("row-menu").locator("[role^='menuitem']").first();
    await expect(first).toHaveText("Open tab");
    await expect(first).toBeFocused();
    await first.click();
    await expect.poll(focused).toEqual(["tab-open", "tab-open"]);

    // A double-click on the row: it opens the session (and the first click selected it).
    await row(alpha, OPEN).dblclick();
    await expect.poll(focused).toEqual(["tab-open", "tab-open", "tab-open"]);
    await expect(alpha.getByTestId("detail-panel")).toHaveAttribute("data-session-id", OPEN);

    // Enter on the selected row; Space and F2 keep their jobs.
    await page.keyboard.press("Enter");
    await expect.poll(focused).toEqual(["tab-open", "tab-open", "tab-open", "tab-open"]);
    await page.keyboard.press("Space");
    await expect(row(alpha, OPEN).getByTestId("row-check")).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("F2");
    await expect(alpha.getByTestId("name-input")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(alpha.getByTestId("name-input")).toHaveCount(0);
    expect(focused()).toHaveLength(4);
    expect(pomade.fake.openedAgentTabs).toEqual([]);
  });

  test("a resume Pomade refuses says why in the toast and changes nothing", async ({ page, openShell, pomade, sandbox, manifest, backend }) => {
    await ready(pomade);
    const alpha = await openAlpha(page, openShell);
    await row(alpha, LOST).hover();
    await row(alpha, LOST).getByTestId("row-open").click();

    const toast = alpha.getByTestId("toast-text");
    await expect(toast, backend.output()).toHaveText("The session was not opened. Pomade did not find it in its agent's store.");
    await expect(alpha.getByTestId("toast")).toHaveAttribute("title", /^Pomade did not find it in its agent's store — No session /);
    expect(pomade.fake.openedAgentTabs).toEqual([]);
    await expect(row(alpha, LOST)).toHaveAttribute("data-status", "done");
    expect(await recordStatus(sandbox, manifest.id, LOST)).toBe("done");
  });

  test("with a search on: Enter in the field opens nothing, ↓ then Enter opens the first match, a double-click opens a match, the hover button sits beside a snippet line", async ({ page, openShell, pomade, backend }) => {
    await ready(pomade);
    const alpha = await openAlpha(page, openShell);
    const field = alpha.getByTestId("search-field");

    // Enter in the search field is the field's: no row opens.
    await field.click();
    await field.fill("drag");
    await page.keyboard.press("Enter");
    await expect(alpha.getByTestId("session-row"), backend.output()).toHaveCount(1);
    await expect(alpha.getByTestId("detail-panel")).toHaveCount(0);
    expect(pomade.fake.focusedAgentTabs).toEqual([]);

    // ↓ leaves the field for the first match; Enter opens it.
    await page.keyboard.press("ArrowDown");
    await expect(alpha.getByTestId("detail-panel")).toHaveAttribute("data-session-id", OPEN);
    await page.keyboard.press("Enter");
    await expect.poll(() => pomade.fake.focusedAgentTabs).toEqual(["tab-open"]);

    // `/` back to the search; Esc clears it, a second Esc leaves the field; the panel stays.
    await page.keyboard.press("/");
    await expect(field).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(field).toHaveValue("");
    await page.keyboard.press("Escape");
    await expect(field).not.toBeFocused();
    await page.keyboard.press("Escape");
    await expect(alpha.getByTestId("detail-panel")).toHaveCount(0);

    // A double-click on a filtered table row resumes that session.
    await field.fill("release");
    await expect(alpha.getByTestId("session-row")).toHaveCount(1);
    await row(alpha, DONE).dblclick();
    await expect.poll(() => pomade.fake.openedAgentTabs.map((t) => t.sessionId)).toEqual([DONE]);

    // A match in the last answer shows a snippet under the row; the hover button stays on the row's line.
    await page.keyboard.press("Escape");
    await field.fill("zebra");
    await expect(row(alpha, LOST).getByTestId("search-snippet")).toBeVisible();
    await row(alpha, LOST).hover();
    const button = row(alpha, LOST).getByTestId("row-open");
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    const snippet = await row(alpha, LOST).getByTestId("search-snippet").boundingBox();
    // On the row's 28 px line: its middle above the snippet line.
    expect((box?.y ?? 0) + (box?.height ?? 0) / 2).toBeLessThan(snippet?.y ?? 0);
    await page.screenshot({ path: `${SHOTS}/open-snippet-hover.png` });
  });

  test("a hidden session with no messages, shown through \"1 hidden\", is not resumed: the panel and the toast say why", async ({ page, openShell, pomade, backend }) => {
    await ready(pomade);
    const alpha = await openAlpha(page, openShell);
    await alpha.getByTestId("sessions-hidden").click();
    await expect(row(alpha, EMPTY), backend.output()).toHaveAttribute("data-hidden", "empty");
    await row(alpha, EMPTY).hover();
    await row(alpha, EMPTY).getByTestId("row-open").click();
    await expect(alpha.getByTestId("toast-text")).toHaveText("The session was not opened. It holds no messages, so there is nothing to resume.");
    await row(alpha, EMPTY).click();
    await expect(alpha.getByTestId("detail-open-hint")).toHaveText("It holds no messages, so there is nothing to resume.");
    expect(pomade.fake.openedAgentTabs).toEqual([]);
  });
});
