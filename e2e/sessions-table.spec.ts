// The Sessions table through the built backend and the fake Pomade: a project's tab lists that
// project's sessions in their status groups with counts and ~$ sums, the Workspace's tab every
// session with a Project column; a record edited on disk and a new transcript show within ~2 s
// without losing scroll or collapsed groups; long Done groups show their latest 10; unknown and
// near-full contexts read as they should; columns leave as the tab narrows; an empty scope says so.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { FrameLocator, Page } from "@playwright/test";
import type { JsonValue } from "pomade-kit/protocol";

import type { FakePomade } from "../harness/fake-pomade.ts";
import type { Sandbox } from "../harness/sandbox.ts";
import { SESSIONS_LIST_METHOD, SESSIONS_SET_STATUS_METHOD, isSessionsAnswer, type Session } from "../src/shared/sessions.ts";
import { columnsFor, costSum, formatHeaderSum, formatMoney } from "../src/ui/sessions/table-model.ts";
import { expect, test, type Shell } from "./fixtures.ts";
import { answer, claudeSession, projectFolder, prompt, seedIntoProject } from "./transcripts.ts";

/** The ticket's bound for a change to show. */
const WITHIN_MS = 2000;

const SEEDED = { claude: "5b0e8f52-3c1d-4a7e-9f21-6d8c0b4a7e13", folderAgent: "c41f7e2a-9b3d-4e60-8d15-3a7b9c2e1f04", codex: "019a7c3e-5b2d-7f10-8c4e-1d2f3a4b5c6d" };
const UNKNOWN_MODEL = "0b1c2d3e-0000-4000-8000-000000000001";
const NEAR_FULL = "0b1c2d3e-0000-4000-8000-000000000002";
const IN_BUCKET = "0b1c2d3e-0000-4000-8000-000000000003";
const IN_BETA = "0b1c2d3e-0000-4000-8000-000000000004";
const FRESH = "0b1c2d3e-0000-4000-8000-0000000000ff";

/** A Claude session with one prompt and one answer, started at `at` in `cwd`. */
async function session(sandbox: Sandbox, id: string, cwd: string, at: string, model = "claude-opus-5-5", input = 20_000): Promise<string> {
  return claudeSession(sandbox, id, prompt(`Work on ${id.slice(-4)}`, at, cwd) + answer({ model, input, at, cwd }));
}

/** The seeded transcripts in Alpha, plus an unknown model's and a 92 % full session there, one in the
 *  Workspace bucket and one in Beta. All started before the first run, so all are adopted as Done. */
async function seedAlpha(sandbox: Sandbox): Promise<void> {
  await seedIntoProject(sandbox, "alpha");
  const alpha = projectFolder(sandbox, "alpha");
  await session(sandbox, UNKNOWN_MODEL, alpha, "2026-11-14T09:00:00.000Z", "claude-mystery-1");
  await session(sandbox, NEAR_FULL, alpha, "2026-11-15T09:00:00.000Z", "claude-opus-5-5", 920_000);
  await session(sandbox, IN_BUCKET, "/elsewhere", "2026-11-13T09:00:00.000Z");
  await session(sandbox, IN_BETA, projectFolder(sandbox, "beta"), "2026-11-13T10:00:00.000Z");
}

/** 15 sessions in Beta, a day apart, the newest last. */
const DONE_IDS = Array.from({ length: 15 }, (_, i) => `0d0e0f00-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
async function seedFifteenInBeta(sandbox: Sandbox): Promise<void> {
  const beta = projectFolder(sandbox, "beta");
  for (const [i, id] of DONE_IDS.entries()) await session(sandbox, id, beta, new Date(Date.UTC(2026, 9, 20 + i, 9)).toISOString());
}

async function sessions(pomade: FakePomade): Promise<Session[]> {
  const answer = await pomade.fake.callApi(SESSIONS_LIST_METHOD);
  if (!isSessionsAnswer(answer)) throw new Error("malformed sessions.list answer");
  return answer.sessions;
}

const recordsDone = async (pomade: FakePomade, count: number): Promise<void> => {
  await expect
    .poll(async () => (await sessions(pomade).catch(() => [])).filter((s) => s.record?.status === "done").length, { timeout: 10_000 })
    .toBe(count);
};

/** Open the Sessions tab of `projectId` (`null`: the Workspace). */
async function openSessions(page: Page, openShell: (page: Page) => Promise<Shell>, pomade: FakePomade, projectId: string | null): Promise<FrameLocator> {
  pomade.fake.setActiveProject(projectId);
  const { panel, tabFrame } = await openShell(page);
  await panel.getByTestId("open-sessions").click();
  return tabFrame(projectId ?? "__workspace__");
}

const row = (frame: FrameLocator, id: string) => frame.locator(`[data-testid="session-row"][data-session-id="${id}"]`);
const groupRows = (frame: FrameLocator, status: string) => frame.getByTestId(`group-${status}`).getByTestId("session-row");

test.describe("a project's sessions", () => {
  test.use({ seed: { into: seedAlpha } });

  test("a project's tab lists its Claude, folder-agent and Codex sessions by status with counts and sums; the Workspace's tab lists every session with a Project column", async ({
    page,
    openShell,
    pomade,
    backend,
  }) => {
    await recordsDone(pomade, 7);
    const call = (params: JsonValue) => pomade.fake.callApi(SESSIONS_SET_STATUS_METHOD, params);
    await call({ ids: [SEEDED.claude], status: "active" });
    await call({ ids: [SEEDED.folderAgent], status: "on-hold", note: "Waiting for the review" });
    await call({ ids: [NEAR_FULL], status: "done-skip" });
    const all = await sessions(pomade);
    const of = (...ids: string[]) => all.filter((s) => ids.includes(s.id));

    const alpha = await openSessions(page, openShell, pomade, "alpha");
    await expect(alpha.getByTestId("sessions-scope")).toHaveText("Alpha");
    await expect(alpha.getByTestId("sessions-count")).toHaveAttribute("data-count", "5");
    const totals = of(SEEDED.claude, SEEDED.folderAgent, SEEDED.codex, UNKNOWN_MODEL);
    await expect(alpha.getByTestId("sessions-count")).toHaveText(formatHeaderSum(5, costSum(totals)));

    const expected: Record<string, string[]> = {
      active: [SEEDED.claude],
      "on-hold": [SEEDED.folderAgent],
      done: [UNKNOWN_MODEL, SEEDED.codex],
      "done-skip": [NEAR_FULL],
    };
    for (const [status, ids] of Object.entries(expected)) {
      await expect(alpha.getByTestId(`group-count-${status}`)).toHaveText(String(ids.length));
      await expect(groupRows(alpha, status)).toHaveCount(ids.length);
      for (const [i, id] of ids.entries()) await expect(groupRows(alpha, status).nth(i)).toHaveAttribute("data-session-id", id);
    }
    await expect(alpha.getByTestId("group-sum-active")).toHaveText(formatMoney(costSum(of(SEEDED.claude)) ?? NaN));
    await expect(alpha.getByTestId("group-sum-done")).toHaveText(formatMoney(costSum(of(UNKNOWN_MODEL, SEEDED.codex)) ?? NaN));
    await expect(alpha.getByTestId("group-sum-done-skip")).toHaveText(`${formatMoney(costSum(of(NEAR_FULL)) ?? NaN)} · not in totals`);

    await expect(row(alpha, SEEDED.claude).getByTestId("cell-agent")).toHaveText("claude");
    await expect(row(alpha, SEEDED.folderAgent).getByTestId("cell-agent")).toHaveText("claude-libra");
    await expect(row(alpha, SEEDED.codex).getByTestId("cell-agent")).toHaveText("codex");
    await expect(row(alpha, SEEDED.codex).getByTestId("cell-model")).toHaveText("gpt-5.6-sol · high");
    await expect(row(alpha, SEEDED.claude).getByTestId("cell-name")).toHaveText("Plan the sessions table");
    await expect(row(alpha, SEEDED.folderAgent).getByTestId("session-note")).toHaveText("Waiting for the review");
    await expect(alpha.getByTestId("sessions-columns")).not.toContainText("Project");
    await expect(alpha.getByTestId("cell-project")).toHaveCount(0);

    const workspace = await openSessions(page, openShell, pomade, null);
    await expect(workspace.getByTestId("sessions-scope")).toHaveText("Workspace · all projects");
    await expect(workspace.getByTestId("sessions-count")).toHaveAttribute("data-count", "7");
    await expect(workspace.getByTestId("sessions-columns")).toContainText("Project");
    await expect(row(workspace, SEEDED.codex).getByTestId("cell-project")).toHaveText("Alpha");
    await expect(row(workspace, IN_BETA).getByTestId("cell-project")).toHaveText("Beta");
    await expect(row(workspace, IN_BUCKET).getByTestId("cell-project")).toHaveText("Workspace");
    await expect(workspace.getByTestId("group-count-done")).toHaveText("4");
    expect(backend.running()).toBe(true);
  });

  test("an unknown model shows — for context and cost; a 92 % context bar is red", async ({ page, openShell, pomade, backend }) => {
    await recordsDone(pomade, 7);
    const alpha = await openSessions(page, openShell, pomade, "alpha");
    const unknown = row(alpha, UNKNOWN_MODEL);
    await expect(unknown.getByTestId("cell-context")).toHaveText("—");
    await expect(unknown.getByTestId("cell-cost")).toHaveText("—");
    await expect(unknown.getByTestId("cell-context").locator("[title]")).toHaveAttribute("title", "claude-mystery-1 is not in the price table");

    const context = row(alpha, NEAR_FULL).getByTestId("cell-context").locator("[data-level]");
    await expect(context).toHaveText("92%");
    await expect(context).toHaveAttribute("data-level", "full");
    await expect(context.locator("span").last()).toHaveCSS("color", "rgb(209, 73, 91)");
    await expect(context.locator("span span")).toHaveCSS("background-color", "rgb(209, 73, 91)");
    await expect(row(alpha, SEEDED.claude).getByTestId("cell-context").locator("[data-level]")).toHaveAttribute("data-level", "normal");
    expect(backend.running()).toBe(true);
  });

  test("columns leave as the tab narrows: effort, model, ~$ est., context, then agent; name and last active stay", async ({ page, openShell, pomade, backend }) => {
    await recordsDone(pomade, 7);
    const alpha = await openSessions(page, openShell, pomade, "alpha");
    const table = alpha.getByTestId("sessions-table");
    await page.setViewportSize({ width: 1600, height: 640 });
    await expect(table).toHaveAttribute("data-columns", "effort model cost context agent");
    const all: string[] = [];
    for (let width = 1600; width >= 400; width -= 20) {
      await page.setViewportSize({ width, height: 640 });
      // The table measures itself after the resize: wait until it shows the columns its width fits.
      const fits = columnsFor(await table.evaluate((el) => el.clientWidth), false);
      const shown = (Object.keys(fits) as (keyof typeof fits)[]).filter((column) => fits[column]).join(" ");
      await expect(table).toHaveAttribute("data-columns", shown);
      all.push(shown);
    }
    expect(all.filter((columns, i) => columns !== all[i - 1])).toEqual(["effort model cost context agent", "model cost context agent", "cost context agent", "context agent", "agent", ""]);
    await expect(row(alpha, SEEDED.claude).getByTestId("cell-name")).toBeVisible();
    await expect(row(alpha, SEEDED.claude).getByTestId("cell-last")).toBeVisible();
    await expect(row(alpha, SEEDED.claude).getByTestId("cell-agent")).toHaveCount(0);
    expect(backend.running()).toBe(true);
  });
});

test.describe("fifteen Done sessions", () => {
  test.use({ seed: { into: seedFifteenInBeta }, viewport: { width: 1280, height: 560 } });

  test("Done shows the latest 10 and Show all 15, and back; a group collapses and expands", async ({ page, openShell, pomade, backend }) => {
    await recordsDone(pomade, 15 + 3);
    const beta = await openSessions(page, openShell, pomade, "beta");
    const done = groupRows(beta, "done");
    await expect(beta.getByTestId("group-count-done")).toHaveText("15");
    await expect(done).toHaveCount(10);
    await expect(done.first()).toHaveAttribute("data-session-id", DONE_IDS[14] ?? "");
    await expect(beta.getByTestId("group-more-done")).toHaveText("Showing 10 of 15 · Show all 15");

    await beta.getByRole("button", { name: "Show all 15" }).click();
    await expect(done).toHaveCount(15);
    await expect(done.last()).toHaveAttribute("data-session-id", DONE_IDS[0] ?? "");
    await beta.getByRole("button", { name: "Show the latest 10 only" }).click();
    await expect(done).toHaveCount(10);

    const toggle = beta.getByTestId("group-toggle-done");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(done).toHaveCount(0);
    await expect(beta.getByTestId("group-more-done")).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(done).toHaveCount(10);

    for (const status of ["active", "on-hold", "done-skip"]) await expect(beta.getByTestId(`group-empty-${status}`)).toBeVisible();
    await expect(beta.getByTestId("group-empty-active")).toHaveText("Nothing active. New sessions start here.");
    expect(backend.running()).toBe(true);
  });

  test("a record edited to on-hold with a note and a new transcript show within 2 s, keeping scroll and collapsed groups", async ({
    page,
    openShell,
    pomade,
    sandbox,
    manifest,
    backend,
  }) => {
    await recordsDone(pomade, 15 + 3);
    const beta = await openSessions(page, openShell, pomade, "beta");
    await expect(groupRows(beta, "done")).toHaveCount(10);
    await beta.getByRole("button", { name: "Show all 15" }).click();
    await beta.getByTestId("group-toggle-done-skip").click();
    const table = beta.getByTestId("sessions-table");
    await table.evaluate((el) => el.scrollTo({ top: 200 }));
    await expect.poll(() => table.evaluate((el) => el.scrollTop)).toBe(200);

    const id = DONE_IDS[3] ?? "";
    const record = join(sandbox.workspace, "Apps", manifest.id, "sessions", `${id}.yaml`);
    const text = await readFile(record, "utf8");
    const edited = Date.now();
    await writeFile(record, `${text.replace("status: done", "status: on-hold")}note: Blocked on the platform\n`);
    await expect(groupRows(beta, "on-hold")).toHaveCount(1, { timeout: WITHIN_MS });
    expect(Date.now() - edited).toBeLessThan(WITHIN_MS);
    await expect(row(beta, id)).toHaveAttribute("data-status", "on-hold");
    await expect(row(beta, id).getByTestId("session-note")).toHaveText("Blocked on the platform");
    await expect(groupRows(beta, "done")).toHaveCount(14);

    const created = Date.now();
    await session(sandbox, FRESH, projectFolder(sandbox, "beta"), new Date(Date.now() + 1000).toISOString());
    await expect(groupRows(beta, "active")).toHaveCount(1, { timeout: WITHIN_MS });
    expect(Date.now() - created).toBeLessThan(WITHIN_MS);
    await expect(groupRows(beta, "active").first()).toHaveAttribute("data-session-id", FRESH);

    // Scroll stays where it was (the browser keeps the rows in view as rows arrive above them), and
    // the collapsed and expanded groups stay so.
    expect(await table.evaluate((el) => el.scrollTop)).toBeGreaterThanOrEqual(200);
    await expect(beta.getByTestId("group-toggle-done-skip")).toHaveAttribute("aria-expanded", "false");
    await expect(beta.getByRole("button", { name: "Show the latest 10 only" })).toBeVisible();
    expect(backend.running()).toBe(true);
  });
});

test("a scope with no sessions shows the empty state", async ({ page, openShell, pomade, backend }) => {
  // The seeded sessions started outside the fixture projects: they are the Workspace's.
  await recordsDone(pomade, 3);
  const alpha = await openSessions(page, openShell, pomade, "alpha");
  await expect(alpha.getByTestId("sessions-empty")).toContainText("No sessions in Alpha yet");
  await expect(alpha.getByTestId("sessions-count")).toHaveText("0 sessions");
  await expect(alpha.getByTestId("sessions-table")).toHaveCount(0);
  expect(backend.running()).toBe(true);
});
