// The session reads and events Runner uses (DESIGN §5, §6), through the fake Pomade's broker and
// bus as another app: `sessions.get`, `sessions.lastMessage` (a session's last agent answer) and
// `sessions.find` (the sessions started in a folder within a time window); event C
// `session.statusChanged` 5 s after a status change — none for one taken back inside the window,
// one per session for a bulk change, the pending ones on a requested stop — and event B
// `session.closed` when the agent in a tab bound to a session exits and when the tab closes.

import { mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";

import type { AgentTabExitedPayload, JsonValue } from "pomade-kit/protocol";

import { BUILT_BACKEND, FIXTURE_PROJECTS } from "../harness/app.ts";
import { spawnBackend } from "../harness/backend-process.ts";
import { startFakePomade, type FakePomade } from "../harness/fake-pomade.ts";
import type { Sandbox } from "../harness/sandbox.ts";
import { SESSION_CLOSED_EVENT, SESSION_STATUS_CHANGED_EVENT, STATUS_WINDOW_MS, isSessionClosedEvent, isStatusChangedEvent } from "../src/shared/session-events.ts";
import {
  SESSIONS_FIND_METHOD,
  SESSIONS_GET_METHOD,
  SESSIONS_LAST_MESSAGE_METHOD,
  SESSIONS_LIST_METHOD,
  SESSIONS_RENAME_METHOD,
  SESSIONS_SET_STATUS_METHOD,
  isSession,
  isSessionsAnswer,
} from "../src/shared/sessions.ts";
import { expect, test } from "./fixtures.ts";
import { answer, claudeSession, projectFolder, prompt, seedIntoProject } from "./transcripts.ts";

const RUNNER = { from: "pomade-runner" };
const SEEDED_CLAUDE = "5b0e8f52-3c1d-4a7e-9f21-6d8c0b4a7e13";
const SEEDED_CODEX = "019a7c3e-5b2d-7f10-8c4e-1d2f3a4b5c6d";
const FIRST = "1e2d3c4b-5a69-4788-9a0b-1c2d3e4f5a01";
const SECOND = "1e2d3c4b-5a69-4788-9a0b-1c2d3e4f5a02";
const IN_BETA = "1e2d3c4b-5a69-4788-9a0b-1c2d3e4f5a03";
const BULK = ["2f3e4d5c-6b7a-4899-8a1b-2c3d4e5f6a01", "2f3e4d5c-6b7a-4899-8a1b-2c3d4e5f6a02", "2f3e4d5c-6b7a-4899-8a1b-2c3d4e5f6a03"];
const DEEPER = "1e2d3c4b-5a69-4788-9a0b-1c2d3e4f5a04";
const UNDONE = "2f3e4d5c-6b7a-4899-8a1b-2c3d4e5f6a04";
const MARKDOWN = "Fixed it.\n\n- the parser\n- **its tests**";

const at = (minutes: number): string => new Date(Date.now() + minutes * 60_000).toISOString();

/** The backend serves, and every session it lists has a record (the first run is over). */
async function ready(pomade: FakePomade, ids: readonly string[], message: string): Promise<void> {
  await expect
    .poll(async () => {
      const answer = await pomade.fake.callApi(SESSIONS_LIST_METHOD).catch(() => null);
      if (!isSessionsAnswer(answer) || answer.indexing) return false;
      return ids.every((id) => answer.sessions.some((s) => s.id === id && s.record !== null));
    }, { message })
    .toBe(true);
}

/** A session in a fixture project, prompted at `minutes` from now. */
const sessionIn = (sandbox: Sandbox, id: string, projectId: string, minutes: number): Promise<string> =>
  claudeSession(sandbox, id, prompt(`Work ${id.slice(-2)}`, at(minutes), projectFolder(sandbox, projectId), "main"));

test.describe("reads", () => {
  test.use({ seed: { into: (sandbox) => seedIntoProject(sandbox, "alpha") } });

  test("another app gets a fixture session, its last answer, and the sessions started in a folder within a time window", async ({ pomade, sandbox, backend }) => {
    const alpha = projectFolder(sandbox, "alpha");
    const link = join(sandbox.root, "alpha-link");
    await symlink(alpha, link);
    await sessionIn(sandbox, FIRST, "alpha", -2);
    await claudeSession(sandbox, FIRST, answer({ model: "claude-opus-4-7", input: 100, at: at(-1), cwd: alpha, text: MARKDOWN }));
    await sessionIn(sandbox, SECOND, "alpha", 0);
    await sessionIn(sandbox, IN_BETA, "beta", 0);
    await claudeSession(sandbox, DEEPER, prompt("Docs", at(-1), join(alpha, "docs"), "main"));
    await ready(pomade, [SEEDED_CLAUDE, SEEDED_CODEX, FIRST, SECOND, IN_BETA, DEEPER], backend.output());

    const got = (await pomade.fake.callApi(SESSIONS_GET_METHOD, { id: SEEDED_CLAUDE }, RUNNER)) as { session: unknown };
    expect(isSession(got.session)).toBe(true);
    expect(got.session).toMatchObject({ id: SEEDED_CLAUDE, summary: { provider: "claude-code", cwd: alpha }, record: { status: "done" }, live: "closed" });

    expect(await pomade.fake.callApi(SESSIONS_LAST_MESSAGE_METHOD, { id: SEEDED_CLAUDE }, RUNNER)).toEqual({ message: { text: "Done.", at: "2026-11-10T09:03:05.000Z" } });
    await expect.poll(() => pomade.fake.callApi(SESSIONS_LAST_MESSAGE_METHOD, { id: FIRST }, RUNNER)).toEqual({ message: { text: MARKDOWN, at: expect.any(String) } });
    expect(await pomade.fake.callApi(SESSIONS_LAST_MESSAGE_METHOD, { id: SECOND }, RUNNER)).toEqual({ message: null });
    await expect(pomade.fake.callApi(SESSIONS_GET_METHOD, { id: "ghost" }, RUNNER)).rejects.toMatchObject({ code: "not-found" });
    await expect(pomade.fake.callApi(SESSIONS_LAST_MESSAGE_METHOD, { id: "ghost" }, RUNNER)).rejects.toMatchObject({ code: "not-found" });

    // The seeded Codex rollout, found by its folder (through a symlink) and its launch instant.
    const codex = { cwd: link, startedFrom: "2026-11-12T10:00:05.000Z", startedTo: "2026-11-12T10:00:05Z", agent: "codex" };
    expect(await pomade.fake.callApi(SESSIONS_FIND_METHOD, codex, RUNNER)).toEqual({
      sessions: [{ id: SEEDED_CODEX, provider: "codex", agent: "codex", cwd: alpha, startedAt: "2026-11-12T10:00:05.000Z", lastActiveAt: expect.any(String) }],
    });
    expect(await pomade.fake.callApi(SESSIONS_FIND_METHOD, { ...codex, agent: "claude" }, RUNNER)).toEqual({ sessions: [] });

    const window = { cwd: alpha, startedFrom: at(-3), startedTo: at(1) };
    const found = (await pomade.fake.callApi(SESSIONS_FIND_METHOD, window, RUNNER)) as { sessions: { id: string }[] };
    expect(found.sessions.map((s) => s.id)).toEqual([FIRST, SECOND]);
    expect(await pomade.fake.callApi(SESSIONS_FIND_METHOD, { ...window, startedFrom: at(-1) }, RUNNER)).toEqual({ sessions: [expect.objectContaining({ id: SECOND })] });
    expect(await pomade.fake.callApi(SESSIONS_FIND_METHOD, { ...window, cwd: join(alpha, "docs") }, RUNNER)).toEqual({ sessions: [expect.objectContaining({ id: DEEPER })] });
    await expect(pomade.fake.callApi(SESSIONS_FIND_METHOD, { ...window, cwd: "Projects/alpha" }, RUNNER)).rejects.toMatchObject({ code: "invalid-params" });
  });
});

test("C reaches a subscriber 5 s after a status change: none for one taken back, one per session for a bulk change", async ({ pomade, sandbox, backend }) => {
  // Started once the first run is over: Active.
  await ready(pomade, [SEEDED_CLAUDE], backend.output());
  for (const [i, id] of [...BULK, UNDONE, FIRST].entries()) await sessionIn(sandbox, id, i === 0 ? "beta" : "alpha", i + 1);
  await ready(pomade, [...BULK, UNDONE, FIRST], backend.output());
  await pomade.fake.callApi(SESSIONS_RENAME_METHOD, { id: FIRST, name: "Parser fix" });
  const heard: JsonValue[] = [];
  pomade.fake.subscribeAs("pomade-runner", SESSION_STATUS_CHANGED_EVENT, heard);

  const changed = Date.now();
  await pomade.fake.callApi(SESSIONS_SET_STATUS_METHOD, { ids: [FIRST], status: "done" });
  await pomade.fake.callApi(SESSIONS_SET_STATUS_METHOD, { ids: BULK, status: "on-hold" });
  await pomade.fake.callApi(SESSIONS_SET_STATUS_METHOD, { ids: [UNDONE], status: "done" });
  await pomade.fake.callApi(SESSIONS_SET_STATUS_METHOD, { ids: [UNDONE], status: "active" });

  await expect.poll(() => heard.length, { timeout: STATUS_WINDOW_MS + 3000, intervals: [50] }).toBe(4);
  expect(Date.now() - changed, "nothing is published inside the window").toBeGreaterThanOrEqual(STATUS_WINDOW_MS);
  expect(heard.every(isStatusChangedEvent)).toBe(true);
  const first = heard.find((e) => (e as { sessionId: string }).sessionId === FIRST);
  expect(first).toEqual({
    sessionId: FIRST,
    provider: "claude-code",
    agent: "claude",
    project: { id: "alpha", root: "Projects/alpha" },
    cwd: projectFolder(sandbox, "alpha"),
    transcript: join(sandbox.home, ".claude", "projects", "-e2e", `${FIRST}.jsonl`),
    name: "Parser fix",
    status: "done",
    startedByRunner: false,
    job: null,
    at: expect.any(String),
    from: "active",
    to: "done",
  });
  const bulk = heard.filter((e) => BULK.includes((e as { sessionId: string }).sessionId));
  expect(bulk.map((e) => (e as { sessionId: string }).sessionId).sort()).toEqual([...BULK].sort());
  expect(bulk.find((e) => (e as { sessionId: string }).sessionId === BULK[0])).toMatchObject({ project: { id: "beta", root: "Projects/beta" }, from: "active", to: "on-hold" });
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(heard.map((e) => (e as { sessionId: string }).sessionId), "the change taken back publishes nothing").not.toContain(UNDONE);
});

test("B reaches a subscriber when the agent in a bound tab exits and when a bound tab closes; a requested stop publishes a pending C", async ({ sandbox, manifest }) => {
  const alpha = projectFolder(sandbox, "alpha");
  await mkdir(alpha, { recursive: true });
  const pomade = await startFakePomade({
    manifest,
    socketPath: sandbox.socketPath,
    appKey: sandbox.appKey,
    host: {
      projects: FIXTURE_PROJECTS,
      activeProject: "alpha",
      workspaceRoot: sandbox.workspace,
      agentTabs: [
        { tabId: "tab-1", projectId: "alpha", agentId: "claude", cwd: alpha, sessionId: FIRST, state: "idle" },
        { tabId: "tab-2", projectId: "alpha", agentId: "claude", cwd: alpha, sessionId: SECOND, state: "working" },
      ],
    },
  });
  // There before the first run: adopted as Done.
  await sessionIn(sandbox, FIRST, "alpha", -1);
  await sessionIn(sandbox, SECOND, "alpha", 0);
  const backend = spawnBackend(sandbox, { entry: BUILT_BACKEND });
  try {
    await expect.poll(() => pomade.backendCount(), { message: backend.output() }).toBe(1);
    await ready(pomade, [FIRST, SECOND], backend.output());
    await expect.poll(() => pomade.fake.subscriptions, { message: backend.output() }).toContain("agentTab.exited");
    const closed: JsonValue[] = [];
    const changed: JsonValue[] = [];
    pomade.fake.subscribeAs("pomade-runner", SESSION_CLOSED_EVENT, closed);
    pomade.fake.subscribeAs("pomade-runner", SESSION_STATUS_CHANGED_EVENT, changed);
    const exited = (tabId: string, sessionId: string, reason: AgentTabExitedPayload["reason"]): void =>
      pomade.fake.emitEvent("agentTab.exited", { tabId, projectId: "alpha", agentId: "claude", sessionId, reason });

    // /exit in tab 1: the agent quits, its shell takes the tab back.
    exited("tab-1", FIRST, "exit");
    pomade.fake.closeAgentTab("tab-1");
    await expect.poll(() => closed, { message: backend.output() }).toEqual([expect.objectContaining({ sessionId: FIRST, reason: "exit" })]);
    // Tab 2 closed with its agent running.
    exited("tab-2", SECOND, "tab-closed");
    pomade.fake.closeAgentTab("tab-2");
    await expect.poll(() => closed.length).toBe(2);
    expect(closed.every(isSessionClosedEvent)).toBe(true);
    expect(closed[1]).toEqual({
      sessionId: SECOND,
      provider: "claude-code",
      agent: "claude",
      project: { id: "alpha", root: "Projects/alpha" },
      cwd: alpha,
      transcript: join(sandbox.home, ".claude", "projects", "-e2e", `${SECOND}.jsonl`),
      name: null,
      status: "done",
      startedByRunner: false,
      job: null,
      at: expect.any(String),
      reason: "tab-closed",
    });
    // Pomade quitting pauses the session; that is no end.
    exited("tab-2", SECOND, "quit");

    await pomade.fake.callApi(SESSIONS_SET_STATUS_METHOD, { ids: [FIRST], status: "on-hold" });
    const stopped = Date.now();
    expect(await backend.stop()).toMatchObject({ code: 0, killed: false });
    expect(Date.now() - stopped, "the pending C goes out at once on stop").toBeLessThan(STATUS_WINDOW_MS);
    expect(changed).toEqual([expect.objectContaining({ sessionId: FIRST, from: "done", to: "on-hold" })]);
    expect(closed).toHaveLength(2);
  } finally {
    await backend.stop();
    await pomade.close();
  }
});
