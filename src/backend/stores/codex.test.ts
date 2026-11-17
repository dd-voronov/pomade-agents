import { describe, expect, it } from "vitest";

import { fixture, fixtureLines, parse, summaryOf } from "./test-helpers.ts";

describe("a Codex rollout", () => {
  const summary = summaryOf("codex", fixture("codex-session.jsonl"), "019a7c3e-5b2d-7f10-8c4e-1d2f3a4b5c6d");

  it("takes id, start folder and branch from its session_meta", () => {
    expect(summary).toMatchObject({
      id: "019a7c3e-5b2d-7f10-8c4e-1d2f3a4b5c6d",
      provider: "codex",
      cwd: "/work/beta",
      branch: "feature/x",
      startedAt: "2026-11-12T10:00:05.000Z",
      lastActiveAt: "2026-11-12T10:05:31.000Z",
    });
  });

  it("shows the latest turn_context's model and effort", () => {
    expect(summary.model).toBe("gpt-5.6-sol");
    expect(summary.effort).toBe("high");
  });

  it("keeps Daniil's messages, unwrapping the desktop app's context headers; Codex's own context is skipped", () => {
    expect(summary.firstMessage).toEqual({ text: "Fix the flaky test", at: "2026-11-12T10:00:05.007Z" });
    expect(summary.lastMessage).toEqual({ text: "Also update the docs", at: "2026-11-12T10:05:00.001Z" });
    expect(summary.lastAnswer).toEqual({ text: "Docs updated.", at: "2026-11-12T10:05:31.000Z" });
  });

  it("takes each turn's tokens as the difference of the cumulative token_count totals; a repeated count adds nothing", () => {
    // Totals reach input 130 000 (110 000 of it cached), output 2 000.
    expect(summary.tokens).toEqual({ input: 130_000 - 110_000, output: 2_000, cacheRead: 110_000, cacheWrite: 0 });
  });

  it("matches a hand calculation of context % and ~$", () => {
    // Context: the last request's input, 80 000 tokens, of the window the rollout records,
    // 353 400 → 22.6 %.
    expect(summary.context).toEqual({ used: 80_000, window: 353_400 });
    // Cost, $ per million tokens; OpenAI counts cached tokens inside input_tokens:
    //  turn 1, gpt-5.6-terra ($2 in, $0.20 cached, $12 out): totals 50 000 in (40 000 cached), 1 200 out
    //    10 000 × 2 + 40 000 × 0.20 + 1 200 × 12   = 42 400 → $0.0424
    //  turn 2, gpt-5.6-sol ($4 in, $0.40 cached, $20 out): +80 000 in (+70 000 cached), +800 out
    //    10 000 × 4 + 70 000 × 0.40 +   800 × 20   = 84 000 → $0.0840
    //  total                                                 $0.1264
    expect(summary.costUsd).toBeCloseTo(0.1264, 9);
  });

  it("bills a request over 272K prompt tokens at the long-context rates", () => {
    const big = {
      timestamp: "2026-11-12T10:00:00.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: { input_tokens: 300_000, cached_input_tokens: 0, output_tokens: 1_000, reasoning_output_tokens: 0, total_tokens: 301_000 },
          last_token_usage: { input_tokens: 300_000, cached_input_tokens: 0, output_tokens: 1_000, reasoning_output_tokens: 0, total_tokens: 301_000 },
          model_context_window: 353_400,
        },
      },
    };
    const turn = { timestamp: "2026-11-12T10:00:00.000Z", type: "turn_context", payload: { model: "gpt-5.6-terra", effort: "low" } };
    // Long-context terra: $4 in, $18 out → 300 000 × 4 + 1 000 × 18 = 1 218 000 → $1.218.
    expect(summaryOf("codex", `${JSON.stringify(turn)}\n${JSON.stringify(big)}\n`).costUsd).toBeCloseTo(1.218, 9);
  });

  it("is appended to by `codex resume`: the same session, still one session_meta's id", () => {
    const resumed = `${fixture("codex-session.jsonl").toString("utf8")}${JSON.stringify({
      timestamp: "2026-11-13T09:00:00.000Z",
      type: "session_meta",
      payload: { id: "019a7c3e-5b2d-7f10-8c4e-1d2f3a4b5c6d", cwd: "/elsewhere", source: "vscode" },
    })}\n${JSON.stringify({ timestamp: "2026-11-13T09:00:01.000Z", type: "event_msg", payload: { type: "user_message", message: "Back again" } })}\n`;
    const after = summaryOf("codex", resumed);
    expect(after).toMatchObject({ id: summary.id, cwd: "/work/beta", lastActiveAt: "2026-11-13T09:00:01.000Z" });
    expect(after.lastMessage?.text).toBe("Back again");
  });

  it("takes messages from the model input when the rollout records no user_message events", () => {
    const s = summaryOf("codex", fixture("codex-no-events.jsonl"));
    expect(s.firstMessage?.text).toBe("List the open tickets");
    expect(s.lastMessage?.text).toBe("Close the first one");
    expect(s.lastAnswer?.text).toBe("There are three.");
    expect(s).toMatchObject({ model: "gpt-5.5", effort: "low", context: null, costUsd: 0 });
  });

  it("drops what the model input gave once user_message events appear: they are the messages", () => {
    const lines = fixtureLines("codex-session.jsonl");
    // Up to the item that precedes the first user_message event, the item is taken.
    expect(parse("codex", lines.slice(0, 7).join("")).firstMessage?.text).toBe("Fix the flaky test");
    expect(parse("codex", lines.slice(0, 8).join("")).codexUserEvents).toBe(true);
  });

  it("marks a sub-agent's rollout as no session of its own, though it repeats its parent's session_meta", () => {
    const state = parse("codex", fixture("codex-subagent.jsonl"));
    expect(state.excluded).toBe(true);
    expect(state.id).toBe("019a7e00-aaaa-7bbb-8ccc-dddd00001111");
  });

  it("shows no cost for a model the price table lacks, but the context the rollout records", () => {
    const s = summaryOf("codex", fixture("codex-session.jsonl").toString("utf8").replaceAll("gpt-5.6-sol", "gpt-9"));
    expect(s.costUsd).toBeNull();
    expect(s.context).toEqual({ used: 80_000, window: 353_400 });
  });
});
