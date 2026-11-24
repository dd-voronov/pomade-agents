// The sessions contract git asks (DESIGN §5, `pomade-kit/protocol` agent-sessions) through the
// fake Pomade's broker, as the caller `pomade`: `sessions.forRepo` lists the sessions started in a
// repository's folder and below, with `branch` only that branch's; `sessions.liveIn` is live while
// an agent tab runs in the folder — before its first prompt too — and not once its agent exits or
// the tab closes. A session's live state reaches `sessions.list` callers as a change. Every answer
// passes the kit's checks unchanged, well inside Pomade's 1.5 s limit.

import { mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";

import {
  SESSIONS_FOR_REPO_METHOD,
  SESSIONS_LIVE_IN_METHOD,
  checkLiveIn,
  checkRepoSessions,
  type JsonValue,
  type RepoSession,
  type SessionsLiveInResult,
} from "pomade-kit/protocol";

import { BUILT_BACKEND, FIXTURE_PROJECTS } from "../harness/app.ts";
import { spawnBackend } from "../harness/backend-process.ts";
import { startFakePomade, type FakePomade } from "../harness/fake-pomade.ts";
import { SESSIONS_LIST_METHOD, isSessionsAnswer, type Session } from "../src/shared/sessions.ts";
import { expect, test } from "./fixtures.ts";
import { claudeSession, projectFolder, prompt } from "./transcripts.ts";

/** Pomade's limit for these reads. */
const LIMIT_MS = 1500;
const ON_MAIN = "6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ON_FEATURE = "7b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e";
const ELSEWHERE = "8c3d4e5f-6a7b-4c8d-ae9f-1a2b3c4d5e6f";
const IN_TAB = "9d4e5f6a-7b8c-4d9e-bfa0-2b3c4d5e6f7a";

/** Ask as Pomade does, and time it. */
async function ask(pomade: FakePomade, method: string, params: JsonValue): Promise<unknown> {
  const started = Date.now();
  const answer = await pomade.fake.callApi(method, params, { from: "pomade" });
  expect(Date.now() - started, `${method} answers inside ${LIMIT_MS} ms`).toBeLessThan(LIMIT_MS);
  return answer;
}

/** `sessions.forRepo`'s sessions, after checking the answer passes the kit's check unchanged. */
async function forRepo(pomade: FakePomade, folder: string, branch?: string): Promise<RepoSession[]> {
  const answer = await ask(pomade, SESSIONS_FOR_REPO_METHOD, branch === undefined ? { folder } : { folder, branch });
  const checked = checkRepoSessions(answer);
  expect(checked).toEqual((answer as { sessions: unknown }).sessions);
  return checked ?? [];
}

/** `sessions.liveIn`'s answer, after checking it passes the kit's check unchanged. */
async function liveIn(pomade: FakePomade, folder: string): Promise<SessionsLiveInResult> {
  const answer = await ask(pomade, SESSIONS_LIVE_IN_METHOD, { folder });
  expect(checkLiveIn(answer)).toEqual({ ok: true, result: answer });
  return answer as SessionsLiveInResult;
}

/** The backend serves, and has recorded every session it found (the first run is over). */
async function ready(pomade: FakePomade, message: string): Promise<void> {
  await expect
    .poll(async () => {
      const answer = await pomade.fake.callApi(SESSIONS_LIST_METHOD).catch(() => null);
      return isSessionsAnswer(answer) && !answer.indexing && answer.sessions.length > 0 && answer.sessions.every((s) => s.record !== null);
    }, { message })
    .toBe(true);
}

async function sessionOf(pomade: FakePomade, id: string): Promise<Session | undefined> {
  const answer = await pomade.fake.callApi(SESSIONS_LIST_METHOD).catch(() => null);
  return isSessionsAnswer(answer) ? answer.sessions.find((s) => s.id === id) : undefined;
}

const at = (minutes: number): string => new Date(Date.now() + minutes * 60_000).toISOString();

test("forRepo lists the sessions started in a folder and below, newest first, and with a branch only that branch's; a symlinked folder is its target", async ({ pomade, sandbox, backend }) => {
  const repo = projectFolder(sandbox, "alpha");
  const worktree = join(repo, ".worktrees", "feature");
  await mkdir(worktree, { recursive: true });
  const link = join(sandbox.root, "alpha-link");
  await symlink(repo, link);
  await ready(pomade, backend.output());
  expect(await forRepo(pomade, repo)).toEqual([]);

  await claudeSession(sandbox, ON_MAIN, prompt("Fix the parser", at(1), repo, "main"));
  await claudeSession(sandbox, ON_FEATURE, prompt("Build the login", at(2), worktree, "feature/login"));
  await claudeSession(sandbox, ELSEWHERE, prompt("Elsewhere", at(3), projectFolder(sandbox, "beta"), "main"));

  await expect.poll(async () => (await forRepo(pomade, repo)).map((s) => s.id), { message: backend.output() }).toEqual([ON_FEATURE, ON_MAIN]);
  const [feature, main] = await forRepo(pomade, repo);
  expect(feature).toEqual({
    id: ON_FEATURE,
    agent: "claude",
    name: null,
    status: "active",
    live: "closed",
    cwd: worktree,
    branch: "feature/login",
    project: "alpha",
    startedAt: expect.any(String),
    lastActiveAt: expect.any(String),
  });
  expect(main).toMatchObject({ id: ON_MAIN, cwd: repo, branch: "main", project: "alpha" });

  expect((await forRepo(pomade, worktree)).map((s) => s.id)).toEqual([ON_FEATURE]);
  expect((await forRepo(pomade, repo, "main")).map((s) => s.id)).toEqual([ON_MAIN]);
  expect((await forRepo(pomade, repo, "feature/login")).map((s) => s.id)).toEqual([ON_FEATURE]);
  expect(await forRepo(pomade, repo, "gone")).toEqual([]);
  expect((await forRepo(pomade, link)).map((s) => [s.id, s.cwd])).toEqual([
    [ON_FEATURE, worktree],
    [ON_MAIN, repo],
  ]);
  await expect(pomade.fake.callApi(SESSIONS_FOR_REPO_METHOD, { folder: "Projects/alpha" }, { from: "pomade" })).rejects.toMatchObject({ code: "invalid-params" });
});

test("liveIn is live while an agent tab runs in the folder — before its first prompt too — and not after its agent exits or the tab closes", async ({ sandbox, manifest }) => {
  const repo = projectFolder(sandbox, "alpha");
  const worktree = join(repo, ".worktrees", "feature");
  await mkdir(worktree, { recursive: true });
  const pomade = await startFakePomade({
    manifest,
    socketPath: sandbox.socketPath,
    appKey: sandbox.appKey,
    host: {
      projects: FIXTURE_PROJECTS,
      activeProject: "alpha",
      workspaceRoot: sandbox.workspace,
      agentTabs: [
        { tabId: "tab-wt", projectId: "alpha", agentId: "claude", cwd: worktree, sessionId: null, state: "idle" },
        { tabId: "tab-beta", projectId: "beta", agentId: "codex", cwd: projectFolder(sandbox, "beta"), sessionId: null, state: "idle" },
      ],
    },
  });
  const backend = spawnBackend(sandbox, { entry: BUILT_BACKEND });
  try {
    await expect.poll(() => pomade.backendCount(), { message: backend.output() }).toBe(1);
    await ready(pomade, backend.output());
    // Before the first prompt: live, with no session.
    await expect.poll(() => liveIn(pomade, repo), { message: backend.output() }).toEqual({
      live: true,
      sessions: [{ sessionId: null, agent: "claude", cwd: worktree, source: "tab", job: null }],
    });
    expect(await liveIn(pomade, worktree)).toMatchObject({ live: true });
    expect(await liveIn(pomade, join(repo, "src"))).toEqual({ live: false, sessions: [] });
    expect((await liveIn(pomade, sandbox.workspace)).sessions.map((s) => s.agent)).toEqual(["claude", "codex"]);

    // Prompted: the tab is bound to its session, which is Working — in sessions.list and forRepo alike.
    await claudeSession(sandbox, IN_TAB, prompt("Build the login", at(1), worktree, "feature/login"));
    pomade.fake.updateAgentTab("tab-wt", { sessionId: IN_TAB, state: "working" });
    await expect.poll(() => liveIn(pomade, repo)).toEqual({
      live: true,
      sessions: [{ sessionId: IN_TAB, agent: "claude", cwd: worktree, source: "tab", job: null }],
    });
    await expect.poll(async () => (await sessionOf(pomade, IN_TAB))?.live, { message: backend.output() }).toBe("working");
    expect((await sessionOf(pomade, IN_TAB))?.liveSince).toEqual(expect.any(String));
    await expect.poll(async () => (await forRepo(pomade, repo, "feature/login")).map((s) => [s.id, s.live])).toEqual([[IN_TAB, "working"]]);

    pomade.fake.updateAgentTab("tab-wt", { state: "needs-you" });
    await expect.poll(async () => (await sessionOf(pomade, IN_TAB))?.live).toBe("needs-you");

    // The agent exits (/exit): the tab stays, nothing runs there.
    pomade.fake.updateAgentTab("tab-wt", { state: "exited" });
    await expect.poll(() => liveIn(pomade, repo)).toEqual({ live: false, sessions: [] });
    await expect.poll(async () => (await sessionOf(pomade, IN_TAB))?.live).toBe("closed");
    expect((await forRepo(pomade, repo)).map((s) => [s.id, s.live])).toEqual([[IN_TAB, "closed"]]);

    // The other tab closes.
    expect(await liveIn(pomade, projectFolder(sandbox, "beta"))).toMatchObject({ live: true });
    pomade.fake.closeAgentTab("tab-beta");
    await expect.poll(() => liveIn(pomade, sandbox.workspace)).toEqual({ live: false, sessions: [] });
  } finally {
    await backend.stop();
    await pomade.close();
  }
});
