import { describe, expect, it } from "vitest";

import {
  contextPercent,
  isSession,
  isSessionRecord,
  isSessionsAnswer,
  isSessionsChanged,
  isSessionsUpdated,
  isSessionSummary,
  type SessionRecord,
  type SessionSummary,
} from "./sessions.ts";
import { testSession } from "./test-sessions.ts";

const SUMMARY: SessionSummary = {
  id: "s",
  provider: "codex",
  agent: "codex",
  transcript: "/h/.codex/sessions/r.jsonl",
  cwd: "/w",
  branch: null,
  startedAt: "2026-11-17T10:00:00.000Z",
  lastActiveAt: "2026-11-17T10:05:00.000Z",
  model: "gpt-5.6-terra",
  effort: "medium",
  tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 0 },
  context: { used: 80_000, window: 353_400 },
  costUsd: 0.1264,
  firstMessage: { text: "Fix it", at: "2026-11-17T10:00:00.000Z" },
  lastMessage: { text: "Thanks", at: null },
  lastAnswer: null,
  malformedLines: 0,
};

describe("sessions shapes", () => {
  it("accepts a well-formed summary and answer", () => {
    expect(isSessionSummary(SUMMARY)).toBe(true);
    expect(isSessionSummary({ ...SUMMARY, context: null, costUsd: null })).toBe(true);
    const session = testSession({ summary: SUMMARY, id: SUMMARY.id });
    expect(isSessionsAnswer({ epoch: "e", revision: 2, full: false, sessions: [session], removed: ["x"], indexing: false, recordsOff: null })).toBe(true);
    expect(isSessionsAnswer({ epoch: "e", revision: 2, full: true, sessions: [], removed: [], indexing: true, recordsOff: "No workspace" })).toBe(true);
    expect(isSessionsChanged({ epoch: "e", revision: 0 })).toBe(true);
    expect(isSessionsUpdated({ sessions: [session] })).toBe(true);
    expect(isSessionsUpdated({ sessions: [] })).toBe(true);
  });

  it("refuses anything else", () => {
    expect(isSessionSummary({ ...SUMMARY, provider: "gemini" })).toBe(false);
    expect(isSessionSummary({ ...SUMMARY, context: { used: 1, window: 0 } })).toBe(false);
    expect(isSessionSummary({ ...SUMMARY, tokens: { input: -1, output: 0, cacheRead: 0, cacheWrite: 0 } })).toBe(false);
    expect(isSessionSummary({ ...SUMMARY, firstMessage: "Fix it" })).toBe(false);
    const answer = { epoch: "e", revision: 2, full: false, sessions: [], removed: [], indexing: false, recordsOff: null };
    expect(isSessionsAnswer({ ...answer, sessions: [testSession({ summary: { ...SUMMARY, id: 1 } as unknown as SessionSummary })] })).toBe(false);
    expect(isSessionsAnswer({ ...answer, indexing: "no" })).toBe(false);
    expect(isSessionsAnswer({ ...answer, recordsOff: undefined })).toBe(false);
    expect(isSession(testSession({ attribution: { projects: [""], by: "folder", sharedFolder: false } }))).toBe(false);
    expect(isSession(testSession({ attribution: { projects: [], by: "guess" as "folder", sharedFolder: false } }))).toBe(false);
    expect(isSessionsChanged({ epoch: "e" })).toBe(false);
    expect(isSessionsChanged(null)).toBe(false);
    expect(isSessionsUpdated({ sessions: [{ id: "s" }] })).toBe(false);
    expect(isSessionsUpdated({})).toBe(false);
  });

  it("takes a session record with its own keys only, names and notes one line", () => {
    const record: SessionRecord = {
      id: "7b5c",
      provider: "claude-code",
      agent: "claude",
      name: "G4 agents grill",
      status: "on-hold",
      note: "waiting for the test round",
      project: "p1",
      projectRoot: "Projects/Pomade",
      projectOverride: true,
      launchedFrom: "p1",
      forkedFrom: "6a4b",
      startedByRunner: { job: "Morning summary" },
      outsidePomade: true,
      transcript: "/h/.claude/projects/-w/7b5c.jsonl",
      cwd: "/w",
      updated: "2026-11-09T14:32:00Z",
    };
    expect(isSessionRecord(record)).toBe(true);
    expect(isSessionRecord({ id: "7b5c", provider: "codex", agent: "codex", status: "done" })).toBe(true);
    expect(isSessionRecord({ ...record, status: "paused" })).toBe(false);
    expect(isSessionRecord({ ...record, name: "two\nlines" })).toBe(false);
    expect(isSessionRecord({ ...record, name: " " })).toBe(false);
    expect(isSessionRecord({ ...record, projectOverride: false })).toBe(false);
    expect(isSessionRecord({ ...record, startedByRunner: { job: "x", extra: 1 } })).toBe(false);
    expect(isSessionRecord({ ...record, color: "red" })).toBe(false);
    const { agent: _agent, ...noAgent } = record;
    expect(isSessionRecord(noAgent)).toBe(false);
  });

  it("puts context in percent with one decimal", () => {
    expect(contextPercent({ used: 80_000, window: 353_400 })).toBe(22.6);
    expect(contextPercent({ used: 21_200, window: 1_000_000 })).toBe(2.1);
  });
});
