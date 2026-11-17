// Token usage of a session, kept per model and price tier so the cost follows the price table: a
// session that switched models mid-way, or crossed a long-prompt threshold on some turns, is billed
// turn by turn at the rates each turn ran at.

import type { TokenTotals } from "../../shared/sessions.ts";
import { ratesFor, resolveModel, type PriceTier } from "./prices.ts";

/** One turn's (or a sum of turns') tokens, split the way prices are. `input` is uncached input. */
export interface Tokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWriteLong: number;
}

/** model id → tier → tokens. */
export type Usage = Record<string, Partial<Record<PriceTier, Tokens>>>;

const KINDS = ["input", "output", "cacheRead", "cacheWrite", "cacheWriteLong"] as const;

export function zeroTokens(): Tokens {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWriteLong: 0 };
}

export function addUsage(usage: Usage, model: string, tier: PriceTier, tokens: Tokens): void {
  const byTier = (usage[model] ??= {});
  const sum = (byTier[tier] ??= zeroTokens());
  for (const kind of KINDS) sum[kind] += tokens[kind];
}

export function totalsOf(usage: Usage): TokenTotals {
  const t: TokenTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const byTier of Object.values(usage)) {
    for (const tokens of Object.values(byTier)) {
      t.input += tokens.input;
      t.output += tokens.output;
      t.cacheRead += tokens.cacheRead;
      t.cacheWrite += tokens.cacheWrite + tokens.cacheWriteLong;
    }
  }
  return t;
}

/** Estimated dollars; `null` when any tokens ran on a model, tier or kind the price table has no rate for. */
export function costOf(usage: Usage): number | null {
  let dollars = 0;
  for (const [model, byTier] of Object.entries(usage)) {
    const resolved = resolveModel(model);
    for (const [tier, tokens] of Object.entries(byTier) as [PriceTier, Tokens][]) {
      if (KINDS.every((kind) => tokens[kind] === 0)) continue;
      if (!resolved) return null;
      const rates = ratesFor(resolved.price, tier);
      if (!rates) return null;
      for (const kind of KINDS) {
        if (tokens[kind] === 0) continue;
        const rate = rates[kind];
        if (rate === null) return null;
        dollars += (tokens[kind] * rate) / 1_000_000;
      }
    }
  }
  return dollars;
}
