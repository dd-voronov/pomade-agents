import { describe, expect, it } from "vitest";

import { PRICE_TABLE, ratesFor, resolveModel, tierFor } from "./prices.ts";
import { costOf, type Usage } from "./usage.ts";

const tokens = (t: Partial<Record<"input" | "output" | "cacheRead" | "cacheWrite" | "cacheWriteLong", number>>) => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cacheWriteLong: 0,
  ...t,
});

describe("resolveModel", () => {
  it("finds an exact id", () => {
    expect(resolveModel("claude-opus-5-5")).toEqual({ price: PRICE_TABLE["claude-opus-5-5"], contextWindow: 1_000_000 });
  });

  it("finds a dated snapshot only when the entry lists it", () => {
    expect(resolveModel("claude-haiku-4-5-20251001")).toEqual({ price: PRICE_TABLE["claude-haiku-4-5"], contextWindow: 200_000 });
    expect(resolveModel("claude-haiku-4-5-20991231")).toBeNull();
    expect(resolveModel("claude-opus-5-5-20260401")).toBeNull();
  });

  it("finds a context variant only when the entry lists it, with that variant's window", () => {
    expect(resolveModel("claude-opus-4-8[1m]")?.contextWindow).toBe(1_000_000);
    expect(resolveModel("claude-opus-5-5[1m]")).toBeNull();
    expect(resolveModel("claude-opus-4-8[2m]")).toBeNull();
  });

  it("matches no prefix, suffix or near miss", () => {
    for (const id of ["claude-opus", "claude-opus-5-5-fast", "gpt-5.6", "codex-auto-review", "<synthetic>", ""]) {
      expect(resolveModel(id)).toBeNull();
    }
  });

  it("leaves Codex models' windows to their rollouts", () => {
    expect(resolveModel("gpt-5.6-terra")?.contextWindow).toBeNull();
  });
});

describe("tiers and rates", () => {
  it("puts a request over a model's long-prompt threshold in the long tier, and only such a model's", () => {
    expect(tierFor("claude-haiku-5-5", 100_000, false)).toBe("standard");
    expect(tierFor("claude-haiku-5-5", 100_001, false)).toBe("long");
    expect(tierFor("claude-opus-5-5", 900_000, false)).toBe("standard");
    expect(tierFor("claude-opus-5-5", 10, true)).toBe("fast");
    expect(tierFor("no-such-model", 10, false)).toBe("standard");
  });

  it("scales every rate in fast mode, and has none for a model without it", () => {
    const opus = PRICE_TABLE["claude-opus-5-5"];
    const sonnet = PRICE_TABLE["claude-sonnet-5-5"];
    if (!opus || !sonnet) throw new Error("table");
    expect(ratesFor(opus, "fast")).toEqual({ input: 8, output: 40, cacheRead: 0.4, cacheWrite: 10, cacheWriteLong: 16 });
    expect(ratesFor(sonnet, "fast")).toBeNull();
    expect(ratesFor(sonnet, "long")).toBeNull();
  });
});

describe("costOf", () => {
  it("prices each kind of token at its own rate", () => {
    // Haiku 5.5 long prompt: $0.50 in, $2.50 out, $0.05 cache read, $0.625 5-min write, $1 1-hour write.
    const usage: Usage = { "claude-haiku-5-5": { long: tokens({ input: 1e6, output: 1e6, cacheRead: 1e6, cacheWrite: 1e6, cacheWriteLong: 1e6 }) } };
    expect(costOf(usage)).toBeCloseTo(0.5 + 2.5 + 0.05 + 0.625 + 1, 9);
  });

  it("is unknown when any tokens ran on an unknown model, a missing tier, or an unpriced kind", () => {
    expect(costOf({ "claude-opus-5-5": { standard: tokens({ input: 1 }) }, "mystery-1": { standard: tokens({ output: 1 }) } })).toBeNull();
    expect(costOf({ "claude-sonnet-5-5": { fast: tokens({ input: 1 }) } })).toBeNull();
    expect(costOf({ "gpt-5.5": { standard: tokens({ cacheWrite: 1 }) } })).toBeNull();
  });

  it("ignores models with no tokens", () => {
    expect(costOf({ "mystery-1": { standard: tokens({}) } })).toBe(0);
  });
});
