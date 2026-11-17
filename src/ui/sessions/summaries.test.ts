import { describe, expect, it } from "vitest";

import type { SessionSummary, SessionsAnswer } from "../../shared/sessions.ts";
import { applyAnswer, isBehind } from "./summaries.ts";

const summary = (transcript: string, lastActiveAt = "2026-11-17T10:00:00.000Z"): SessionSummary => ({
  id: transcript,
  provider: "claude-code",
  agent: "claude",
  transcript,
  cwd: "/w",
  branch: null,
  startedAt: null,
  lastActiveAt,
  model: null,
  effort: null,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  context: null,
  costUsd: null,
  firstMessage: null,
  lastMessage: null,
  lastAnswer: null,
  malformedLines: 0,
});

const answer = (a: Partial<SessionsAnswer>): SessionsAnswer => ({ epoch: "e1", revision: 1, full: true, summaries: [], removed: [], indexing: false, ...a });

describe("the UI's copy of the summaries", () => {
  it("is replaced by a full answer and updated by a delta", () => {
    const first = applyAnswer(null, answer({ revision: 3, summaries: [summary("/a"), summary("/b")], indexing: true }));
    expect([...first.byTranscript.keys()]).toEqual(["/a", "/b"]);
    expect(first).toMatchObject({ since: { epoch: "e1", revision: 3 }, indexing: true });

    const delta = applyAnswer(first, answer({ revision: 5, full: false, summaries: [summary("/b", "2026-11-17T11:00:00.000Z"), summary("/c")], removed: ["/a"] }));
    expect([...delta.byTranscript.keys()]).toEqual(["/b", "/c"]);
    expect(delta.byTranscript.get("/b")?.lastActiveAt).toBe("2026-11-17T11:00:00.000Z");
    expect(first.byTranscript.size).toBe(2);

    const restarted = applyAnswer(delta, answer({ epoch: "e2", revision: 1, summaries: [summary("/z")] }));
    expect([...restarted.byTranscript.keys()]).toEqual(["/z"]);
  });

  it("is behind a notice of a later revision or another run", () => {
    const copy = applyAnswer(null, answer({ revision: 4 }));
    expect(isBehind(null, { epoch: "e1", revision: 0 })).toBe(true);
    expect(isBehind(copy, { epoch: "e1", revision: 4 })).toBe(false);
    expect(isBehind(copy, { epoch: "e1", revision: 5 })).toBe(true);
    expect(isBehind(copy, { epoch: "e2", revision: 1 })).toBe(true);
  });
});
