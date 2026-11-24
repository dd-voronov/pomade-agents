import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkLiveIn, checkRepoSessions } from "pomade-kit/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Session } from "../../shared/sessions.ts";
import { testSession, testSummary } from "../../shared/test-sessions.ts";
import { createRealPaths } from "../core/real-paths.ts";
import { liveSessions, repoSessions } from "./for-git.ts";
import type { LiveEntry } from "./live-state.ts";

describe("the answers for git", () => {
  let dir: string;
  /** A repository and its worktree, a folder elsewhere, and a symlink to the repository. */
  let repo: string;
  let worktree: string;
  let other: string;
  let link: string;
  const real = createRealPaths();

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), "pa-git-")));
    repo = join(dir, "repo");
    worktree = join(repo, ".worktrees", "feature");
    other = join(dir, "repo-other");
    link = join(dir, "link");
    await mkdir(worktree, { recursive: true });
    await mkdir(other, { recursive: true });
    await symlink(repo, link);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const session = (id: string, cwd: string | null, patch: Partial<Session> = {}, summary: Partial<Session["summary"]> = {}): Session =>
    testSession({
      id,
      summary: testSummary({ id, cwd, branch: "main", ...summary }),
      record: { id, provider: "claude-code", agent: "claude", status: "on-hold", name: `Name ${id}` },
      attribution: { projects: ["alpha", "twin"], by: "folder", sharedFolder: true },
      live: "working",
      liveSince: "2026-11-21T10:00:00.000Z",
      ...patch,
    });

  it("lists the sessions started in the folder and below, newest activity first, each passing the kit's check unchanged", async () => {
    const sessions = [
      session("root", repo, {}, { lastActiveAt: "2026-11-17T10:00:00.000Z" }),
      session("wt", worktree, { record: { id: "wt", provider: "codex", agent: "codex", status: "done" }, attribution: { projects: [], by: "workspace", sharedFolder: false }, live: "closed", liveSince: null }, { agent: "codex", branch: null, lastActiveAt: "2026-11-18T10:00:00.000Z" }),
      session("elsewhere", other),
      session("no-folder", null),
    ];
    const answer = { sessions: await repoSessions(sessions, { folder: repo }, real) };
    expect(answer.sessions).toEqual([
      { id: "wt", agent: "codex", name: null, status: "done", live: "closed", cwd: worktree, branch: null, project: null, startedAt: "2026-11-17T10:00:00.000Z", lastActiveAt: "2026-11-18T10:00:00.000Z" },
      { id: "root", agent: "claude", name: "Name root", status: "on-hold", live: "working", cwd: repo, branch: "main", project: "alpha", startedAt: "2026-11-17T10:00:00.000Z", lastActiveAt: "2026-11-17T10:00:00.000Z" },
    ]);
    expect(checkRepoSessions(answer)).toEqual(answer.sessions);
    expect(await repoSessions(sessions, { folder: worktree }, real)).toMatchObject([{ id: "wt" }]);
  });

  it("with a branch lists only that branch's sessions", async () => {
    const sessions = [session("a", repo, {}, { branch: "feature/login" }), session("b", worktree, {}, { branch: "main" }), session("c", repo, {}, { branch: null })];
    expect((await repoSessions(sessions, { folder: repo, branch: "feature/login" }, real)).map((s) => s.id)).toEqual(["a"]);
    expect(await repoSessions(sessions, { folder: repo, branch: "gone" }, real)).toEqual([]);
  });

  it("matches a symlinked folder with its target, either way, and answers the target", async () => {
    const viaLink = session("via-link", join(link, ".worktrees", "feature"));
    const direct = session("direct", repo);
    expect((await repoSessions([viaLink, direct], { folder: repo }, real)).map((s) => [s.id, s.cwd])).toEqual([
      ["via-link", worktree],
      ["direct", repo],
    ]);
    expect((await repoSessions([direct], { folder: link }, real)).map((s) => s.cwd)).toEqual([repo]);
  });

  it("does not take a sibling folder sharing the name's start for one inside", async () => {
    expect(await repoSessions([session("x", other)], { folder: repo }, real)).toEqual([]);
  });

  it("leaves out a session it cannot answer in full: no record, or no activity times", async () => {
    const sessions = [
      session("unrecorded", repo, { record: null, recordProblem: "not YAML" }),
      session("untimed", repo, {}, { startedAt: null }),
      session("ok", repo),
    ];
    expect((await repoSessions(sessions, { folder: repo }, real)).map((s) => s.id)).toEqual(["ok"]);
  });

  it("answers what runs in the folder and below — a tab not prompted yet too — passing the kit's check unchanged", async () => {
    const entries: LiveEntry[] = [
      { source: "tab", key: "t1", projectId: "alpha", sessionId: null, agent: "claude", cwd: worktree, state: "idle", job: null, since: "2026-11-21T10:00:00.000Z" },
      { source: "tab", key: "t2", projectId: "alpha", sessionId: "s1", agent: "claude-libra", cwd: join(link, ".worktrees"), state: "working", job: null, since: "2026-11-21T10:00:00.000Z" },
      { source: "tab", key: "t3", projectId: "alpha", sessionId: "s2", agent: "codex", cwd: other, state: "needs-you", job: null, since: "2026-11-21T10:00:00.000Z" },
      { source: "tab", key: "t4", projectId: "alpha", sessionId: "s3", agent: "codex", cwd: null, state: "idle", job: null, since: "2026-11-21T10:00:00.000Z" },
    ];
    const answer = await liveSessions(entries, { folder: link }, real);
    expect(answer).toEqual({
      live: true,
      sessions: [
        { sessionId: null, agent: "claude", cwd: worktree, source: "tab", job: null },
        { sessionId: "s1", agent: "claude-libra", cwd: join(repo, ".worktrees"), source: "tab", job: null },
      ],
    });
    expect(checkLiveIn(answer)).toEqual({ ok: true, result: answer });

    const none = await liveSessions(entries, { folder: join(repo, "src") }, real);
    expect(none).toEqual({ live: false, sessions: [] });
    expect(checkLiveIn(none)).toEqual({ ok: true, result: none });
  });

  it("answers well inside Pomade's 1.5 s with a large store", async () => {
    const many = Array.from({ length: 20_000 }, (_, i) => session(`s${i}`, join(i % 2 === 0 ? repo : other, `d${i % 300}`)));
    const started = performance.now();
    const answer = await repoSessions(many, { folder: repo }, createRealPaths());
    const took = performance.now() - started;
    expect(answer).toHaveLength(10_000);
    expect(took).toBeLessThan(500);
  });
});
