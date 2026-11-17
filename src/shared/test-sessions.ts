// Sessions for the unit tests: a summary or a session with every field set, the given ones changed.

import type { Session, SessionSummary } from "./sessions.ts";

export function testSummary(patch: Partial<SessionSummary> = {}): SessionSummary {
  const id = patch.id ?? "s1";
  return {
    id,
    provider: "claude-code",
    agent: "claude",
    transcript: `/home/.claude/projects/-w/${id}.jsonl`,
    cwd: "/w",
    branch: null,
    startedAt: "2026-11-17T10:00:00.000Z",
    lastActiveAt: "2026-11-17T10:05:00.000Z",
    model: null,
    effort: null,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    context: null,
    costUsd: null,
    firstMessage: null,
    lastMessage: null,
    lastAnswer: null,
    malformedLines: 0,
    ...patch,
  };
}

export function testSession(patch: Partial<Session> = {}): Session {
  const id = patch.id ?? "s1";
  return {
    id,
    summary: testSummary({ id }),
    record: { id, provider: "claude-code", agent: "claude", status: "active" },
    recordProblem: null,
    attribution: { projects: [], by: "workspace", sharedFolder: false },
    ...patch,
  };
}
