// The session detail through the built backend and the fake Pomade: clicking a session turns the
// table into the list with the detail panel, whose facts match the transcript; the status buttons
// and the note field write the record file through `sessions.setStatus`, and what they set stays
// after a frame reload and a backend restart; a refused change says so and leaves the row as it
// was; Esc returns to the table with the row in view; ↑ ↓ move the selection in both layouts; a
// long answer is clamped with "Show more".

import { chmod, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { FrameLocator, Page } from "@playwright/test";
import type { JsonValue } from "pomade-kit/protocol";

import { BUILT_BACKEND } from "../harness/app.ts";
import { spawnBackend } from "../harness/backend-process.ts";
import type { FakePomade } from "../harness/fake-pomade/server.ts";
import type { Sandbox } from "../harness/sandbox.ts";
import { SESSIONS_LIST_METHOD, SESSIONS_SET_STATUS_METHOD, isSessionsAnswer, type Session } from "../src/shared/sessions.ts";
import { formatMoney } from "../src/ui/sessions/table-model.ts";
import { expect, test, type Shell } from "./fixtures.ts";
import { answer, claudeSession, projectFolder, prompt, seedIntoProject } from "./transcripts.ts";

const SEEDED = { claude: "5b0e8f52-3c1d-4a7e-9f21-6d8c0b4a7e13", folderAgent: "c41f7e2a-9b3d-4e60-8d15-3a7b9c2e1f04", codex: "019a7c3e-5b2d-7f10-8c4e-1d2f3a4b5c6d" };
/** Started in Alpha's `docs/` on a branch, two prompts, a long last answer. */
const DOCS = "0c0d0e0f-0000-4000-8000-000000000001";
/** Started at Alpha's root, one prompt. */
const ONE = "0c0d0e0f-0000-4000-8000-000000000002";
/** In the Workspace bucket. */
const BUCKET = "0c0d0e0f-0000-4000-8000-000000000003";

const LONG_ANSWER = Array.from({ length: 14 }, (_, i) => `${i + 1}. A line of the answer about the sessions doc, long enough to read as prose.`).join("\n");

async function seedDetail(sandbox: Sandbox): Promise<void> {
  await seedIntoProject(sandbox, "alpha");
  const alpha = projectFolder(sandbox, "alpha");
  const docs = join(alpha, "docs");
  await claudeSession(
    sandbox,
    DOCS,
    prompt("Write the sessions doc", "2026-11-16T09:00:00.000Z", docs, "feature/docs") +
      answer({ model: "claude-opus-5-5", effort: "high", input: 300_000, at: "2026-11-16T09:01:00.000Z", cwd: docs, text: "Here is a first draft." }) +
      prompt("Make it shorter: five bullets per section at most", "2026-11-16T09:10:00.000Z", docs, "feature/docs") +
      answer({ model: "claude-opus-5-5", effort: "high", input: 320_000, at: "2026-11-16T09:12:00.000Z", cwd: docs, text: LONG_ANSWER }),
  );
  await claudeSession(sandbox, ONE, prompt("Check the context bar thresholds", "2026-11-15T09:00:00.000Z", alpha) + answer({ model: "claude-sonnet-5-5", input: 20_000, at: "2026-11-15T09:01:00.000Z", cwd: alpha }));
  await claudeSession(sandbox, BUCKET, prompt("Ad-hoc question about the workspace", "2026-11-14T09:00:00.000Z", "/elsewhere"));
}

async function sessions(pomade: FakePomade): Promise<Session[]> {
  const listed = await pomade.fake.callApi(SESSIONS_LIST_METHOD);
  if (!isSessionsAnswer(listed)) throw new Error("malformed sessions.list answer");
  return listed.sessions;
}

const sessionOf = async (pomade: FakePomade, id: string): Promise<Session | undefined> => (await sessions(pomade).catch(() => [])).find((s) => s.id === id);

/** Every seeded session has its record (the first run adopted them as Done); DOCS and ONE are made Active. */
async function ready(pomade: FakePomade): Promise<void> {
  const set = (params: JsonValue) => pomade.fake.callApi(SESSIONS_SET_STATUS_METHOD, params);
  await expect.poll(async () => set({ ids: [DOCS, ONE, BUCKET, ...Object.values(SEEDED)], status: "done" }).then(() => true, () => false), { timeout: 10_000 }).toBe(true);
  await set({ ids: [DOCS, ONE], status: "active" });
}

/** Open the Sessions tab of `projectId` (`null`: the Workspace). */
async function openSessions(page: Page, openShell: (page: Page) => Promise<Shell>, pomade: FakePomade, projectId: string | null): Promise<FrameLocator> {
  pomade.fake.setActiveProject(projectId);
  const { panel, tabFrame } = await openShell(page);
  await panel.getByTestId("open-sessions").click();
  return tabFrame(projectId ?? "__workspace__");
}

const row = (frame: FrameLocator, id: string) => frame.locator(`[data-testid="session-row"][data-session-id="${id}"]`);
const recordFile = (sandbox: Sandbox, appId: string, id: string): string => join(sandbox.workspace, "Apps", appId, "sessions", `${id}.yaml`);

/** True when `id`'s row lies inside its scroll box's visible part. */
const inView = (frame: FrameLocator, id: string) =>
  row(frame, id).evaluate((el) => {
    let box = el.parentElement;
    while (box !== null && getComputedStyle(box).overflowY !== "auto") box = box.parentElement;
    if (box === null) return false;
    const r = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    return r.top >= b.top && r.bottom <= b.bottom;
  });

test.describe("the session detail", () => {
  test.use({ seed: { into: seedDetail }, viewport: { width: 1280, height: 720 } });

  test("a click opens the list with the detail panel; the facts and messages match the transcript", async ({ page, openShell, pomade, backend }) => {
    await ready(pomade);
    const alpha = await openSessions(page, openShell, pomade, "alpha");
    await expect(alpha.getByTestId("sessions-table")).toBeVisible();
    await expect(alpha.getByTestId("detail-panel")).toHaveCount(0);

    await row(alpha, DOCS).click();
    await expect(alpha.getByTestId("sessions-table")).toHaveCount(0);
    const panel = alpha.getByTestId("detail-panel");
    await expect(panel).toHaveAttribute("data-session-id", DOCS);
    await expect(alpha.getByTestId("status-tab-active")).toHaveAttribute("aria-selected", "true");
    await expect(alpha.getByTestId("status-tab-count-active")).toHaveText("2");
    await expect(alpha.getByTestId("status-tab-count-done")).toHaveText("3");
    await expect(alpha.getByTestId("list-active").getByTestId("session-row")).toHaveCount(2);
    await expect(row(alpha, DOCS)).toHaveAttribute("aria-selected", "true");
    await expect(row(alpha, DOCS).getByTestId("row-meta")).toHaveText("claude · claude-opus-5-5 · high");

    const docs = await sessionOf(pomade, DOCS);
    await expect(panel.getByTestId("detail-name")).toHaveText("Unnamed session");
    await expect(panel.getByTestId("detail-last-active")).toContainText("Last active");
    await expect(panel.getByTestId("fact-project")).toHaveText("Alpha");
    await expect(panel.getByTestId("fact-started-in")).toHaveText("docs/on feature/docs");
    await expect(panel.getByTestId("fact-started-in").locator("code")).toHaveText("docs/");
    await expect(panel.getByTestId("fact-agent")).toHaveText("claudeClaude Code");
    await expect(panel.getByTestId("fact-model")).toHaveText("claude-opus-5-5effort high");
    await expect(panel.getByTestId("fact-context")).toHaveText(`${Math.round(((docs?.summary.context?.used ?? 0) / (docs?.summary.context?.window ?? 1)) * 100)}%`);
    await expect(panel.getByTestId("fact-cost")).toHaveText(formatMoney(docs?.summary.costUsd ?? NaN));
    await expect(panel.getByTestId("first-message")).toHaveText("Write the sessions doc");
    await expect(panel.getByTestId("last-message")).toHaveText("Make it shorter: five bullets per section at most");

    // One message from the user: the last is the first. At the project's root: "./ project root".
    await row(alpha, ONE).click();
    await expect(panel).toHaveAttribute("data-session-id", ONE);
    await expect(panel.getByTestId("last-message")).toHaveText("Same as the first — the session has one message from you.");
    await expect(panel.getByTestId("fact-started-in")).toHaveText("./project root");
    await expect(panel.getByTestId("last-answer")).toHaveText("Done.");
    await expect(panel.getByTestId("last-answer-more")).toHaveCount(0);

    // Another status tab shows that status and keeps the selection.
    await alpha.getByTestId("status-tab-done").click();
    await expect(alpha.getByTestId("status-tab-done")).toHaveAttribute("aria-selected", "true");
    await expect(alpha.getByTestId("list-done").getByTestId("session-row")).toHaveCount(3);
    await expect(panel).toHaveAttribute("data-session-id", ONE);
    expect(backend.running()).toBe(true);
  });

  test("a long answer is clamped; Show more expands it in place and Show less clamps it again", async ({ page, openShell, pomade, backend }) => {
    await ready(pomade);
    const alpha = await openSessions(page, openShell, pomade, "alpha");
    await row(alpha, DOCS).click();
    const answerBlock = alpha.getByTestId("last-answer");
    const clamped = await answerBlock.evaluate((el) => el.clientHeight);
    expect(clamped).toBeLessThan(await answerBlock.evaluate((el) => el.scrollHeight));
    await alpha.getByTestId("last-answer-more").click();
    await expect(alpha.getByTestId("last-answer-more")).toHaveText("Show less");
    await expect.poll(() => answerBlock.evaluate((el) => el.clientHeight)).toBeGreaterThan(clamped * 1.5);
    expect(await answerBlock.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
    await alpha.getByTestId("last-answer-more").click();
    await expect(alpha.getByTestId("last-answer-more")).toHaveText("Show more");
    await expect.poll(() => answerBlock.evaluate((el) => el.clientHeight)).toBe(clamped);
    expect(backend.running()).toBe(true);
  });

  test("On hold with a note moves the row and writes the record; it stays after a frame reload and a backend restart", async ({
    page,
    openShell,
    pomade,
    sandbox,
    manifest,
    backend,
  }) => {
    await ready(pomade);
    const alpha = await openSessions(page, openShell, pomade, "alpha");
    await row(alpha, DOCS).click();
    await alpha.getByTestId("status-on-hold").click();
    await expect(alpha.getByTestId("status-on-hold")).toHaveAttribute("aria-pressed", "true");
    await expect(alpha.getByTestId("status-tab-on-hold")).toHaveAttribute("aria-selected", "true");
    await expect(alpha.getByTestId("list-on-hold").getByTestId("session-row")).toHaveCount(1);

    // The row's note line follows the field as it is typed; Enter saves it.
    const note = alpha.getByTestId("note-input");
    await note.fill("Waiting for the review");
    await expect(row(alpha, DOCS).getByTestId("session-note")).toHaveText("Waiting for the review");
    await note.press("Enter");
    await expect(note).not.toBeFocused();
    const file = recordFile(sandbox, manifest.id, DOCS);
    await expect.poll(() => readFile(file, "utf8")).toContain("note: Waiting for the review");
    const text = await readFile(file, "utf8");
    expect(text).toContain("status: on-hold");
    await expect.poll(async () => (await sessionOf(pomade, DOCS))?.record).toMatchObject({ status: "on-hold", note: "Waiting for the review" });

    // A reload of the frame opens at the tab's route: the same session, as it was.
    await page.locator('[data-testid="tab-frame-alpha"]').evaluate((frame: HTMLIFrameElement) => {
      frame.src = frame.src;
    });
    await expect(alpha.getByTestId("detail-panel")).toHaveAttribute("data-session-id", DOCS);
    await expect(alpha.getByTestId("status-on-hold")).toHaveAttribute("aria-pressed", "true");
    await expect(alpha.getByTestId("note-input")).toHaveValue("Waiting for the review");
    await expect(row(alpha, DOCS).getByTestId("session-note")).toHaveText("Waiting for the review");

    expect((await backend.stop()).code).toBe(0);
    await expect.poll(() => pomade.backendCount()).toBe(0);
    const again = spawnBackend(sandbox, { entry: BUILT_BACKEND });
    try {
      await expect.poll(() => pomade.backendCount(), { message: again.output() }).toBe(1);
      await expect.poll(async () => (await sessionOf(pomade, DOCS))?.record).toMatchObject({ status: "on-hold", note: "Waiting for the review" });
      expect(await readFile(file, "utf8")).toBe(text);
      await expect(alpha.getByTestId("status-on-hold")).toHaveAttribute("aria-pressed", "true");
      await expect(alpha.getByTestId("list-on-hold").getByTestId("session-row")).toHaveCount(1);
      await expect(row(alpha, DOCS).getByTestId("session-note")).toHaveText("Waiting for the review");
    } finally {
      await again.stop();
    }
  });

  test("changing only the status keeps the note; clearing the field removes it from the file", async ({ page, openShell, pomade, sandbox, manifest, backend }) => {
    await ready(pomade);
    await pomade.fake.callApi(SESSIONS_SET_STATUS_METHOD, { ids: [DOCS], status: "active", note: "Blocked on the platform" });
    const file = recordFile(sandbox, manifest.id, DOCS);
    const alpha = await openSessions(page, openShell, pomade, "alpha");
    await row(alpha, DOCS).click();
    await expect(alpha.getByTestId("note-input")).toHaveValue("Blocked on the platform");

    await alpha.getByTestId("status-done").click();
    await expect(alpha.getByTestId("status-tab-done")).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => readFile(file, "utf8")).toContain("status: done");
    expect(await readFile(file, "utf8")).toContain("note: Blocked on the platform");
    await expect(alpha.getByTestId("note-input")).toHaveValue("Blocked on the platform");
    await expect(row(alpha, DOCS).getByTestId("session-note")).toHaveText("Blocked on the platform");

    // Cleared, then left (blur): the note is gone from the row and the file.
    await alpha.getByTestId("note-input").fill("");
    await expect(row(alpha, DOCS).getByTestId("session-note")).toHaveCount(0);
    await alpha.getByTestId("detail-name").click();
    await expect.poll(() => readFile(file, "utf8")).not.toContain("note:");
    expect(await readFile(file, "utf8")).toContain("status: done");
    await expect.poll(async () => (await sessionOf(pomade, DOCS))?.record?.note).toBeUndefined();
    expect(backend.running()).toBe(true);
  });

  test("a refused change says so in the panel and leaves the row as it was", async ({ page, openShell, pomade, sandbox, manifest, backend }) => {
    await ready(pomade);
    const file = recordFile(sandbox, manifest.id, DOCS);
    const before = await readFile(file, "utf8");
    const alpha = await openSessions(page, openShell, pomade, "alpha");
    await row(alpha, DOCS).click();
    const folder = join(sandbox.workspace, "Apps", manifest.id, "sessions");
    await chmod(folder, 0o555);
    try {
      await alpha.getByTestId("status-done").click();
      await expect(alpha.getByTestId("change-failure")).toContainText("The status was not changed");
      await expect(alpha.getByTestId("status-active")).toHaveAttribute("aria-pressed", "true");
      await expect(alpha.getByTestId("status-tab-active")).toHaveAttribute("aria-selected", "true");
      await expect(row(alpha, DOCS)).toHaveAttribute("data-status", "active");
      await expect(alpha.getByTestId("status-tab-count-done")).toHaveText("3");

      await alpha.getByTestId("note-input").fill("Will not stick");
      await alpha.getByTestId("note-input").press("Enter");
      await expect(alpha.getByTestId("change-failure")).toContainText("The note was not saved");
      await expect(row(alpha, DOCS).getByTestId("session-note")).toHaveCount(0);
      await expect(alpha.getByTestId("note-input")).toHaveValue("Will not stick");
    } finally {
      await chmod(folder, 0o755);
    }
    expect(await readFile(file, "utf8")).toBe(before);
    expect((await sessionOf(pomade, DOCS))?.record?.status).toBe("active");

    // The next change goes through and the message goes.
    await alpha.getByTestId("status-done").click();
    await expect(alpha.getByTestId("change-failure")).toHaveCount(0);
    await expect(alpha.getByTestId("status-done")).toHaveAttribute("aria-pressed", "true");
    expect(backend.running()).toBe(true);
  });

  test("Esc returns to the table with the row in view; ↑ ↓ move the selection in both layouts", async ({ page, openShell, pomade, backend }) => {
    await ready(pomade);
    await page.setViewportSize({ width: 1280, height: 300 });
    const alpha = await openSessions(page, openShell, pomade, "alpha");
    const table = alpha.getByTestId("sessions-table");
    await expect(table).toBeVisible();

    // In the table (the tab focused, nothing selected), the first ↓ selects the first row.
    await alpha.getByRole("heading", { name: "Sessions", exact: true }).click();
    await page.keyboard.press("ArrowDown");
    await expect(alpha.getByTestId("detail-panel")).toHaveAttribute("data-session-id", DOCS);
    await page.keyboard.press("ArrowDown");
    await expect(alpha.getByTestId("detail-panel")).toHaveAttribute("data-session-id", ONE);
    await page.keyboard.press("ArrowDown");
    await expect(alpha.getByTestId("detail-panel")).toHaveAttribute("data-session-id", ONE);

    // The last Done row, below the fold of the table: selected from the list's Done tab.
    await alpha.getByTestId("status-tab-done").click();
    const lastDone = alpha.getByTestId("list-done").getByTestId("session-row").last();
    const id = (await lastDone.getAttribute("data-session-id")) ?? "";
    await lastDone.click();
    await page.keyboard.press("ArrowUp");
    const above = (await alpha.getByTestId("list-done").getByTestId("session-row").nth(1).getAttribute("data-session-id")) ?? "";
    await expect(alpha.getByTestId("detail-panel")).toHaveAttribute("data-session-id", above);
    await page.keyboard.press("ArrowDown");
    await expect(alpha.getByTestId("detail-panel")).toHaveAttribute("data-session-id", id);
    expect(await inView(alpha, id)).toBe(true);

    await page.keyboard.press("Escape");
    await expect(table).toBeVisible();
    await expect(alpha.getByTestId("detail-panel")).toHaveCount(0);
    await expect(row(alpha, id)).toHaveAttribute("data-last-selected", "");
    expect(await table.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(await inView(alpha, id)).toBe(true);

    // ↑ goes on from that row.
    await page.keyboard.press("ArrowUp");
    await expect(alpha.getByTestId("detail-panel")).toHaveAttribute("data-session-id", above);

    // × closes as Esc does.
    await alpha.getByTestId("detail-close").click();
    await expect(table).toBeVisible();
    await expect(row(alpha, above)).toHaveAttribute("data-last-selected", "");
    expect(backend.running()).toBe(true);
  });

  test("in the Workspace's tab the rows and the facts name the project; the Workspace bucket's folder is as recorded", async ({ page, openShell, pomade, backend }) => {
    await ready(pomade);
    const workspace = await openSessions(page, openShell, pomade, null);
    await row(workspace, DOCS).click();
    await expect(row(workspace, DOCS).getByTestId("row-meta")).toHaveText("Alpha · claude · claude-opus-5-5 · high");
    await expect(workspace.getByTestId("fact-project")).toHaveText("Alpha");
    await expect(workspace.getByTestId("fact-started-in").locator("code")).toHaveText("docs/");

    await workspace.getByTestId("status-tab-done").click();
    await row(workspace, BUCKET).click();
    await expect(workspace.getByTestId("fact-project")).toHaveText("Workspace");
    await expect(workspace.getByTestId("fact-started-in")).toHaveText("/elsewhere");
    await expect(workspace.getByTestId("last-answer")).toHaveText("No answer yet.");
    expect(backend.running()).toBe(true);
  });
});
