// Search and filters in the Sessions tab through the built backend and the fake Pomade: the search
// finds a session by a word from its name, messages, last agent answer or note, marks the word and
// adds a snippet line for a match the row does not show; a search shows every match, the list
// shows them grouped; the Agent, Folder and (in the Workspace's tab) Project filters narrow the
// rows, their menus counting each choice; nothing matching shows the empty state, and Clear
// restores the table. The bulk bar takes the toolbar's row.

import type { FrameLocator, Locator, Page } from "@playwright/test";
import type { JsonValue } from "pomade-kit/protocol";

import type { FakePomade } from "../harness/fake-pomade.ts";
import type { Sandbox } from "../harness/sandbox.ts";
import { SESSIONS_RENAME_METHOD, SESSIONS_SET_STATUS_METHOD } from "../src/shared/sessions.ts";
import { expect, test, type Shell } from "./fixtures.ts";
import { answer, claudeSession, projectFolder, prompt, seedIntoProject } from "./transcripts.ts";

const SEEDED = { claude: "5b0e8f52-3c1d-4a7e-9f21-6d8c0b4a7e13", folderAgent: "c41f7e2a-9b3d-4e60-8d15-3a7b9c2e1f04", codex: "019a7c3e-5b2d-7f10-8c4e-1d2f3a4b5c6d" };
const ANSWERED = "5e5e5e5e-0000-4000-8000-000000000001";
const NAMED = "5e5e5e5e-0000-4000-8000-000000000002";
const IN_DOCS = "5e5e5e5e-0000-4000-8000-000000000003";
const IN_BETA = "5e5e5e5e-0000-4000-8000-000000000004";
const IN_BUCKET = "5e5e5e5e-0000-4000-8000-000000000005";
/** 14 Done sessions in Alpha: more than a Done group shows until "Show all". */
const BATCH = Array.from({ length: 14 }, (_, i) => `5e5e5e5e-0000-4000-8000-1000000000${String(i + 10)}`);
const ANSWER = "The culprit was a missing debounce in the resize observer; the spec is stable now.";

/** The seeded Claude, folder-agent and Codex sessions in Alpha, and Claude sessions: one whose last
 *  answer holds a word nothing else holds, one to name and note, one in Alpha's `docs/`, a batch in
 *  Alpha, one in Beta, one in the Workspace bucket. */
async function seed(sandbox: Sandbox): Promise<void> {
  await seedIntoProject(sandbox, "alpha");
  const alpha = projectFolder(sandbox, "alpha");
  const docs = `${alpha}/docs`;
  const at = (day: number, hour = 9): string => new Date(Date.UTC(2026, 10, day, hour)).toISOString();
  await claudeSession(sandbox, ANSWERED, prompt("Fix the flaky drag spec", at(16), alpha) + answer({ model: "claude-opus-5-5", input: 20_000, at: at(16, 10), cwd: alpha, text: ANSWER }));
  await claudeSession(sandbox, NAMED, prompt("Port the bulk bar onto the tokens", at(15), alpha));
  await claudeSession(sandbox, IN_DOCS, prompt("Write the search docs", at(14), docs));
  await claudeSession(sandbox, IN_BETA, prompt("Tidy the beta readme", at(13), projectFolder(sandbox, "beta")));
  await claudeSession(sandbox, IN_BUCKET, prompt("A question about the workspace", at(12), "/elsewhere"));
  for (const [i, id] of BATCH.entries()) await claudeSession(sandbox, id, prompt(`Tidy up batch ${i + 1}`, new Date(Date.UTC(2026, 9, 10 + i, 9)).toISOString(), alpha));
}

const call = (pomade: FakePomade, method: string, params: JsonValue) => pomade.fake.callApi(method, params);

/** Every session has its record (the first run adopted them as Done); a few are made Active, one named and noted. */
async function ready(pomade: FakePomade): Promise<void> {
  const active = [ANSWERED, NAMED, IN_DOCS, SEEDED.claude];
  await expect.poll(async () => call(pomade, SESSIONS_SET_STATUS_METHOD, { ids: active, status: "active" }).then(() => true, () => false), { timeout: 10_000 }).toBe(true);
  await call(pomade, SESSIONS_RENAME_METHOD, { id: NAMED, name: "Bulk bar port" });
  await call(pomade, SESSIONS_SET_STATUS_METHOD, { ids: [NAMED], status: "active", note: "Recheck the gradient token" });
}

async function openSessions(page: Page, openShell: (page: Page) => Promise<Shell>, pomade: FakePomade, projectId: string | null): Promise<FrameLocator> {
  pomade.fake.setActiveProject(projectId);
  const shell = await openShell(page);
  await shell.panel.getByTestId("open-sessions").click();
  return shell.tabFrame(projectId ?? "__workspace__");
}

const row = (frame: FrameLocator, id: string): Locator => frame.locator(`[data-testid="session-row"][data-session-id="${id}"]`);
const rowIds = (frame: FrameLocator): Promise<string[]> =>
  frame.getByTestId("session-row").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-session-id") ?? ""));
const menuItem = (frame: FrameLocator, id: string): Locator => frame.getByTestId(`menu-item-${id}`);

test.describe("search and filters", () => {
  test.use({ seed: { into: seed }, viewport: { width: 1280, height: 720 } });

  test("a word only in the last agent answer leaves that row, with an Agent snippet and the word marked; names and notes are searched too", async ({
    page,
    openShell,
    pomade,
    backend,
  }) => {
    await ready(pomade);
    const alpha = await openSessions(page, openShell, pomade, "alpha");
    const field = alpha.getByTestId("search-field");
    await expect(row(alpha, ANSWERED)).toBeVisible();
    await expect(alpha.getByTestId("match-count")).toHaveCount(0);

    // `/` focuses the search.
    await alpha.getByRole("heading", { name: "Sessions", exact: true }).click();
    await page.keyboard.press("/");
    await expect(field).toBeFocused();
    await page.keyboard.type("DEBOUNCE");
    await expect.poll(() => rowIds(alpha)).toEqual([ANSWERED]);
    await expect(alpha.getByTestId("match-count")).toHaveText("1 match");
    const snippet = row(alpha, ANSWERED).getByTestId("search-snippet");
    await expect(snippet).toHaveText(`Agent:${ANSWER}`);
    await expect(snippet.getByTestId("search-match")).toHaveText("debounce");
    // The other groups hold no match: no empty lines under them.
    await expect(alpha.getByTestId("group-empty-done")).toHaveCount(0);

    // A name: marked in the row, no snippet. A note: marked in its line.
    await field.fill("bulk bar");
    await expect.poll(() => rowIds(alpha)).toEqual([NAMED]);
    await expect(row(alpha, NAMED).getByTestId("session-name").getByTestId("search-match")).toHaveText("Bulk bar");
    await expect(row(alpha, NAMED).getByTestId("search-snippet")).toHaveCount(0);
    await field.fill("gradient");
    await expect.poll(() => rowIds(alpha)).toEqual([NAMED]);
    await expect(row(alpha, NAMED).getByTestId("session-note").getByTestId("search-match")).toHaveText("gradient");
    // The first message of a named session: a "First message" snippet.
    await field.fill("onto the tokens");
    await expect(row(alpha, NAMED).getByTestId("search-snippet")).toHaveText("First message:Port the bulk bar onto the tokens");

    // Esc clears the field, then leaves it.
    await field.press("Escape");
    await expect(field).toHaveValue("");
    await expect(field).toBeFocused();
    await expect.poll(() => rowIds(alpha).then((ids) => ids.length)).toBe(4 + 10);
    await field.press("Escape");
    await expect(field).not.toBeFocused();
    expect(backend.running()).toBe(true);
  });

  test("a search shows every match; ↓ goes to the first row, the list shows the matches grouped, and opening a status tab clears the search", async ({
    page,
    openShell,
    pomade,
    backend,
  }) => {
    await ready(pomade);
    const alpha = await openSessions(page, openShell, pomade, "alpha");
    await expect(alpha.getByTestId("group-more-done")).toBeVisible();
    const field = alpha.getByTestId("search-field");

    await field.fill("batch");
    await expect(alpha.getByTestId("match-count")).toHaveText("14 matches");
    await expect(alpha.getByTestId("group-done").getByTestId("session-row")).toHaveCount(14);
    await expect(alpha.getByTestId("group-more-done")).toHaveCount(0);

    // ↓ leaves the field for the first match: the list with the panel, every status grouped.
    await field.press("ArrowDown");
    const newest = BATCH[BATCH.length - 1] ?? "";
    await expect(alpha.getByTestId("detail-panel")).toHaveAttribute("data-session-id", newest);
    const list = alpha.getByTestId("list-matches");
    await expect(list.getByTestId("session-row")).toHaveCount(14);
    await expect(list.getByTestId("group-done")).toBeVisible();
    await expect(alpha.getByTestId("status-tab-done")).toHaveAttribute("aria-selected", "false");
    await expect(alpha.getByTestId("status-tab-count-done")).toHaveText("14");
    await expect(alpha.getByTestId("status-tab-count-active")).toHaveText("0");
    await page.keyboard.press("ArrowDown");
    await expect(alpha.getByTestId("detail-panel")).toHaveAttribute("data-session-id", BATCH[BATCH.length - 2] ?? "");

    // Opening a status tab clears the search and filters.
    await alpha.getByTestId("status-tab-active").click();
    await expect(field).toHaveValue("");
    await expect(alpha.getByTestId("list-active")).toBeVisible();
    await expect(alpha.getByTestId("status-tab-active")).toHaveAttribute("aria-selected", "true");
    expect(backend.running()).toBe(true);
  });

  test("Agent filter codex leaves only Codex sessions; a search matching none shows the empty state; Clear restores the table", async ({ page, openShell, pomade, backend }) => {
    await ready(pomade);
    const alpha = await openSessions(page, openShell, pomade, "alpha");
    const all = 4 + 2 + 14;
    await expect(alpha.getByTestId("sessions-count")).toHaveAttribute("data-count", String(all));
    await expect(alpha.getByTestId("filter-project")).toHaveCount(0);

    // The menu counts each agent's sessions.
    await alpha.getByTestId("filter-agent").click();
    await expect(menuItem(alpha, "filter-agent-all")).toHaveAttribute("aria-checked", "true");
    await expect(menuItem(alpha, "filter-agent-all")).toContainText(String(all));
    await expect(menuItem(alpha, "filter-agent-codex")).toContainText("1");
    await menuItem(alpha, "filter-agent-codex").click();
    await expect.poll(() => rowIds(alpha)).toEqual([SEEDED.codex]);
    await expect(alpha.getByTestId("filter-agent")).toHaveText("codex");
    await expect(alpha.getByTestId("filter-agent")).toHaveAttribute("data-on", "");
    await expect(alpha.getByTestId("match-count")).toHaveText("1 match");
    // The header still counts the whole project.
    await expect(alpha.getByTestId("sessions-count")).toHaveAttribute("data-count", String(all));

    await alpha.getByTestId("search-field").fill("debounce");
    await expect(alpha.getByTestId("sessions-no-match")).toBeVisible();
    await expect(alpha.getByTestId("sessions-no-match")).toContainText("No sessions match");
    await expect(alpha.getByTestId("sessions-no-match")).toContainText("Nothing in names, messages or notes contains “debounce” with these filters.");
    await expect(alpha.getByTestId("match-count")).toHaveText("0 matches");
    await alpha.getByTestId("no-match-clear").click();
    await expect(alpha.getByTestId("sessions-table")).toBeVisible();
    await expect.poll(() => rowIds(alpha).then((ids) => ids.length)).toBe(4 + 10);
    await expect(alpha.getByTestId("search-field")).toHaveValue("");
    await expect(alpha.getByTestId("filter-agent")).toHaveText("Agent");
    await expect(alpha.getByTestId("match-count")).toHaveCount(0);

    // Folder, relative to the project; the toolbar's Clear.
    await alpha.getByTestId("filter-folder").click();
    await expect(alpha.getByTestId("filter-menu").getByRole("menuitemradio")).toHaveText(["All folders20", "project root19", "docs1"]);
    await menuItem(alpha, "filter-folder-p:docs").click();
    await expect.poll(() => rowIds(alpha)).toEqual([IN_DOCS]);
    await expect(alpha.getByTestId("filter-folder")).toHaveText("docs");
    await alpha.getByTestId("filters-clear").click();
    await expect(alpha.getByTestId("filter-folder")).toHaveText("Folder");
    await expect.poll(() => rowIds(alpha).then((ids) => ids.length)).toBe(4 + 10);
    expect(backend.running()).toBe(true);
  });

  test("the Workspace's tab: a Project filter with the Workspace bucket, folders relative to the workspace", async ({ page, openShell, pomade, backend }) => {
    await ready(pomade);
    const workspace = await openSessions(page, openShell, pomade, null);
    await workspace.getByTestId("filter-project").click();
    await expect(workspace.getByTestId("filter-menu").getByRole("menuitemradio")).toHaveText(["All projects22", "Alpha20", "Beta1", "Workspace (no project)1"]);
    await menuItem(workspace, "filter-project-__workspace__").click();
    await expect.poll(() => rowIds(workspace)).toEqual([IN_BUCKET]);
    await expect(workspace.getByTestId("filter-project")).toHaveText("Workspace (no project)");

    // The Folder menu counts under the Project filter: Alpha's folders have none.
    await workspace.getByTestId("filter-folder").click();
    await expect(menuItem(workspace, "filter-folder-w:Projects/alpha/docs")).toHaveText("Projects/alpha/docs0");
    await expect(menuItem(workspace, "filter-folder-a:/elsewhere")).toHaveText("/elsewhere1");
    await page.keyboard.press("Escape");
    await workspace.getByTestId("filter-project").click();
    await menuItem(workspace, "filter-project-all").click();
    await workspace.getByTestId("filter-folder").click();
    await menuItem(workspace, "filter-folder-w:Projects/alpha/docs").click();
    await expect.poll(() => rowIds(workspace)).toEqual([IN_DOCS]);
    expect(backend.running()).toBe(true);
  });

  test("checked rows: the bulk bar takes the toolbar's row, so the rows stay put; only matches stay checked", async ({ page, openShell, pomade, backend }) => {
    await ready(pomade);
    const alpha = await openSessions(page, openShell, pomade, "alpha");
    const top = async (): Promise<number> => (await row(alpha, ANSWERED).boundingBox())?.y ?? NaN;
    const before = await top();
    await row(alpha, ANSWERED).getByTestId("row-check").click();
    await expect(alpha.getByTestId("bulk-bar")).toBeVisible();
    await expect(alpha.getByTestId("sessions-toolbar")).toHaveCount(0);
    expect(await top()).toBe(before);
    await row(alpha, NAMED).getByTestId("row-check").click({ modifiers: ["ControlOrMeta"] });
    await expect(alpha.getByTestId("bulk-count")).toHaveText("2 selected");
    await page.keyboard.press("Escape");
    await expect(alpha.getByTestId("sessions-toolbar")).toBeVisible();
    expect(await top()).toBe(before);

    // A search, then Cmd+A: only the matches are checked.
    await alpha.getByTestId("search-field").fill("tidy up batch 1");
    await expect(alpha.getByTestId("match-count")).toHaveText("6 matches");
    await row(alpha, BATCH[0] ?? "").click({ modifiers: ["ControlOrMeta"] });
    await page.keyboard.press("ControlOrMeta+a");
    await expect(alpha.getByTestId("bulk-count")).toHaveText("6 selected");
    expect(backend.running()).toBe(true);
  });
});
