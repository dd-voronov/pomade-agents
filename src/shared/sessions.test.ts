import { describe, expect, it } from "vitest";

import { contextPercent, isSessionsAnswer, isSessionsChanged, isSessionSummary, type SessionSummary } from "./sessions.ts";

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
    expect(isSessionsAnswer({ epoch: "e", revision: 2, full: false, summaries: [SUMMARY], removed: ["/x"], indexing: false })).toBe(true);
    expect(isSessionsChanged({ epoch: "e", revision: 0 })).toBe(true);
  });

  it("refuses anything else", () => {
    expect(isSessionSummary({ ...SUMMARY, provider: "gemini" })).toBe(false);
    expect(isSessionSummary({ ...SUMMARY, context: { used: 1, window: 0 } })).toBe(false);
    expect(isSessionSummary({ ...SUMMARY, tokens: { input: -1, output: 0, cacheRead: 0, cacheWrite: 0 } })).toBe(false);
    expect(isSessionSummary({ ...SUMMARY, firstMessage: "Fix it" })).toBe(false);
    expect(isSessionsAnswer({ epoch: "e", revision: 2, full: false, summaries: [{ ...SUMMARY, id: 1 }], removed: [], indexing: false })).toBe(false);
    expect(isSessionsAnswer({ epoch: "e", revision: 2, full: false, summaries: [], removed: [], indexing: "no" })).toBe(false);
    expect(isSessionsChanged({ epoch: "e" })).toBe(false);
    expect(isSessionsChanged(null)).toBe(false);
  });

  it("puts context in percent with one decimal", () => {
    expect(contextPercent({ used: 80_000, window: 353_400 })).toBe(22.6);
    expect(contextPercent({ used: 21_200, window: 1_000_000 })).toBe(2.1);
  });
});
