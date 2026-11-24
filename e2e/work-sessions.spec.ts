// Work sessions through the built backend and the fake Pomade: a session set to Done–skip/Failed
// leaves the Sessions tab's header count and sum, its group's sum, `Session.work` and the agent
// counts (`sessions.agentCounts`), and comes back when its status changes again; an agent's
// per-project counts follow a session moved to another project, to the Workspace and back.

import type { FrameLocator, Page } from "@playwright/test";
import type { JsonValue } from "pomade-kit/protocol";

import type { FakePomade } from "../harness/fake-pomade.ts";
import type { Sandbox } from "../harness/sandbox.ts";
import { SESSIONS_LIST_METHOD, SESSIONS_MOVE_METHOD, SESSIONS_SET_STATUS_METHOD, isSessionsAnswer, type Session } from "../src/shared/sessions.ts";
import { SESSIONS_AGENT_COUNTS_METHOD, isAgentCountsAnswer, type AgentCounts } from "../src/shared/work-sessions.ts";
import { costSum, formatHeaderSum, formatMoney } from "../src/ui/sessions/table-model.ts";
import { expect, test, type Shell } from "./fixtures.ts";
import { answer, claudeSession, projectFolder, prompt } from "./transcripts.ts";

const S = Array.from({ length: 3 }, (_, i) => `9c9c9c9c-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
const id = (i: number): string => S[i] as string;
/** Windows wide enough for every fixture time: the window is the caller's. */
const WINDOWS = { weekFrom: "2026-11-01T00:00:00.000Z", projectsFrom: "2026-08-01T00:00:00.000Z" };

/** Three Claude sessions in Alpha, a day apart, each with a priced answer of its own size. */
async function seedThree(sandbox: Sandbox): Promise<void> {
  const alpha = projectFolder(sandbox, "alpha");
  for (const [i, sessionId] of S.entries()) {
    const at = new Date(Date.UTC(2026, 10, 20 - i, 9)).toISOString();
    await claudeSession(sandbox, sessionId, prompt(`Task ${i + 1}`, at, alpha) + answer({ model: "claude-opus-5-5", input: 10_000 * (i + 1), at, cwd: alpha }));
  }
}

const call = (pomade: FakePomade, method: string, params: JsonValue): Promise<unknown> => pomade.fake.callApi(method, params);

/** Every session has its record (the first run adopted them as Done); all are made Active. */
async function ready(pomade: FakePomade): Promise<void> {
  await expect.poll(async () => call(pomade, SESSIONS_SET_STATUS_METHOD, { ids: S, status: "active" }).then(() => true, () => false), { timeout: 10_000 }).toBe(true);
}

async function sessions(pomade: FakePomade): Promise<Session[]> {
  const listed = await pomade.fake.callApi(SESSIONS_LIST_METHOD);
  if (!isSessionsAnswer(listed)) throw new Error("malformed sessions.list answer");
  return listed.sessions.filter((s) => S.includes(s.id));
}

async function claudeCounts(pomade: FakePomade): Promise<AgentCounts | undefined> {
  const counted = await call(pomade, SESSIONS_AGENT_COUNTS_METHOD, WINDOWS);
  if (!isAgentCountsAnswer(counted)) throw new Error("malformed sessions.agentCounts answer");
  return counted.agents.find((agent) => agent.agent === "claude");
}

/** The fixture's own sessions of `claude` (`fixtures/`) count too: the specs compare with them. */
type Tally = { week: number; cost: number; projects: Record<string, number> };

async function tally(pomade: FakePomade): Promise<Tally> {
  const counts = await claudeCounts(pomade);
  return {
    week: counts?.week.sessions ?? 0,
    cost: counts?.week.costUsd ?? 0,
    projects: Object.fromEntries((counts?.projects ?? []).map((p) => [p.project, p.sessions])),
  };
}

/** `base` with `delta` added: sessions per project, the week's sessions and ~$. */
function plus(base: Tally, delta: { week?: number; cost?: number; projects?: Record<string, number> }): Tally {
  const projects = { ...base.projects };
  for (const [project, n] of Object.entries(delta.projects ?? {})) projects[project] = (projects[project] ?? 0) + n;
  for (const [project, n] of Object.entries(projects)) if (n === 0 && base.projects[project] === undefined) delete projects[project];
  return { week: base.week + (delta.week ?? 0), cost: base.cost + (delta.cost ?? 0), projects };
}

/** A tally with its ~$ rounded, so sums in another order compare equal. */
const rounded = (t: Tally): Tally => ({ ...t, cost: Math.round(t.cost * 1e9) / 1e9 });

async function openSessions(page: Page, openShell: (page: Page) => Promise<Shell>, pomade: FakePomade, projectId: string): Promise<FrameLocator> {
  pomade.fake.setActiveProject(projectId);
  const shell = await openShell(page);
  await shell.panel.getByTestId("open-sessions").click();
  return shell.tabFrame(projectId);
}

test.describe("work sessions", () => {
  test.use({ seed: { into: seedThree } });

  test("a session set to Skip/Failed leaves every count and sum, and comes back when its status changes", async ({ page, openShell, pomade, backend }) => {
    await ready(pomade);
    const all = await sessions(pomade);
    expect(all.map((s) => s.work)).toEqual([true, true, true]);
    const cost = (...ids: string[]): number | null => costSum(all.filter((s) => ids.includes(s.id)));
    const everything = cost(...S);
    const kept = cost(id(0), id(2));
    expect(everything).not.toBeNull();
    expect(kept).not.toBe(everything);

    const whole = await tally(pomade);
    const skipped = rounded(plus(whole, { week: -1, cost: -(cost(id(1)) ?? 0), projects: { alpha: -1 } }));
    expect(whole.projects.alpha).toBe(3);

    const alpha = await openSessions(page, openShell, pomade, "alpha");
    const header = alpha.getByTestId("sessions-count");
    await expect(header, backend.output()).toHaveText(formatHeaderSum(3, everything));
    await expect(alpha.getByTestId("group-sum-active")).toHaveText(formatMoney(everything ?? NaN));

    await call(pomade, SESSIONS_SET_STATUS_METHOD, { ids: [id(1)], status: "done-skip" });
    await expect(header).toHaveAttribute("data-count", "2");
    await expect(header).toHaveText(formatHeaderSum(2, kept));
    await expect(alpha.getByTestId("group-sum-active")).toHaveText(formatMoney(kept ?? NaN));
    await expect(alpha.getByTestId("group-count-done-skip")).toHaveText("1");
    await expect(alpha.getByTestId("group-sum-done-skip")).toHaveText("not in totals");
    expect((await sessions(pomade)).find((s) => s.id === id(1))?.work).toBe(false);
    expect(rounded(await tally(pomade))).toEqual(skipped);

    await call(pomade, SESSIONS_SET_STATUS_METHOD, { ids: [id(1)], status: "done" });
    await expect(header).toHaveText(formatHeaderSum(3, everything));
    await expect(alpha.getByTestId("group-sum-active")).toHaveText(formatMoney(kept ?? NaN));
    await expect(alpha.getByTestId("group-sum-done")).toHaveText(formatMoney(cost(id(1)) ?? NaN));
    await expect(alpha.getByTestId("group-sum-done-skip")).toHaveCount(0);
    expect((await sessions(pomade)).find((s) => s.id === id(1))?.work).toBe(true);
    expect(rounded(await tally(pomade))).toEqual(rounded(whole));
  });

  test("an agent's per-project counts follow a session moved to another project, to the Workspace and back", async ({ pomade, backend }) => {
    expect(backend.running()).toBe(true);
    await ready(pomade);
    const newest = (await sessions(pomade)).find((s) => s.id === id(0))?.summary.lastActiveAt;
    const whole = await tally(pomade);
    expect(whole.projects.alpha).toBe(3);
    expect(whole.projects.beta).toBeUndefined();

    await call(pomade, SESSIONS_MOVE_METHOD, { id: id(0), project: "beta" });
    expect(await tally(pomade)).toEqual(plus(whole, { projects: { alpha: -1, beta: 1 } }));
    expect((await claudeCounts(pomade))?.projects.find((p) => p.project === "beta")?.lastAt).toBe(newest);

    await call(pomade, SESSIONS_MOVE_METHOD, { id: id(0), project: "__workspace__" });
    expect(await tally(pomade)).toEqual(plus(whole, { projects: { alpha: -1, __workspace__: 1 } }));

    await call(pomade, SESSIONS_MOVE_METHOD, { id: id(0), project: null });
    expect(await tally(pomade)).toEqual(whole);
  });
});
