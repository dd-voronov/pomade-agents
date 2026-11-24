// Runner's agent runs in the session data (DESIGN §2.4, §5, §6), published on the fake Pomade's bus
// as `pomade-runner` does: a run started lists the run in `sessions.liveIn` with its job, marks its
// session's record `startedByRunner` and makes the session Working; a run finished drops it and a
// subscriber hears B with `run-finished`. A run without a session id is placed by its folder and
// start once its transcript appears. Script and git runs, and a malformed agent run, change
// nothing. A tab attached to a run's session gives one B, the run's. Runs are let go of when the
// connection to Pomade ends.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { SESSIONS_LIVE_IN_METHOD, checkLiveIn, type AgentTabExitedPayload, type JsonValue, type SessionsLiveInResult } from "pomade-kit/protocol";

import { BUILT_BACKEND, FIXTURE_PROJECTS } from "../harness/app.ts";
import { spawnBackend } from "../harness/backend-process.ts";
import { startFakePomade, type FakePomade } from "../harness/fake-pomade.ts";
import type { Sandbox } from "../harness/sandbox.ts";
import { RUN_FINISHED_EVENT, RUN_STARTED_EVENT, type AgentRunFinished, type AgentRunStarted } from "../src/shared/runner-events.ts";
import { SESSION_CLOSED_EVENT, isSessionClosedEvent } from "../src/shared/session-events.ts";
import { SESSIONS_GET_METHOD, SESSIONS_LIST_METHOD, isSessionsAnswer, type Session } from "../src/shared/sessions.ts";
import { expect, test } from "./fixtures.ts";
import { claudeSession, projectFolder, prompt } from "./transcripts.ts";

const BY_ID = "3a4b5c6d-7e8f-4a9b-8c0d-1e2f3a4b5c01";
const PLACED = "3a4b5c6d-7e8f-4a9b-8c0d-1e2f3a4b5c02";
const ATTACHED = "3a4b5c6d-7e8f-4a9b-8c0d-1e2f3a4b5c03";
const JOB = "Nightly review";

const at = (seconds: number): string => new Date(Date.now() + seconds * 1000).toISOString();

const agentRun = (sandbox: Sandbox, patch: Partial<AgentRunStarted> = {}): AgentRunStarted => ({
  job: "nightly-review",
  name: JOB,
  run: "run-1",
  kind: "agent",
  folder: "Projects/alpha",
  project: "alpha",
  trigger: "schedule",
  sessionId: BY_ID,
  agent: "claude",
  mode: "auto",
  cwd: projectFolder(sandbox, "alpha"),
  startedByRunner: true,
  startedAt: at(0),
  ...patch,
});
const finished = (run: AgentRunStarted, patch: Partial<AgentRunFinished> = {}): AgentRunFinished => ({ ...run, result: "done", exitCode: 0, ...patch });
const otherRun = (kind: string, run: string): Record<string, string> => ({ job: `${kind}-job`, name: `A ${kind} job`, run, kind, folder: "Projects/alpha", project: "alpha", trigger: "manual" });

const publishAsRunner = (pomade: FakePomade, event: string, payload: object): void => pomade.fake.emitEvent(event, payload as JsonValue);

async function liveIn(pomade: FakePomade, folder: string): Promise<SessionsLiveInResult> {
  const answer: unknown = await pomade.fake.callApi(SESSIONS_LIVE_IN_METHOD, { folder }, { from: "pomade" });
  expect(checkLiveIn(answer)).toEqual({ ok: true, result: answer });
  return answer as SessionsLiveInResult;
}

const sessionOf = async (pomade: FakePomade, id: string): Promise<Session | null> =>
  ((await pomade.fake.callApi(SESSIONS_GET_METHOD, { id }, { from: "pomade-runner" }).catch(() => null)) as { session: Session } | null)?.session ?? null;

/** The backend follows Runner's events, and the first run is over. */
async function ready(pomade: FakePomade, message: string): Promise<void> {
  await expect.poll(() => pomade.fake.subscriptions, { message }).toEqual(expect.arrayContaining([RUN_STARTED_EVENT, RUN_FINISHED_EVENT]));
  await expect
    .poll(async () => {
      const answer = await pomade.fake.callApi(SESSIONS_LIST_METHOD).catch(() => null);
      return isSessionsAnswer(answer) && !answer.indexing && answer.sessions.every((s) => s.record !== null);
    }, { message })
    .toBe(true);
}

const recordFile = (sandbox: Sandbox, id: string): Promise<string> => readFile(join(sandbox.workspace, "Apps", "pomade-agents", "sessions", `${id}.yaml`), "utf8").catch(() => "");

test("an agent run is live in its folder with its job and marks its session while it runs; its end is B with run-finished; script and git runs change nothing", async ({ pomade, sandbox, backend }) => {
  const alpha = projectFolder(sandbox, "alpha");
  await ready(pomade, backend.output());
  await claudeSession(sandbox, BY_ID, prompt("Review the night's PRs", at(0), alpha, "main"));
  await expect.poll(async () => (await sessionOf(pomade, BY_ID))?.record?.status, { message: backend.output() }).toBe("active");
  const closed: JsonValue[] = [];
  pomade.fake.subscribeAs("pomade-git", SESSION_CLOSED_EVENT, closed);

  publishAsRunner(pomade, RUN_STARTED_EVENT, otherRun("script", "s-1"));
  publishAsRunner(pomade, RUN_STARTED_EVENT, otherRun("git", "g-1"));
  const run = agentRun(sandbox);
  publishAsRunner(pomade, RUN_STARTED_EVENT, run);
  await expect.poll(() => liveIn(pomade, sandbox.workspace), { message: backend.output() }).toEqual({
    live: true,
    sessions: [{ sessionId: BY_ID, agent: "claude", cwd: alpha, source: "run", job: JOB }],
  });
  expect(await liveIn(pomade, projectFolder(sandbox, "beta"))).toEqual({ live: false, sessions: [] });
  await expect.poll(async () => (await sessionOf(pomade, BY_ID))?.record?.startedByRunner, { message: backend.output() }).toEqual({ job: JOB });
  expect((await sessionOf(pomade, BY_ID))?.live).toBe("working");
  expect(await recordFile(sandbox, BY_ID)).toContain(`startedByRunner:\n  job: ${JOB}\n`);

  publishAsRunner(pomade, RUN_FINISHED_EVENT, { ...otherRun("script", "s-1"), result: "done", exitCode: 0 });
  publishAsRunner(pomade, RUN_FINISHED_EVENT, { ...otherRun("git", "g-1"), result: "failed", exitCode: 1 });
  publishAsRunner(pomade, RUN_FINISHED_EVENT, finished(run));
  await expect.poll(() => liveIn(pomade, sandbox.workspace), { message: backend.output() }).toEqual({ live: false, sessions: [] });
  await expect.poll(() => closed, { message: backend.output() }).toHaveLength(1);
  expect(isSessionClosedEvent(closed[0])).toBe(true);
  expect(closed[0]).toEqual({
    sessionId: BY_ID,
    provider: "claude-code",
    agent: "claude",
    project: { id: "alpha", root: "Projects/alpha" },
    cwd: alpha,
    transcript: join(sandbox.home, ".claude", "projects", "-e2e", `${BY_ID}.jsonl`),
    name: null,
    status: "active",
    startedByRunner: true,
    job: JOB,
    at: expect.any(String),
    reason: "run-finished",
  });
  await expect.poll(async () => (await sessionOf(pomade, BY_ID))?.live).toBe("closed");
  expect((await sessionOf(pomade, BY_ID))?.record?.startedByRunner, "the mark stays").toEqual({ job: JOB });

  // A malformed agent run is logged, and lists nothing.
  const { cwd: _cwd, ...noCwd } = agentRun(sandbox, { run: "run-bad" });
  publishAsRunner(pomade, RUN_STARTED_EVENT, noCwd);
  await expect.poll(() => backend.output()).toContain("a run.started is not an agent run the app can place (its cwd is missing or not valid)");
  expect(await liveIn(pomade, sandbox.workspace)).toEqual({ live: false, sessions: [] });
  expect(closed).toHaveLength(1);
});

test("a run without a session id is placed by its folder and start once its transcript appears, and B goes to that session", async ({ pomade, sandbox, backend }) => {
  const alpha = projectFolder(sandbox, "alpha");
  await ready(pomade, backend.output());
  const closed: JsonValue[] = [];
  pomade.fake.subscribeAs("pomade-git", SESSION_CLOSED_EVENT, closed);

  const run = agentRun(sandbox, { sessionId: null, run: "run-2" });
  publishAsRunner(pomade, RUN_STARTED_EVENT, run);
  await expect.poll(() => liveIn(pomade, alpha), { message: backend.output() }).toEqual({
    live: true,
    sessions: [{ sessionId: null, agent: "claude", cwd: alpha, source: "run", job: JOB }],
  });

  await claudeSession(sandbox, PLACED, prompt("Summarize the night", at(1), alpha));
  await expect.poll(async () => (await liveIn(pomade, alpha)).sessions.map((s) => s.sessionId), { message: backend.output() }).toEqual([PLACED]);
  await expect.poll(async () => (await sessionOf(pomade, PLACED))?.record?.startedByRunner, { message: backend.output() }).toEqual({ job: JOB });
  expect((await sessionOf(pomade, PLACED))?.live).toBe("working");

  publishAsRunner(pomade, RUN_FINISHED_EVENT, finished(run));
  await expect.poll(() => closed, { message: backend.output() }).toEqual([expect.objectContaining({ sessionId: PLACED, reason: "run-finished", startedByRunner: true, job: JOB })]);
  expect(await liveIn(pomade, alpha)).toEqual({ live: false, sessions: [] });
});

test("a tab attached to a run's session shows the tab's state and gives one B, the run's; runs are let go of when the connection ends", async ({ sandbox, manifest }) => {
  const alpha = projectFolder(sandbox, "alpha");
  const host = {
    projects: FIXTURE_PROJECTS,
    activeProject: "alpha",
    workspaceRoot: sandbox.workspace,
    agentTabs: [{ tabId: "tab-attached", projectId: "alpha", agentId: "claude", cwd: alpha, sessionId: ATTACHED, state: "idle" as const }],
  };
  let pomade = await startFakePomade({ manifest, socketPath: sandbox.socketPath, appKey: sandbox.appKey, host });
  const backend = spawnBackend(sandbox, { entry: BUILT_BACKEND });
  try {
    await expect.poll(() => pomade.backendCount(), { message: backend.output() }).toBe(1);
    await ready(pomade, backend.output());
    await claudeSession(sandbox, ATTACHED, prompt("Triage the issues", at(0), alpha));
    await expect.poll(async () => (await sessionOf(pomade, ATTACHED))?.record?.status, { message: backend.output() }).toBe("active");
    const closed: JsonValue[] = [];
    pomade.fake.subscribeAs("pomade-git", SESSION_CLOSED_EVENT, closed);

    const run = agentRun(sandbox, { sessionId: ATTACHED, run: "run-3" });
    publishAsRunner(pomade, RUN_STARTED_EVENT, run);
    await expect.poll(async () => (await liveIn(pomade, alpha)).sessions.map((s) => s.source).sort(), { message: backend.output() }).toEqual(["run", "tab"]);
    expect((await sessionOf(pomade, ATTACHED))?.live, "the tab sees the agent wait").toBe("idle");

    // The user closes the attached tab while the run runs: the session goes on in Runner.
    const exited: AgentTabExitedPayload["reason"] = "tab-closed";
    pomade.fake.emitEvent("agentTab.exited", { tabId: "tab-attached", projectId: "alpha", agentId: "claude", sessionId: ATTACHED, reason: exited });
    pomade.fake.closeAgentTab("tab-attached");
    await expect.poll(async () => (await sessionOf(pomade, ATTACHED))?.live, { message: backend.output() }).toBe("working");
    publishAsRunner(pomade, RUN_FINISHED_EVENT, finished(run));
    await expect.poll(() => closed, { message: backend.output() }).toEqual([expect.objectContaining({ sessionId: ATTACHED, reason: "run-finished" })]);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(closed, "one end, one B").toHaveLength(1);

    // A run still running when Pomade goes away is let go of: no run finished is heard meanwhile.
    publishAsRunner(pomade, RUN_STARTED_EVENT, agentRun(sandbox, { sessionId: ATTACHED, run: "run-4" }));
    await expect.poll(() => liveIn(pomade, alpha), { message: backend.output() }).toMatchObject({ live: true });
    await pomade.close();
    pomade = await startFakePomade({ manifest, socketPath: sandbox.socketPath, appKey: sandbox.appKey, host: { ...host, agentTabs: [] } });
    await expect.poll(() => pomade.backendCount(), { message: backend.output(), timeout: 15_000 }).toBe(1);
    await expect.poll(() => liveIn(pomade, alpha).catch(() => null), { message: backend.output() }).toEqual({ live: false, sessions: [] });
    expect((await sessionOf(pomade, ATTACHED))?.live).toBe("closed");
  } finally {
    await backend.stop();
    await pomade.close();
  }
});
