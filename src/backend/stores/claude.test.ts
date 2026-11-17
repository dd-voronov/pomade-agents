import { describe, expect, it } from "vitest";

import { MESSAGE_MAX_CHARS } from "./session-state.ts";
import { fixture, fixtureLines, summaryOf } from "./test-helpers.ts";

describe("a Claude Code transcript", () => {
  const summary = summaryOf("claude-code", fixture("claude-session.jsonl"), "5b0e8f52-3c1d-4a7e-9f21-6d8c0b4a7e13");

  it("names the session by its file and starts where its first record was written", () => {
    expect(summary).toMatchObject({
      id: "5b0e8f52-3c1d-4a7e-9f21-6d8c0b4a7e13",
      provider: "claude-code",
      cwd: "/work/alpha",
      branch: "main",
      startedAt: "2026-11-10T09:00:01.000Z",
      lastActiveAt: "2026-11-10T09:05:00.000Z",
      malformedLines: 0,
    });
  });

  it("shows the latest turn's model and effort after a mid-session /model switch; a synthetic error turn is no turn", () => {
    expect(summary.model).toBe("claude-sonnet-5-5");
    expect(summary.effort).toBe("medium");
  });

  it("keeps only Daniil's messages: system reminders, task notifications, command caveats and output, interrupts are skipped", () => {
    expect(summary.firstMessage).toEqual({ text: "Plan the sessions table", at: "2026-11-10T09:00:01.000Z" });
    expect(summary.lastMessage).toEqual({ text: "Now write it", at: "2026-11-10T09:03:00.000Z" });
    expect(summary.lastAnswer).toEqual({ text: "Done.", at: "2026-11-10T09:03:05.000Z" });
  });

  it("counts a message's usage once, though the message spans several records", () => {
    // msg_01 is written twice (thinking, then tool use) with the same usage.
    expect(summary.tokens).toEqual({
      input: 10 + 5 + 200,
      output: 500 + 300 + 800,
      cacheRead: 20_000 + 21_000,
      cacheWrite: 20_000 + 1_000,
    });
  });

  it("matches a hand calculation of context % and ~$", () => {
    // Context: the last turn (msg_03, Sonnet 5.5) read 200 + 21 000 cached + 0 written = 21 200
    // input-side tokens, of Sonnet 5.5's 1 000 000-token window → 2.12 %.
    expect(summary.context).toEqual({ used: 21_200, window: 1_000_000 });
    // Cost, $ per million tokens:
    //  msg_01 Opus 5.5 ($4 in, $20 out, 1-hour write 2 × $4 = $8):
    //    10 × 4 + 20 000 × 8 + 500 × 20                = 170 040 → $0.170040
    //  msg_02 Opus 5.5 ($0.20 cache read, 5-minute write 1.25 × $4 = $5):
    //    5 × 4 + 20 000 × 0.20 + 1 000 × 5 + 300 × 20  =  15 020 → $0.015020
    //  msg_03 Sonnet 5.5 ($2 in, $10 out, $0.10 cache read):
    //    200 × 2 + 21 000 × 0.10 + 800 × 10            =  10 500 → $0.010500
    //  total                                                        $0.195560
    expect(summary.costUsd).toBeCloseTo(0.19556, 9);
  });

  it("does not change at the /exit flush: a last-prompt and a snapshot without a turn", () => {
    const flushed = Buffer.concat([
      fixture("claude-session.jsonl"),
      Buffer.from(
        `${JSON.stringify({ type: "last-prompt", lastPrompt: "Now write it", sessionId: "s" })}\n` +
          `${JSON.stringify({ type: "file-history-snapshot", messageId: "m", snapshot: { messageId: "m", trackedFileBackups: {}, timestamp: "2026-11-10T09:30:00.000Z" }, isSnapshotUpdate: true })}\n`,
      ),
    ]);
    expect(summaryOf("claude-code", flushed, summary.id)).toEqual(summary);
  });

  it("grows by a resume: the same file appended, the same session", () => {
    const resumed = Buffer.concat([
      fixture("claude-session.jsonl"),
      Buffer.from(
        `${JSON.stringify({ type: "user", message: { role: "user", content: "One more thing" }, origin: { kind: "human" }, promptSource: "typed", timestamp: "2026-11-11T08:00:00.000Z", cwd: "/work/alpha", gitBranch: "next" })}\n`,
      ),
    ]);
    const after = summaryOf("claude-code", resumed, summary.id);
    expect(after).toMatchObject({ id: summary.id, cwd: "/work/alpha", branch: "main", startedAt: summary.startedAt });
    expect(after.lastMessage).toEqual({ text: "One more thing", at: "2026-11-11T08:00:00.000Z" });
    expect(after.lastActiveAt).toBe("2026-11-11T08:00:00.000Z");
    expect(after.firstMessage).toEqual(summary.firstMessage);
  });

  it("shows the model of the in-session /resume target's next turn when that old file grows again", () => {
    const lines = fixtureLines("claude-session.jsonl");
    const switched = JSON.parse(lines[14] ?? "{}") as Record<string, Record<string, unknown>>;
    switched.message = { ...switched.message, id: "msg_04", model: "claude-opus-4-8" };
    const regrown = `${lines.join("")}${JSON.stringify({ ...switched, timestamp: "2026-11-12T08:00:00.000Z", effort: "xhigh" })}\n`;
    expect(summaryOf("claude-code", regrown)).toMatchObject({ model: "claude-opus-4-8", effort: "xhigh", lastActiveAt: "2026-11-12T08:00:00.000Z" });
  });

  it("starts a session /clear created with no message of its own: the first is the next prompt", () => {
    const cleared = summaryOf("claude-code", fixture("claude-after-clear.jsonl"));
    expect(cleared.firstMessage).toEqual({ text: "Start over with the roster", at: "2026-11-10T10:01:00.000Z" });
    expect(cleared).toMatchObject({ startedAt: "2026-11-10T10:00:00.000Z", model: null, context: null, costUsd: 0 });
  });

  it("keeps a /clear file that holds nothing but the /clear markers as a session without messages", () => {
    const onlyClear = fixtureLines("claude-after-clear.jsonl").slice(0, 4).join("");
    expect(summaryOf("claude-code", onlyClear)).toMatchObject({ firstMessage: null, lastMessage: null, lastAnswer: null });
  });

  it("shows a skill command typed as the first input as Daniil typed it; its injected body, a compaction summary and Pomade's file-context prompt are skipped", () => {
    const skill = summaryOf("claude-code", fixture("claude-skill-first.jsonl"));
    expect(skill.firstMessage).toEqual({ text: "/grill-me the store design", at: "2026-11-11T08:00:00.000Z" });
    expect(skill.lastMessage).toEqual({ text: "[Image #1] what about this layout?", at: "2026-11-11T08:07:00.000Z" });
  });

  it("reads prompts of an older Claude Code that records no origin, skipping local commands, caveats and system prompts", () => {
    const old = summaryOf("claude-code", fixture("claude-no-origin.jsonl"));
    expect(old.firstMessage?.text).toBe("Why does the build fail?");
    expect(old.lastMessage?.text).toBe("Thanks, ship it");
  });

  it("caps a long message", () => {
    const long = "x".repeat(MESSAGE_MAX_CHARS + 50);
    const record = { type: "user", message: { role: "user", content: long }, origin: { kind: "human" }, timestamp: "2026-11-10T09:00:00.000Z" };
    const text = summaryOf("claude-code", `${JSON.stringify(record)}\n`).firstMessage?.text ?? "";
    expect(text).toHaveLength(MESSAGE_MAX_CHARS);
    expect(text.endsWith("…")).toBe(true);
  });

  it("shows no cost and no context for a model the price table lacks", () => {
    const unknown = fixture("claude-session.jsonl").toString("utf8").replaceAll("claude-sonnet-5-5", "claude-sonnet-9");
    const s = summaryOf("claude-code", unknown);
    expect(s.model).toBe("claude-sonnet-9");
    expect(s.costUsd).toBeNull();
    expect(s.context).toBeNull();
  });

  it("bills a fast-mode turn at the model's fast rates", () => {
    const record = {
      type: "assistant",
      timestamp: "2026-11-10T09:00:00.000Z",
      message: { id: "m", model: "claude-opus-5-5", content: [], usage: { input_tokens: 1000, output_tokens: 1000, speed: "fast" } },
    };
    // Fast Opus 5.5: $8 in, $40 out → 1 000 × 8 + 1 000 × 40 = 48 000 → $0.048.
    expect(summaryOf("claude-code", `${JSON.stringify(record)}\n`).costUsd).toBeCloseTo(0.048, 9);
  });
});
