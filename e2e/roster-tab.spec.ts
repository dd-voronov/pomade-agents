// The Roster tab (DESIGN §3.3, T-020): every agent as a card or a row, over the real backend and
// the fake Pomade — the order and the marks, the numbers, Connected to, the view switch, how the
// tab keeps current, no workspace, and that nothing hangs over an edge or scrolls sideways at any
// width. `ROSTER_SHOTS=<folder>` also writes screenshots of both views at several widths.

import { mkdirSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { join } from "node:path";

import type { FrameLocator, Locator, Page } from "@playwright/test";

import { BUILT_BACKEND } from "../harness/app.ts";
import { spawnBackend } from "../harness/backend-process.ts";
import type { FakePomade } from "../harness/fake-pomade.ts";
import { ROSTER_SET_MODEL_METHOD } from "../src/shared/roster.ts";
import { SESSIONS_LIST_METHOD, SESSIONS_MOVE_METHOD, SESSIONS_SET_STATUS_METHOD, isSessionsAnswer, type Session } from "../src/shared/sessions.ts";
import { rosterWindows } from "../src/ui/roster/agent-counts-model.ts";
import { expect, test, type Shell } from "./fixtures.ts";
import { LONG_ID, ROSTER_PROJECTS, agentSession, planned, seedRoster } from "./roster-fixtures.ts";

const SHOTS = process.env.ROSTER_SHOTS;
if (SHOTS !== undefined) mkdirSync(SHOTS, { recursive: true });

/** The tab beside the 44 px strip and the 240 px side panel of the fake Pomade's window. */
const CHROME = 284;
/** Tall when screenshots are taken, so a whole roster shows. */
const viewport = (tab: number): { width: number; height: number } => ({ width: tab + CHROME, height: SHOTS === undefined ? 900 : 1700 });

/** The Roster in the order it lists the agents: the main list, then the hidden section. */
const SHOWN = ["claude", "claude-broken", "claude-coder", "claude-libra", "claude-personal", "claude-pm", LONG_ID, "claude-writer"];
const HIDDEN = ["codex"];

async function openRoster(page: Page, openShell: (page: Page) => Promise<Shell>, project = "agents"): Promise<FrameLocator> {
  const shell = await openShell(page);
  await shell.panel.getByTestId("open-roster").click();
  return shell.tabFrame(project);
}

const ids = (tab: FrameLocator, section: "shown" | "hidden", view: "cards" | "list"): Promise<string[]> =>
  tab
    .getByTestId(view === "cards" ? `roster-cards-${section}` : `roster-list-${section}`)
    .locator('[data-testid^="agent-card-"]')
    .evaluateAll((els) => els.map((el) => (el.getAttribute("data-testid") ?? "").replace("agent-card-", "")));

const routeOf = (pomade: FakePomade, project = "agents"): string | undefined => pomade.fake.appTabs.find((t) => t.projectId === project)?.route;

const weekCount = (n: number): RegExp => new RegExp(`^${n} sessions?( · ~\\$\\d+\\.\\d\\d)?$`);

/** What hangs over an edge or scrolls sideways, in the tab's frame: the page and the Roster's body; a
 *  card's or row's buttons outside it or over each other; a Connected to field whose total or
 *  brackets are clipped; the header's parts outside it. Runs in the page. */
function layoutProblems(): string[] {
  const out: string[] = [];
  const doc = document.documentElement;
  if (doc.scrollWidth > doc.clientWidth) out.push(`the page scrolls sideways (${doc.scrollWidth} > ${doc.clientWidth})`);
  const body = document.querySelector<HTMLElement>('[data-testid="roster-body"]');
  if (body === null) return ["no Roster body"];
  if (body.scrollWidth > body.clientWidth) out.push(`the body scrolls sideways (${body.scrollWidth} > ${body.clientWidth})`);
  const within = (inner: DOMRect, outer: DOMRect): boolean => inner.left >= outer.left - 0.5 && inner.right <= outer.right + 0.5 && inner.top >= outer.top - 0.5 && inner.bottom <= outer.bottom + 0.5;
  const name = (el: HTMLElement): string => el.dataset.testid ?? el.tagName;
  const header = document.querySelector<HTMLElement>("header");
  if (header !== null) {
    for (const el of header.querySelectorAll<HTMLElement>(":scope > *")) {
      if (el.getClientRects().length === 0) continue;
      if (el.getBoundingClientRect().right > header.getBoundingClientRect().right + 0.5) out.push(`the header's ${name(el)} hangs over its edge`);
    }
  }
  for (const box of document.querySelectorAll<HTMLElement>('[data-testid^="agent-card-"]')) {
    const id = box.getAttribute("data-testid") ?? "";
    const outer = box.getBoundingClientRect();
    const buttons = [...box.querySelectorAll<HTMLElement>("button")].filter((b) => b.getClientRects().length > 0);
    for (const b of buttons) {
      // A Connected to field hangs 6 px to each side of its column on purpose.
      if (b.dataset.testid?.startsWith("connected-") !== true && !within(b.getBoundingClientRect(), outer)) out.push(`${id}: ${name(b)} is outside its box`);
    }
    for (const [i, a] of buttons.entries()) {
      for (const b of buttons.slice(i + 1)) {
        const x = a.getBoundingClientRect();
        const y = b.getBoundingClientRect();
        if (x.left < y.right - 0.5 && y.left < x.right - 0.5 && x.top < y.bottom - 0.5 && y.top < x.bottom - 0.5) out.push(`${id}: ${name(a)} overlaps ${name(b)}`);
      }
    }
    const field = box.querySelector<HTMLElement>('[data-testid^="connected-"]');
    if (field !== null && field.dataset.total !== "0") {
      const frame = field.getBoundingClientRect();
      const sum = field.querySelector<HTMLElement>("[data-sum]")?.getBoundingClientRect();
      const closing = [...field.querySelectorAll<HTMLElement>("[data-bracket]")].at(-1)?.getBoundingClientRect();
      if (sum === undefined || closing === undefined) out.push(`${id}: no total or closing bracket`);
      else if (sum.left < frame.left - 0.5 || closing.right > frame.right + 0.5) out.push(`${id}: the total or the closing bracket is clipped`);
      if (field.scrollWidth > field.clientWidth + 0.5) out.push(`${id}: the Connected to field overflows (${field.scrollWidth} > ${field.clientWidth})`);
      // A cut name ends in its "…" with no room left before the comma.
      for (const name of field.querySelectorAll<HTMLElement>("[data-name]")) {
        if (name.getClientRects().length === 0) continue;
        const range = document.createRange();
        range.selectNodeContents(name);
        if (name.getBoundingClientRect().width - range.getBoundingClientRect().width > 1) out.push(`${id}: a gap after "${name.textContent}"`);
      }
      const column = field.parentElement?.getBoundingClientRect();
      if (column !== undefined && (frame.right > column.right + 6.5 || frame.left < column.left - 6.5)) out.push(`${id}: the Connected to field leaves its column`);
    }
  }
  return out;
}

/** A screenshot of the page into `ROSTER_SHOTS`, when that names a folder. */
async function shoot(page: Page, name: string): Promise<void> {
  if (SHOTS !== undefined) await page.screenshot({ path: join(SHOTS, `T-020-${name}.png`) });
}

/** The hidden section open or closed, whichever it is now. */
async function setHiddenOpen(tab: FrameLocator, open: boolean): Promise<void> {
  const toggle = tab.getByTestId("roster-hidden-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== String(open)) await toggle.click();
}

/** What a Connected to field reads, as shown: its visible parts joined ("8 (pomade-agents, Pomade, …)"). */
const fieldText = (field: Locator): Promise<string> =>
  field.evaluate((el) => {
    const shown = el.children.length === 0 ? [el] : [...el.children].filter((child) => child.getClientRects().length > 0);
    return shown
      .map((part) => part.textContent)
      .join("")
      .replace(/\u00a0/g, " ");
  });

const problems = (tab: FrameLocator): Promise<string[]> => tab.locator("body").evaluate(layoutProblems);

test.describe("the Roster with a full roster", () => {
  test.use({ seed: { into: seedRoster }, pomadeSeed: { projects: ROSTER_PROJECTS, activeProject: "agents" } });

  test("lists the built-ins first, then by id, the hidden agents in a collapsible section; an orphan and an unusable profile stay in place, marked", async ({ page, openShell, backend }) => {
    await page.setViewportSize(viewport(1316));
    const tab = await openRoster(page, openShell);
    await expect(tab.getByTestId("roster-cards-shown"), backend.output()).toBeVisible();
    for (const view of ["cards", "list"] as const) {
      await tab.getByTestId(`roster-view-${view}`).click();
      await expect.poll(() => ids(tab, "shown", view)).toEqual(SHOWN);
      expect(await ids(tab, "hidden", view)).toEqual(HIDDEN);
      await expect(tab.getByTestId("roster-count")).toHaveText("9 agents");

      await expect(tab.getByTestId("agent-card-claude").getByTestId("chip-built-in")).toBeVisible();
      await expect(tab.getByTestId("agent-card-codex").getByTestId("chip-hidden")).toBeVisible();
      await expect(tab.getByTestId("agent-card-codex").getByTestId("chip-built-in")).toBeVisible();
      const broken = tab.getByTestId("agent-card-claude-broken");
      await expect(broken.getByTestId("chip-unreadable")).toHaveText("agent.yaml can't be read");
      await expect(broken.getByTestId("chip-unreadable")).toHaveAttribute("title", /not valid YAML/);
      const orphan = tab.getByTestId("agent-card-claude-writer");
      await expect(orphan.getByTestId("chip-orphan")).toBeVisible();
      await expect(orphan.getByTestId("agent-relink-claude-writer")).toBeVisible();
      await expect(orphan.getByTestId("agent-remove-claude-writer")).toBeVisible();
      await expect(orphan.getByTestId("agent-start-claude-writer")).toHaveCount(0);
      await expect(orphan.getByTestId("connected-claude-writer")).toHaveCount(0);
      await expect(orphan.getByTestId("agent-name-claude-writer")).toBeDisabled();
      await expect(tab.getByTestId("agent-card-claude-libra").getByTestId("agent-start-claude-libra")).toBeVisible();
      // The model and effort come from the provider's own config.
      await expect(tab.getByTestId("agent-card-claude")).toContainText("Claude Code");
      await expect(tab.getByTestId("agent-card-claude")).toContainText("opus high");
      await expect(tab.getByTestId("agent-card-codex")).toContainText("Codex");
      await expect(tab.getByTestId("agent-card-codex")).toContainText("gpt-5.2-codex medium");
      await expect(tab.getByTestId("agent-card-claude-coder")).toContainText("provider default");

      // The hidden section folds away and opens again.
      const toggle = tab.getByTestId("roster-hidden-toggle");
      await expect(tab.getByTestId("roster-hidden-count")).toHaveText("1");
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(tab.getByTestId("agent-card-codex")).toHaveCount(0);
      await toggle.click();
      await expect(tab.getByTestId("agent-card-codex")).toBeVisible();
    }
  });

  test("a card and a row show the role line, the tags, the last active and this week's work sessions and ~$, and the header sums them", async ({ page, openShell, backend }) => {
    await page.setViewportSize(viewport(1316));
    const windows = rosterWindows(new Date());
    const tab = await openRoster(page, openShell);
    await expect(tab.getByTestId("agent-week-claude-coder"), backend.output()).toBeVisible();

    const coder = planned("claude-coder", windows);
    await expect(tab.getByTestId("agent-role-claude-coder")).toHaveText("Builds and tests the Pomade family's code to the Owner's engineering bar.");
    await expect(tab.getByTestId("agent-tags-claude-coder")).toContainText("typescript");
    await expect(tab.getByTestId("agent-tags-claude-pm")).toHaveText("No tags");
    await expect(tab.getByTestId("agent-role-claude-libra")).toHaveText("A meticulous librarian for the fixture workspace.");
    await expect(tab.getByTestId("agent-week-claude-coder")).toHaveText(weekCount(coder.week));
    await expect(tab.getByTestId("agent-week-claude-personal")).toHaveText(weekCount(planned("claude-personal", windows).week));
    await expect(tab.getByTestId("agent-week-claude-broken")).toHaveText("0 sessions");
    await expect(tab.getByTestId("agent-last-claude-coder")).toHaveText("now");
    await expect(tab.getByTestId("agent-last-claude-pm")).toHaveText("2h");
    await expect(tab.getByTestId("agent-last-claude-personal")).toHaveText("2d");
    await expect(tab.getByTestId("agent-last-claude-broken")).toHaveText("never");

    // The header: the agents' work sessions this week, the orphan's not among them.
    const total = ["claude", "claude-coder", "claude-libra", "claude-pm", "claude-personal"].reduce((n, agent) => n + planned(agent, windows).week, 0);
    await expect(tab.getByTestId("roster-week")).toHaveAttribute("data-sessions", String(total));
    await expect(tab.getByTestId("roster-week")).toHaveText(new RegExp(`This week: ${total} sessions( · ~\\$\\d+\\.\\d\\d)?$`));

    await tab.getByTestId("roster-view-list").click();
    await expect(tab.getByTestId("agent-week-claude-coder")).toHaveText(new RegExp(`^${coder.week} sessions?(~\\$\\d+\\.\\d\\d)?$`));
    await expect(tab.getByTestId("agent-role-claude-coder")).toHaveText("Builds and tests the Pomade family's code to the Owner's engineering bar.");
  });

  test("Connected to: the total, then the projects the agent has most work sessions in over 90 days, the rest in sidebar order; the tooltip lists all", async ({ page, openShell, backend }) => {
    await page.setViewportSize(viewport(1316));
    const windows = rosterWindows(new Date());
    const tab = await openRoster(page, openShell);
    await expect(tab.getByTestId("connected-claude-coder"), backend.output()).toBeVisible();

    expect(planned("claude-coder", windows).projects).toEqual({ agents: 6, pomade: 3, kit: 2 });
    await expect(tab.getByTestId("connected-claude-coder")).toHaveAttribute(
      "title",
      [
        "Connected to 8, by work sessions in the last 90 days:",
        "pomade-agents — 6 work sessions",
        "Pomade — 3 work sessions",
        "pomade-kit — 2 work sessions",
        "Pomade Runner",
        "Knowledge",
        "Meeting-notes-summarizer-with-a-very-long-name",
        "Translation-quality-evaluation-harness",
        "Atlas Platform",
        "",
        "Open claude-coder's Projects tab",
      ].join("\n"),
    );
    // A card names as many as fit, three at most; the "…" says more are connected.
    const field = tab.getByTestId("connected-claude-coder");
    await expect.poll(() => fieldText(field)).toBe("8 (pomade-agents, Pomade, pomade-kit, …)");
    await expect(field).toHaveAttribute("data-named", "3");

    // Connected to every project: All N. A project that offers every agent counts for each.
    await expect.poll(() => fieldText(tab.getByTestId("connected-claude"))).toMatch(/^All 12 \(/);
    await expect(tab.getByTestId("connected-claude")).toHaveAttribute("title", /^Connected to 12,/);
    // Connected to a few: no "…" when all are named; a name too long for the room is cut, and the "…" says one is left.
    await expect.poll(() => fieldText(tab.getByTestId("connected-claude-libra"))).toBe("3 (Knowledge, Wiki gardening, …)");
    await expect(tab.getByTestId("connected-claude-libra")).toHaveAttribute("title", /\nMeeting-notes-summarizer-with-a-very-long-name\n/);
    await expect.poll(() => fieldText(tab.getByTestId("connected-claude-broken"))).toBe("1 (Knowledge)");
    await expect.poll(() => fieldText(tab.getByTestId(`connected-${LONG_ID}`))).toBe("2 (Knowledge, Translation-quality-e…)");
    // Connected by the project setting even when the agent is hidden from the "+" menu.
    await expect(tab.getByTestId("connected-codex")).toHaveAttribute("title", /^Connected to 2,/);

    // A list row names one or two.
    await tab.getByTestId("roster-view-list").click();
    for (const agent of ["claude", "claude-coder", "claude-libra", "claude-pm"]) {
      const named = Number(await tab.getByTestId(`connected-${agent}`).getAttribute("data-named"));
      expect(named, agent).toBeGreaterThanOrEqual(1);
      expect(named, agent).toBeLessThanOrEqual(2);
    }
    await expect.poll(() => fieldText(tab.getByTestId("connected-claude-coder"))).toMatch(/^8 \(pomade-agents, (Pomade, )?…\)$/);
    expect(await problems(tab)).toEqual([]);
  });

  test("an agent in no project says No projects, and the field still opens its Projects tab", async ({ page, openShell, pomade, backend }) => {
    const tab = await openRoster(page, openShell);
    await expect.poll(() => fieldText(tab.getByTestId("connected-claude-pm")), { message: backend.output() }).toMatch(/^5 \(Pomade, pomade-agents, /);
    for (const project of ROSTER_PROJECTS) pomade.fake.updateProject(project.id, { visibleAgents: project.id === "pomade" ? ["claude"] : ["claude-coder"] });
    await expect.poll(() => fieldText(tab.getByTestId("connected-claude-pm"))).toBe("No projects");
    await expect(tab.getByTestId("connected-claude-pm")).toHaveAttribute("title", "Connected to no project. Open claude-pm's Projects tab");
    await expect.poll(() => fieldText(tab.getByTestId("connected-claude"))).toBe("1 (Pomade)");
    await expect.poll(() => fieldText(tab.getByTestId("connected-claude-coder"))).toMatch(/^11 \(pomade-agents, /);
    await tab.getByTestId("connected-claude-pm").click();
    await expect.poll(() => routeOf(pomade)).toBe("roster/claude-pm/projects");
  });

  test("the view switch is remembered on this Mac: a reload of the frame opens the view chosen last", async ({ page, openShell, backend }) => {
    const tab = await openRoster(page, openShell);
    await expect(tab.getByTestId("roster"), backend.output()).toHaveAttribute("data-view", "cards");
    await expect(tab.getByTestId("roster-view-cards")).toHaveAttribute("aria-pressed", "true");
    await tab.getByTestId("roster-view-list").click();
    await expect(tab.getByTestId("roster")).toHaveAttribute("data-view", "list");
    await expect(tab.getByTestId("roster-view-list")).toHaveAttribute("aria-pressed", "true");
    await expect(tab.getByTestId("roster-view-cards")).toHaveAttribute("aria-pressed", "false");

    const reload = (): Promise<void> =>
      page.locator('[data-testid="tab-frame-agents"]').evaluate((frame: HTMLIFrameElement) => {
        frame.src = frame.src;
      });
    await reload();
    await expect(tab.getByTestId("roster")).toHaveAttribute("data-view", "list");
    await tab.getByTestId("roster-view-cards").click();
    await reload();
    await expect(tab.getByTestId("roster")).toHaveAttribute("data-view", "cards");
  });

  test("navigation lands on the real pages: the name and Open › the agent's Overview, Connected to its Projects tab, New agent the New agent page, ← Roster back to the list", async ({ page, openShell, pomade, backend }) => {
    const tab = await openRoster(page, openShell);
    await expect(tab.getByTestId("agent-name-claude-coder"), backend.output()).toBeVisible();
    const agentPage = tab.getByTestId("agent-page");
    for (const view of ["cards", "list"] as const) {
      await tab.getByTestId(`roster-view-${view}`).click();
      await tab.getByTestId("agent-name-claude-coder").click();
      await expect.poll(() => routeOf(pomade)).toBe("roster/claude-coder/overview");
      await expect(agentPage).toHaveAttribute("data-agent", "claude-coder");
      await expect(agentPage).toHaveAttribute("data-tab", "overview");
      await tab.getByTestId("agent-back").click();
      await expect(tab.getByTestId("roster")).toHaveAttribute("data-view", view);
      await expect.poll(() => routeOf(pomade)).toBe("roster");

      await tab.getByTestId("connected-claude-libra").click();
      await expect.poll(() => routeOf(pomade)).toBe("roster/claude-libra/projects");
      await expect(agentPage).toHaveAttribute("data-agent", "claude-libra");
      await expect(agentPage).toHaveAttribute("data-tab", "projects");
      await tab.getByTestId("agent-back").click();
      await expect(tab.getByTestId("roster")).toBeVisible();

      await tab.getByTestId("roster-new-agent").click();
      await expect.poll(() => routeOf(pomade)).toBe("roster/new");
      await expect(tab.getByTestId("new-agent")).toBeVisible();
      await tab.getByTestId("new-agent-back").click();
      await expect(tab.getByTestId("roster")).toHaveAttribute("data-view", view);
    }
    await tab.getByTestId("roster-view-cards").click();
    await tab.getByTestId("agent-open-claude-pm").click();
    await expect.poll(() => routeOf(pomade)).toBe("roster/claude-pm/overview");
    await expect(agentPage).toHaveAttribute("data-agent", "claude-pm");
    // Every one of those routes is one of the Roster tab's.
    await expect(tab.getByTestId("view-roster")).toHaveAttribute("aria-current", "page");
  });

  test("the role line and the tags keep their room: every card has them at the same height", async ({ page, openShell, backend }) => {
    await page.setViewportSize(viewport(1316));
    const tab = await openRoster(page, openShell);
    await expect(tab.getByTestId("agent-role-claude-coder"), backend.output()).toBeVisible();
    const heights = async (kind: "role" | "tags"): Promise<number[]> => {
      const set = new Set<number>();
      for (const id of [...SHOWN, ...HIDDEN]) {
        const box = await tab.getByTestId(`agent-${kind}-${id}`).boundingBox();
        set.add(Math.round(box?.height ?? -1));
      }
      return [...set];
    };
    expect(await heights("role")).toHaveLength(1);
    expect(await heights("tags")).toEqual([20]);
  });

  test("nothing overlaps, hangs over an edge or scrolls sideways, in either view, from the widest tab down to the one beside the Live now panel and below", async ({ page, openShell, backend }) => {
    const tab = await openRoster(page, openShell);
    await expect(tab.getByTestId("agent-name-claude-coder"), backend.output()).toBeVisible();
    for (const view of ["cards", "list"] as const) {
      await tab.getByTestId(`roster-view-${view}`).click();
      for (const hiddenOpen of [true, false]) {
        await setHiddenOpen(tab, hiddenOpen);
        for (const width of [1316, 1094, 1000, 700, 600, 560, 480, 400, 356]) {
          await page.setViewportSize(viewport(width));
          await expect.poll(() => problems(tab), { message: `${view}, hidden section ${hiddenOpen ? "open" : "closed"}, tab ${width} px wide`, timeout: 5000 }).toEqual([]);
          await shoot(page, `${view}-${width}${hiddenOpen ? "" : "-hidden-closed"}`);
        }
      }
    }
  });

  test("three cards across: the buttons stay inside every card, and at the narrowest card Sessions is an icon", async ({ page, openShell, backend }) => {
    await page.setViewportSize(viewport(1094));
    const tab = await openRoster(page, openShell);
    await expect(tab.getByTestId("agent-card-claude-coder"), backend.output()).toBeVisible();
    const columns = await tab.getByTestId("roster-cards-shown").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    expect(columns).toBe(3);
    expect(await problems(tab)).toEqual([]);
    await expect(tab.getByTestId("agent-sessions-claude-coder")).toContainText("Sessions");

    await page.setViewportSize(viewport(356));
    await expect.poll(() => tab.getByTestId("agent-sessions-claude-coder").innerText()).toBe("");
    expect(await problems(tab)).toEqual([]);
  });

  test.describe("kept current", () => {
    test("a model and effort changed in the provider config reach the card and the row without a reload", async ({ page, openShell, pomade, backend }) => {
      await page.setViewportSize(viewport(1316));
      const tab = await openRoster(page, openShell);
      const card = tab.getByTestId("agent-card-claude-libra");
      await expect(card, backend.output()).toContainText("provider default");
      await pomade.fake.callApi(ROSTER_SET_MODEL_METHOD, { agent: "claude-libra", model: "sonnet", effort: "low" });
      await expect(card).toContainText("sonnet low");
      await expect(card).not.toContainText("provider default");
      await tab.getByTestId("roster-view-list").click();
      await expect(tab.getByTestId("agent-card-claude-libra")).toContainText("sonnet low");
      await pomade.fake.callApi(ROSTER_SET_MODEL_METHOD, { agent: "claude-libra", model: null, effort: null });
      await expect(tab.getByTestId("agent-card-claude-libra")).toContainText("provider default");
    });

    const sessionsOf = async (pomade: FakePomade, agent: string): Promise<Session[]> => {
      const answer = await pomade.fake.callApi(SESSIONS_LIST_METHOD);
      if (!isSessionsAnswer(answer)) throw new Error("malformed sessions.list answer");
      return answer.sessions.filter((s) => s.summary.agent === agent);
    };

    test("a session set to Done–skip, moved to another project, or newly started updates the card's numbers and Connected to order without a reload", async ({ page, openShell, pomade, sandbox, backend }) => {
      await page.setViewportSize(viewport(1316));
      const windows = rosterWindows(new Date());
      const tab = await openRoster(page, openShell);
      const week = (agent: string): Locator => tab.getByTestId(`agent-week-${agent}`);
      const baseline = planned("claude-libra", windows);
      await expect(week("claude-libra"), backend.output()).toHaveText(weekCount(baseline.week));
      await expect.poll(() => fieldText(tab.getByTestId("connected-claude-libra"))).toMatch(/^3 \(Knowledge, Wiki gardening/);
      // The first walk of the stores is done before a status can change.
      await expect
        .poll(async () => (await sessionsOf(pomade, "claude-libra")).filter((s) => s.attribution.projects.includes("knowledge")).length, { timeout: 10_000 })
        .toBe(5);

      // Done–skip: the session is no work session; this week's count and the header's sum drop by one.
      const libra = (await sessionsOf(pomade, "claude-libra")).filter((s) => s.attribution.projects.includes("knowledge"));
      const first = libra[0]?.id ?? "";
      const header = Number(await tab.getByTestId("roster-week").getAttribute("data-sessions"));
      await expect
        .poll(() => pomade.fake.callApi(SESSIONS_SET_STATUS_METHOD, { ids: [first], status: "done-skip" }).then(() => true, () => false), { timeout: 10_000 })
        .toBe(true);
      await expect(week("claude-libra")).toHaveText(weekCount(baseline.week - 1));
      await expect(tab.getByTestId("roster-week")).toHaveAttribute("data-sessions", String(header - 1));
      await expect(tab.getByTestId("connected-claude-libra")).toHaveAttribute("title", /Knowledge — 4 work sessions/);
      await pomade.fake.callApi(SESSIONS_SET_STATUS_METHOD, { ids: [first], status: "active" });
      await expect(week("claude-libra")).toHaveText(weekCount(baseline.week));
      await expect(tab.getByTestId("connected-claude-libra")).toHaveAttribute("title", /Knowledge — 5 work sessions/);

      // Moved to another project: the Connected to order follows the work sessions.
      for (const session of libra.slice(0, 3)) await pomade.fake.callApi(SESSIONS_MOVE_METHOD, { id: session.id, project: "wiki" });
      await expect(tab.getByTestId("connected-claude-libra")).toHaveAttribute("title", /Wiki gardening — 3 work sessions\nKnowledge — 2 work sessions/);
      for (const session of libra.slice(3)) await pomade.fake.callApi(SESSIONS_MOVE_METHOD, { id: session.id, project: "wiki" });
      await expect.poll(() => fieldText(tab.getByTestId("connected-claude-libra"))).toBe("3 (Wiki gardening, Knowledge, …)");
      await expect(tab.getByTestId("connected-claude-libra")).toHaveAttribute("title", /\nWiki gardening — 5 work sessions\nKnowledge\n/);
      await expect(week("claude-libra")).toHaveText(weekCount(baseline.week));

      // A new session appears: the project it is in moves up, the week and last active follow.
      await expect.poll(() => fieldText(tab.getByTestId("connected-claude-personal"))).toBe("4 (Tax 2026, Knowledge, Home budget, …)");
      await agentSession(sandbox, "claude-personal", "budget", 0, "Budget November");
      await expect.poll(() => fieldText(tab.getByTestId("connected-claude-personal")), { timeout: 15_000 }).toBe("4 (Tax 2026, Home budget, Knowledge, …)");
      await expect(week("claude-personal")).toHaveText(weekCount(planned("claude-personal", windows).week + 1));
      await expect(tab.getByTestId("agent-last-claude-personal")).toHaveText("now");
    });

    test("a project's setting, a rename and a removal show at once; a renamed agent folder becomes an orphan and its new name a new card", async ({ page, openShell, pomade, sandbox, backend }) => {
      await page.setViewportSize(viewport(1316));
      const tab = await openRoster(page, openShell);
      await expect(tab.getByTestId("connected-claude-pm"), backend.output()).toHaveAttribute("data-total", "5");
      pomade.fake.updateProject("kit", { visibleAgents: ["claude", "claude-coder"] });
      await expect(tab.getByTestId("connected-claude-pm")).toHaveAttribute("data-total", "4");
      pomade.fake.updateProject("pomade", { name: "Pomade app" });
      await expect.poll(() => fieldText(tab.getByTestId("connected-claude-pm"))).toMatch(/^4 \(Pomade app, pomade-agents/);
      pomade.fake.removeProject("fabric");
      await expect(tab.getByTestId("connected-claude-pm")).toHaveAttribute("data-total", "3");
      await expect.poll(() => fieldText(tab.getByTestId("connected-claude"))).toMatch(/^All 11 \(/);

      await rename(join(sandbox.workspace, "Agents", "claude-pm"), join(sandbox.workspace, "Agents", "claude-product"));
      await expect(tab.getByTestId("agent-card-claude-product")).toBeVisible({ timeout: 10_000 });
      await expect(tab.getByTestId("agent-card-claude-pm").getByTestId("chip-orphan")).toBeVisible();
      await expect(tab.getByTestId("roster-count")).toHaveText("10 agents");
    });
  });
});

test.describe("no workspace", () => {
  test("the two built-ins, read-only, connected to no project, with New agent off", async ({ page, openShell, pomade, sandbox }) => {
    const backend = spawnBackend(sandbox, { entry: BUILT_BACKEND, pomade, env: { POMADE_WORKSPACE: undefined } });
    try {
      await expect.poll(() => pomade.backendCount(), { message: backend.output() }).toBe(1);
      const tab = await openRoster(page, openShell, "alpha");
      await expect(tab.getByTestId("roster-no-workspace"), backend.output()).toBeVisible();
      await expect(tab.getByTestId("roster-count")).toHaveText("2 agents");
      await expect.poll(() => ids(tab, "shown", "cards")).toEqual(["claude", "codex"]);
      await expect(tab.getByTestId("roster-new-agent")).toBeDisabled();
      await expect(tab.getByTestId("roster-first-agent")).toHaveCount(0);
      await expect.poll(() => fieldText(tab.getByTestId("connected-claude"))).toBe("No projects");
      await expect.poll(() => fieldText(tab.getByTestId("connected-codex"))).toBe("No projects");
      await expect(tab.getByTestId("agent-card-claude")).toContainText("opus high");
      await expect(tab.getByTestId("agent-card-codex")).toContainText("gpt-5.2-codex medium");
      await expect(tab.getByTestId("agent-card-claude").getByTestId("chip-built-in")).toBeVisible();
      await shoot(page, "no-workspace");
    } finally {
      await backend.stop();
    }
  });
});

test.describe("only the built-ins in a workspace", () => {
  test.use({ seed: { into: (sandbox) => rm(join(sandbox.workspaceReal, "Agents", "claude-libra"), { recursive: true }) } });

  test("an invitation to the first folder agent follows the built-ins", async ({ page, openShell, backend }) => {
    const tab = await openRoster(page, openShell, "alpha");
    await expect(tab.getByTestId("roster-first-agent"), backend.output()).toBeVisible({ timeout: 10_000 });
    await expect(tab.getByTestId("roster-first-agent").getByRole("button", { name: "New agent" })).toBeVisible();
  });
});
