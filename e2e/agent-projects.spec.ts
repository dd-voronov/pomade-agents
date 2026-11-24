// An agent's Projects tab through the built app and backend in the fake Pomade (DESIGN §3.4, T-034):
// one table, Project · Sessions (90 d) · Last session; Connected under the sidebar's groups, the most
// sessions first inside a group, a project offering every agent locked; Not connected with the
// projects the agent worked in first, the never-used ones behind Show all projects; Connect and
// Disconnect write the project's setting and offer Undo, and the project's own settings and this tab
// follow each other; a row opens the agent's Sessions tab filtered to the project. Every write is
// read back from the fake Pomade. `PROJECTS_SHOTS=<folder>` also writes screenshots.

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import type { FrameLocator, Locator, Page } from "@playwright/test";
import type { FakeGroup, FakeProject } from "pomade-kit/fake-host";

import type { FakePomade } from "../harness/fake-pomade.ts";
import { ROSTER_CONNECTIONS_METHOD, isRosterConnectionsAnswer } from "../src/shared/roster.ts";
import { agentRoute } from "../src/ui/core/routes.ts";
import { rosterWindows } from "../src/ui/roster/agent-counts-model.ts";
import { agentName } from "../src/backend/roster/first-sight.ts";
import { expect, test, type Shell } from "./fixtures.ts";
import { LONG_ID, ROSTER_PROJECTS, planned, seedRoster } from "./roster-fixtures.ts";

const SHOTS = process.env.PROJECTS_SHOTS;
if (SHOTS !== undefined) mkdirSync(SHOTS, { recursive: true });

/** The tab beside the 44 px strip and the 240 px side panel of the fake Pomade's window. */
const CHROME = 284;

/** The roster's projects under the sidebar's groups; `Clients` nests in `Work`. */
const GROUPS: FakeGroup[] = [
  { id: "family", name: "Pomade family" },
  { id: "knowledge", name: "Knowledge" },
  { id: "work", name: "Work" },
  { id: "clients", name: "Clients", parent: "work" },
  { id: "personal", name: "Personal" },
];
const GROUP_OF: Record<string, string> = { pomade: "family", agents: "family", kit: "family", runner: "family", knowledge: "knowledge", wiki: "knowledge", ske: "knowledge", fabric: "work", eval: "clients", tax: "personal", budget: "personal", photos: "personal" };
const PROJECTS: FakeProject[] = ROSTER_PROJECTS.map((p) => ({ ...p, group: GROUP_OF[p.id] as string }));

test.use({ seed: { into: seedRoster }, pomadeSeed: { projects: PROJECTS, groups: GROUPS, activeProject: "agents" }, viewport: { width: 1280, height: 900 } });

/** Open the tab in the project `agents` at an agent's page. */
async function openPage(page: Page, openShell: (page: Page) => Promise<Shell>, pomade: FakePomade, agent: string, route = agentRoute(agent, "projects")): Promise<FrameLocator> {
  const { tabFrame } = await openShell(page);
  pomade.fake.openAppTab({ projectId: "agents", route });
  const frame = tabFrame("agents");
  await expect(frame.getByTestId("agent-name")).toHaveText(agentName(agent));
  return frame;
}

const routeOf = (pomade: FakePomade): string | undefined => pomade.fake.appTabs.find((t) => t.projectId === "agents")?.route;

/** The table's rows in the order shown, each as `<group>/<project>` for a connected one. */
const rowIds = (frame: FrameLocator): Promise<string[]> => frame.getByTestId("project-row").evaluateAll((els) => els.map((el) => el.getAttribute("data-project") ?? ""));

const row = (frame: FrameLocator, project: string): Locator => frame.locator(`[data-testid="project-row"][data-project="${project}"]`);

/** The projects the roster says `agent` is connected to, as the backend reads them from the fake Pomade. */
async function connectedTo(pomade: FakePomade, agent: string): Promise<string[]> {
  const answer = await pomade.fake.callApi(ROSTER_CONNECTIONS_METHOD);
  if (!isRosterConnectionsAnswer(answer)) throw new Error("malformed roster.connections answer");
  return answer.connections.find((c) => c.agent === agent)?.projects ?? [];
}

async function shoot(page: Page, name: string): Promise<void> {
  if (SHOTS !== undefined) await page.screenshot({ path: join(SHOTS, `T-034-${name}.png`) });
}

/** What hangs over an edge or scrolls sideways in the Projects tab; runs in the page. */
function layoutProblems(): string[] {
  const out: string[] = [];
  const doc = document.documentElement;
  if (doc.scrollWidth > doc.clientWidth) out.push(`the page scrolls sideways (${doc.scrollWidth} > ${doc.clientWidth})`);
  const body = document.querySelector<HTMLElement>('[data-testid="agent-body"]');
  if (body !== null && body.scrollWidth > body.clientWidth) out.push(`the body scrolls sideways (${body.scrollWidth} > ${body.clientWidth})`);
  const table = document.querySelector<HTMLElement>('[data-testid="projects-table"]')?.getBoundingClientRect();
  if (table === undefined) return [...out, "no table"];
  for (const row of document.querySelectorAll<HTMLElement>('[data-testid="project-row"]')) {
    const box = row.getBoundingClientRect();
    const id = row.dataset.project ?? "?";
    if (Math.abs(box.height - 28) > 0.6) out.push(`${id}: the row is ${box.height}px high`);
    if (box.left < table.left - 0.5 || box.right > table.right + 0.5) out.push(`${id}: the row leaves the table`);
    for (const part of row.querySelectorAll<HTMLElement>("span, button")) {
      if (part.getClientRects().length === 0) continue;
      const rect = part.getBoundingClientRect();
      if (rect.right > box.right + 0.5 || rect.left < box.left - 0.5) out.push(`${id}: ${part.dataset.testid ?? part.className} hangs over the row`);
    }
    const buttons = [...row.querySelectorAll<HTMLElement>("button")].filter((b) => b.getClientRects().length > 0);
    const last = row.querySelector<HTMLElement>('[data-testid="project-last"]')?.getBoundingClientRect();
    for (const b of buttons) {
      const rect = b.getBoundingClientRect();
      if (last !== undefined && b.dataset.testid !== "project-open" && rect.left < last.right - 0.5) out.push(`${id}: ${b.dataset.testid} overlaps the last-session column`);
    }
  }
  return out;
}

const problems = (frame: FrameLocator): Promise<string[]> => frame.locator("body").evaluate(layoutProblems);

test("the table lists the connected projects under the sidebar's groups, the most sessions first, and a project offering every agent is locked", async ({ page, openShell, pomade, backend }) => {
  const windows = rosterWindows(new Date());
  const frame = await openPage(page, openShell, pomade, "claude-coder");
  const mine = planned("claude-coder", windows).projects;
  expect(mine).toEqual({ agents: 6, pomade: 3, kit: 2 });

  await expect(frame.getByTestId("projects-connected"), backend.output()).toContainText("Connected8");
  await expect(frame.getByTestId("projects-table").locator("div").first()).toContainText("Project");
  await expect(frame.getByTestId("projects-table").locator("div").first()).toContainText("Sessions (90 d)");
  await expect(frame.getByTestId("projects-table").locator("div").first()).toContainText("Last session");
  // Under the groups in the panel's order, the most sessions first inside one: ties keep the panel's order.
  await expect(frame.getByTestId("project-sessions").first(), backend.output()).toHaveText("6");
  const groups = await frame.locator('[data-testid="project-group"][data-connected="true"]').evaluateAll((els) => els.map((el) => [el.getAttribute("data-group"), [...el.querySelectorAll('[data-testid="project-row"]')].map((r) => r.getAttribute("data-project"))]));
  expect(groups).toEqual([
    ["Pomade family", ["agents", "pomade", "kit", "runner"]],
    ["Knowledge", ["knowledge", "ske"]],
    ["Work", ["fabric"]],
    ["Work / Clients", ["eval"]],
  ]);
  await expect(row(frame, "agents").getByTestId("project-sessions")).toHaveText("6");
  await expect(row(frame, "pomade").getByTestId("project-sessions")).toHaveText("3");
  await expect(row(frame, "kit").getByTestId("project-sessions")).toHaveText("2");
  await expect(row(frame, "runner").getByTestId("project-sessions")).toHaveText("—");
  await expect(row(frame, "runner").getByTestId("project-last")).toHaveText("—");
  await expect(row(frame, "agents").getByTestId("project-last")).toHaveText("now");
  await expect(row(frame, "pomade").getByTestId("project-last")).toHaveText("1h");
  await expect(row(frame, "agents")).toContainText("pomade-agents");
  await expect(row(frame, "agents")).toContainText("Projects/pomade-agents");
  await expect(row(frame, "agents").getByTestId("project-sessions")).toHaveAttribute("title", "6 work sessions in the last 90 days");
  await expect(row(frame, "runner").getByTestId("project-sessions")).toHaveAttribute("title", "No work sessions in this project");

  // Knowledge offers every agent: connected, locked, nothing to disconnect.
  await expect(row(frame, "knowledge")).toHaveAttribute("data-locked", "true");
  await expect(row(frame, "knowledge").getByTestId("project-locked")).toHaveText("offers every agent");
  await expect(row(frame, "knowledge").getByTestId("project-disconnect")).toHaveCount(0);
  await expect(row(frame, "agents").getByTestId("project-disconnect")).toHaveCount(1);

  // Not connected: four never-used projects, all shown (five or fewer), with Connect.
  await expect(frame.getByTestId("projects-not-connected")).toContainText("Not connected4");
  await expect(frame.getByTestId("projects-show-all")).toHaveCount(0);
  for (const project of ["wiki", "tax", "budget", "photos"]) {
    await expect(row(frame, project)).toHaveAttribute("data-connected", "false");
    await expect(row(frame, project).getByTestId("project-connect")).toBeVisible();
  }
  expect(await rowIds(frame)).toEqual(["agents", "pomade", "kit", "runner", "knowledge", "ske", "fabric", "eval", "wiki", "tax", "budget", "photos"]);
  await expect(frame.getByTestId("projects-caption")).toContainText("work sessions");
  await expect(frame.getByTestId("projects-caption")).toContainText("last 90 days");
  expect(await problems(frame)).toEqual([]);
  await shoot(page, "coder-wide");
});

test("an agent with sessions in a project it is not connected to sees that project first under Not connected with its count; the never-used ones fold behind Show all projects", async ({ page, openShell, pomade, backend }) => {
  const frame = await openPage(page, openShell, pomade, "claude-pm");
  await expect(row(frame, "pomade").getByTestId("project-sessions"), backend.output()).toHaveText("4");
  expect(await connectedTo(pomade, "claude-pm")).toEqual(["pomade", "agents", "kit", "knowledge", "fabric"]);

  // Seven projects it never worked in: folded, since more than five.
  await expect(frame.getByTestId("projects-not-connected")).toContainText("Not connected7");
  await expect(frame.getByTestId("projects-show-all")).toContainText("Show all projects7 more");
  expect(await rowIds(frame)).toEqual(["pomade", "agents", "kit", "knowledge", "fabric"]);
  await shoot(page, "pm-folded");

  // The project setting changes in Pomade: the tab follows, and the project with sessions leads Not connected.
  pomade.fake.updateProject("agents", { visibleAgents: ["claude", "claude-coder"] });
  await expect(row(frame, "agents")).toHaveAttribute("data-connected", "false");
  await expect(frame.getByTestId("projects-not-connected")).toContainText("Not connected8");
  await expect(frame.getByTestId("projects-not-connected")).toContainText("1 with sessions");
  expect(await rowIds(frame)).toEqual(["pomade", "kit", "knowledge", "fabric", "agents"]);
  await expect(row(frame, "agents").getByTestId("project-sessions")).toHaveText("1");
  await expect(row(frame, "agents").getByTestId("project-connect")).toBeVisible();
  await expect(frame.getByTestId("projects-show-all")).toContainText("7 more");

  await frame.getByTestId("projects-show-all").click();
  await expect(frame.getByTestId("projects-show-all")).toHaveCount(0);
  expect(await rowIds(frame)).toEqual(["pomade", "kit", "knowledge", "fabric", "agents", "runner", "wiki", "ske", "eval", "tax", "budget", "photos"]);
  const never = await frame.getByTestId("project-group").evaluateAll((els) => els.filter((el) => el.querySelector('[data-connected="false"]') !== null).map((el) => el.getAttribute("data-group")));
  expect(never).toEqual(["Pomade family", "Knowledge", "Work / Clients", "Personal"]);
  expect(await problems(frame)).toEqual([]);
  await shoot(page, "pm-expanded");
});

test("Connect and Disconnect write the project's setting, offer Undo, and the project's own list shows them", async ({ page, openShell, pomade, backend }) => {
  const frame = await openPage(page, openShell, pomade, "claude-pm");
  await expect(row(frame, "pomade").getByTestId("project-sessions"), backend.output()).toHaveText("4");
  const toast = frame.getByTestId("toast");

  // Connect claude-pm to Pomade Runner: the project's list has it, the row moves up, Undo takes it back.
  await frame.getByTestId("projects-show-all").click();
  await row(frame, "runner").getByTestId("project-connect").click();
  await expect(toast).toContainText("Pomade Runner’s settings now list claude-pm.");
  await expect(row(frame, "runner")).toHaveAttribute("data-connected", "true");
  expect(await connectedTo(pomade, "claude-pm")).toContain("runner");
  await shoot(page, "toast-connect");
  await frame.getByTestId("toast-undo").click();
  await expect(row(frame, "runner")).toHaveAttribute("data-connected", "false");
  expect(await connectedTo(pomade, "claude-pm")).not.toContain("runner");
  await expect(toast).toHaveCount(0);

  // Disconnect it from pomade-kit: its sessions there stay, and Undo puts it back in its place.
  pomade.fake.updateProject("kit", { visibleAgents: ["claude", "claude-pm", "claude-coder"] });
  await expect(row(frame, "kit")).toHaveAttribute("data-connected", "true");
  await row(frame, "kit").hover();
  await row(frame, "kit").getByTestId("project-disconnect").click();
  await expect(toast).toContainText("pomade-kit no longer offers claude-pm. Its sessions there stay.");
  await expect(row(frame, "kit")).toHaveAttribute("data-connected", "false");
  expect(await connectedTo(pomade, "claude-pm")).not.toContain("kit");
  expect(await connectedTo(pomade, "claude-coder")).toContain("kit");
  await shoot(page, "toast-disconnect");
  await frame.getByTestId("toast-undo").click();
  await expect(row(frame, "kit")).toHaveAttribute("data-connected", "true");
  expect(await connectedTo(pomade, "claude-pm")).toContain("kit");
  expect(await connectedTo(pomade, "claude-coder")).toContain("kit");
});

test("a change in the project's own settings reaches the table, and a connection made here reaches Pomade's project list", async ({ page, openShell, pomade, backend }) => {
  const frame = await openPage(page, openShell, pomade, "claude-personal");
  await expect(row(frame, "tax").getByTestId("project-sessions"), backend.output()).toHaveText("2");
  await expect(row(frame, "tax")).toHaveAttribute("data-connected", "true");
  pomade.fake.updateProject("tax", { visibleAgents: ["claude"] });
  await expect(row(frame, "tax")).toHaveAttribute("data-connected", "false");
  await row(frame, "tax").getByTestId("project-connect").click();
  await expect(row(frame, "tax")).toHaveAttribute("data-connected", "true");
  expect(await connectedTo(pomade, "claude-personal")).toContain("tax");
  // The same fact, read the way Pomade's "+" menu reads it.
  const agents = await pomade.fake.callApi("roster.agentsFor", { project: "tax" });
  expect(agents).toEqual({ agents: expect.arrayContaining(["claude", "claude-personal"]) });
});

test("a project that offers every agent cannot be disconnected from here, even after the setting changes under an open table", async ({ page, openShell, pomade, backend }) => {
  const frame = await openPage(page, openShell, pomade, "claude-pm");
  await expect(row(frame, "fabric").getByTestId("project-sessions"), backend.output()).toHaveText("—");
  await expect(row(frame, "fabric").getByTestId("project-disconnect")).toHaveCount(1);
  pomade.fake.updateProject("fabric", { visibleAgents: ["*"] });
  await expect(row(frame, "fabric")).toHaveAttribute("data-locked", "true");
  await expect(row(frame, "fabric").getByTestId("project-disconnect")).toHaveCount(0);
  await expect(row(frame, "fabric").getByTestId("project-locked")).toBeVisible();
});

test("a row opens the agent's Sessions tab filtered to that project, and the filter is the route", async ({ page, openShell, pomade, backend }) => {
  const frame = await openPage(page, openShell, pomade, "claude-coder");
  await expect(row(frame, "agents").getByTestId("project-sessions"), backend.output()).toHaveText("6");

  await row(frame, "agents").getByTestId("project-open").click();
  await expect(frame.getByTestId("agent-page")).toHaveAttribute("data-tab", "sessions");
  await expect.poll(() => routeOf(pomade)).toBe("roster/claude-coder/sessions?project=agents");
  await expect(frame.getByTestId("project-filter")).toContainText("pomade-agents");
  await expect(frame.getByTestId("agent-session-row")).toHaveCount(6);

  // The filter is cleared by the tab's own control, and the route follows.
  await frame.getByTestId("project-filter-clear").click();
  await expect.poll(() => routeOf(pomade)).toBe("roster/claude-coder/sessions");
  await expect(frame.getByTestId("agent-session-row")).toHaveCount(11);

  // A click on the row's blank part is the same; Connect inside it is not.
  await frame.getByTestId("agent-tab-projects").click();
  await row(frame, "kit").getByTestId("project-last").click();
  await expect.poll(() => routeOf(pomade)).toBe("roster/claude-coder/sessions?project=kit");
  await expect(frame.getByTestId("agent-session-row")).toHaveCount(2);

  await frame.getByTestId("agent-tab-projects").click();
  await row(frame, "wiki").getByTestId("project-connect").click();
  await expect(row(frame, "wiki")).toHaveAttribute("data-connected", "true");
  expect(routeOf(pomade)).toBe("roster/claude-coder/projects");
  await expect(frame.getByTestId("agent-page")).toHaveAttribute("data-tab", "projects");
});

test("an agent with no session says so in dashes, offers every project but the connected, and says when nothing offers it", async ({ page, openShell, pomade, backend }) => {
  const frame = await openPage(page, openShell, pomade, "claude-writer");
  await expect(frame.getByTestId("projects-connected"), backend.output()).toContainText("Connected1");
  expect(await rowIds(frame)).toEqual(["knowledge"]);
  await expect(row(frame, "knowledge").getByTestId("project-sessions")).toHaveText("—");
  await expect(frame.getByTestId("projects-not-connected")).toContainText("Not connected11");
  await expect(frame.getByTestId("projects-not-connected")).not.toContainText("with sessions");
  await expect(frame.getByTestId("projects-show-all")).toContainText("11 more");
  await shoot(page, "writer");

  pomade.fake.updateProject("knowledge", { visibleAgents: ["claude"] });
  await expect(frame.getByTestId("projects-none-connected")).toContainText("No project offers claude-writer.");
  await expect(frame.getByTestId("projects-connected")).toContainText("Connected0");
});

test("an agent whose folder is gone cannot be connected; the table still reads", async ({ page, openShell, pomade, backend }) => {
  const frame = await openPage(page, openShell, pomade, "claude-broken");
  await expect(frame.getByTestId("projects-connected"), backend.output()).toContainText("Connected1");
  await frame.getByTestId("projects-show-all").click();
  const connect = row(frame, "wiki").getByTestId("project-connect");
  await expect(connect).toBeDisabled();
  await expect(connect).toHaveAttribute("title", "claude-broken’s profile cannot be read.");
});

test("a long project name is cut at every width, the table never scrolls sideways, and hovering moves nothing", async ({ page, openShell, pomade, backend }) => {
  const frame = await openPage(page, openShell, pomade, LONG_ID);
  await expect(frame.getByTestId("projects-connected"), backend.output()).toContainText("Connected2");
  // The page at rest is the page once the counts are in: the agent has no sessions, so its Needs login notice shows then.
  await expect(frame.getByTestId("agent-needs-login")).toBeVisible();
  for (const [tab, name] of [
    [1316, "wide"],
    [720, "medium"],
    [560, "narrow"],
    [420, "narrowest"],
  ] as const) {
    await page.setViewportSize({ width: tab + CHROME, height: 900 });
    await expect.poll(() => problems(frame), `${name} (${tab})`).toEqual([]);
    // The long project name is cut by the row, whole in its button's text and in the row's tooltip.
    const long = row(frame, "eval").getByTestId("project-open");
    await expect(long).toHaveText("Translation-quality-evaluation-harness");
    await expect(row(frame, "eval")).toHaveAttribute("title", `Show ${LONG_ID}’s sessions in Translation-quality-evaluation-harness`);
    const cut = await long.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(cut, `${name}: cut`).toBe(true);

    // Nothing shifts on hover: the row, its columns and the button keep their boxes.
    const target = row(frame, "eval");
    const boxes = async (): Promise<unknown> => frame.locator("body").evaluate(() => [...document.querySelectorAll('[data-testid="project-row"] *, [data-testid="project-row"]')].map((el) => JSON.stringify(el.getBoundingClientRect())));
    const before = await boxes();
    await target.hover();
    expect(await boxes(), `${name}: hover`).toEqual(before);
    await shoot(page, `long-${name}`);
  }
});

test("a project removed in Pomade leaves the table; one with sessions of the agent that Pomade no longer has is not listed", async ({ page, openShell, pomade, backend }) => {
  const frame = await openPage(page, openShell, pomade, "claude-coder");
  await expect(row(frame, "agents").getByTestId("project-sessions"), backend.output()).toHaveText("6");
  pomade.fake.removeProject("kit");
  await expect(row(frame, "kit")).toHaveCount(0);
  await expect(frame.getByTestId("projects-connected")).toContainText("Connected7");
});
