// The price table: per model id, dollars per million tokens and the context window. Hand-maintained;
// it covers the models that occur in the stores. A model it lacks has no cost and no context
// (DESIGN §2.3) — never a guess.
//
// Model ids resolve deliberately: an exact id, an alias the entry lists (a dated snapshot), or a
// context variant the entry lists (`claude-opus-4-8[1m]`). Nothing else matches — no prefix or
// fuzzy matching, so a new model shows "—" until it is added here.
//
// Sources: Anthropic — platform.claude.com/docs/en/about-claude/pricing (model pricing, fast mode,
// long context), checked 2026-11-17, and Claude Code's own per-model `costUSD` in the transcripts'
// `cost-state` records agree with these rates to the cent. OpenAI — developers.openai.com/api/docs/pricing,
// checked 2026-11-17 (standard tier).

/** Dollars per million tokens. `null`: the provider publishes no price for that kind of token. */
export interface Rates {
  input: number;
  output: number;
  cacheRead: number;
  /** A write to the short-lived cache: Claude's 5-minute TTL, OpenAI's 30-minute one. */
  cacheWrite: number | null;
  /** A write to the long-lived cache: Claude's 1-hour TTL, OpenAI's 12-hour one. */
  cacheWriteLong: number | null;
}

export interface ModelPrice {
  rates: Rates;
  /** The context window in tokens. Absent for Codex models: their transcripts record it. */
  contextWindow?: number;
  /** A request whose prompt (all input, cached or not) exceeds `above` tokens is billed at `rates`. */
  longPrompt?: { above: number; rates: Rates };
  /** Fast mode multiplies every rate by this. Absent: the model has no fast mode. */
  fastMultiplier?: number;
  /** Other ids of the same model, matched exactly (dated snapshots). */
  aliases?: readonly string[];
  /** `<id>[<suffix>]` ids and the context window each one runs with. */
  contextVariants?: Readonly<Record<string, number>>;
}

const M = 1_000_000;

/** Claude rates: cache writes cost 1.25× (5 min) and 2× (1 h) the input rate. */
function claude(input: number, output: number, cacheRead: number): Rates {
  return { input, output, cacheRead, cacheWrite: input * 1.25, cacheWriteLong: input * 2 };
}

const ONE_M = { "1m": M } as const;

export const PRICE_TABLE: Readonly<Record<string, ModelPrice>> = {
  // ── Anthropic ──────────────────────────────────────────────────────────────
  "claude-fable-5-2": { rates: claude(8, 40, 0.2), contextWindow: M, fastMultiplier: 2 },
  "claude-fable-5-1": { rates: claude(10, 50, 0.25), contextWindow: M },
  "claude-fable-5": { rates: claude(10, 50, 1), contextWindow: M },
  "claude-opus-5-5": { rates: claude(4, 20, 0.2), contextWindow: M, fastMultiplier: 2 },
  "claude-opus-5": { rates: claude(5, 25, 0.5), contextWindow: M, fastMultiplier: 2, contextVariants: ONE_M },
  "claude-opus-4-8": { rates: claude(5, 25, 0.5), contextWindow: M, fastMultiplier: 2, contextVariants: ONE_M },
  "claude-opus-4-7": { rates: claude(5, 25, 0.5), contextWindow: M, contextVariants: ONE_M },
  "claude-sonnet-5-5": { rates: claude(2, 10, 0.1), contextWindow: M },
  "claude-sonnet-5": { rates: claude(2, 10, 0.2), contextWindow: M },
  "claude-sonnet-4-6": { rates: claude(3, 15, 0.3), contextWindow: M, contextVariants: ONE_M },
  "claude-haiku-5-5": {
    rates: claude(0.1, 0.5, 0.01),
    contextWindow: M,
    longPrompt: { above: 100_000, rates: claude(0.5, 2.5, 0.05) },
  },
  "claude-haiku-4-5": { rates: claude(1, 5, 0.1), contextWindow: 200_000, aliases: ["claude-haiku-4-5-20251001"] },

  // ── OpenAI (Codex) ─────────────────────────────────────────────────────────
  "gpt-5.6-terra": {
    rates: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.5, cacheWriteLong: 5 },
    longPrompt: { above: 272_000, rates: { input: 4, output: 18, cacheRead: 0.4, cacheWrite: 5, cacheWriteLong: 10 } },
  },
  "gpt-5.6-sol": {
    rates: { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5, cacheWriteLong: 10 },
    longPrompt: { above: 272_000, rates: { input: 8, output: 30, cacheRead: 0.8, cacheWrite: 10, cacheWriteLong: 20 } },
  },
  "gpt-5.6-luna": {
    rates: { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25, cacheWriteLong: 0.5 },
    longPrompt: { above: 272_000, rates: { input: 0.4, output: 1.8, cacheRead: 0.04, cacheWrite: 0.5, cacheWriteLong: 1 } },
  },
  "gpt-5.5": {
    rates: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: null, cacheWriteLong: null },
    longPrompt: { above: 272_000, rates: { input: 10, output: 45, cacheRead: 1, cacheWrite: null, cacheWriteLong: null } },
  },
};

export interface ResolvedModel {
  price: ModelPrice;
  /** The window this id runs with; `null` when the table leaves it to the transcript (Codex). */
  contextWindow: number | null;
}

function buildAliases(table: Readonly<Record<string, ModelPrice>>): Map<string, ModelPrice> {
  const byId = new Map<string, ModelPrice>(Object.entries(table));
  for (const [id, price] of Object.entries(table)) {
    for (const alias of price.aliases ?? []) {
      if (byId.has(alias)) throw new Error(`price table: alias ${alias} of ${id} is already an id`);
      byId.set(alias, price);
    }
  }
  return byId;
}

const BY_ID = buildAliases(PRICE_TABLE);
const VARIANT_RE = /^(.+)\[([a-z0-9]+)\]$/;

/** The table's entry for a model id as a transcript records it, or `null` when it has none. */
export function resolveModel(id: string): ResolvedModel | null {
  const exact = BY_ID.get(id);
  if (exact) return { price: exact, contextWindow: exact.contextWindow ?? null };
  const variant = VARIANT_RE.exec(id);
  if (!variant) return null;
  const [, base = "", suffix = ""] = variant;
  const price = BY_ID.get(base);
  const window = price?.contextVariants?.[suffix];
  return price && window !== undefined ? { price, contextWindow: window } : null;
}

/** How a turn is billed: standard rates, the long-prompt rates, or fast mode. */
export type PriceTier = "standard" | "long" | "fast";

/** The tier of one request: fast mode when it ran fast, long when its prompt crossed the model's threshold. */
export function tierFor(model: string, promptTokens: number, fast: boolean): PriceTier {
  if (fast) return "fast";
  const above = resolveModel(model)?.price.longPrompt?.above;
  return above !== undefined && promptTokens > above ? "long" : "standard";
}

/** The rates of a tier, or `null` when the model has none for it (fast mode on a model without it). */
export function ratesFor(price: ModelPrice, tier: PriceTier): Rates | null {
  switch (tier) {
    case "standard":
      return price.rates;
    case "long":
      return price.longPrompt?.rates ?? null;
    case "fast": {
      const k = price.fastMultiplier;
      if (k === undefined) return null;
      const scale = (v: number | null): number | null => (v === null ? null : v * k);
      const r = price.rates;
      return { input: r.input * k, output: r.output * k, cacheRead: r.cacheRead * k, cacheWrite: scale(r.cacheWrite), cacheWriteLong: scale(r.cacheWriteLong) };
    }
  }
}
