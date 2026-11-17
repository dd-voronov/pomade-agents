// Session summaries as the UI and the backend both know them: what the backend learns from the
// providers' transcript stores (DESIGN §2.2–2.3), the method that answers them and the event that
// says they changed. docs/CONTRACTS.md describes both.
//
// The shapes are type aliases, so they are JSON values to the broker as they are.
//
// A summary holds only what the transcript says. The session record (name, status, project —
// DESIGN §4) is a separate shape, joined to it by `id`.

/** Answers `SessionsAnswer`: the summaries, whole or as the changes since a revision. */
export const SESSIONS_SUMMARIES_METHOD = "sessions.summaries";

/** Published by the backend, unqualified, whenever summaries change; payload `SessionsChanged`. */
export const SESSIONS_CHANGED_EVENT = "sessions.changed";

export type SessionProvider = "claude-code" | "codex";

/** A text from the transcript and when it was written (ISO 8601; `null` when the record has no time). */
export type TimedText = {
  text: string;
  at: string | null;
};

/** Tokens summed over every turn. `input` is the uncached input only. */
export type TokenTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export type SessionSummary = {
  /** The provider's session id. */
  id: string;
  provider: SessionProvider;
  /** Roster id: `claude`, `codex`, or the folder agent's name. */
  agent: string;
  /** The transcript file, absolute: unique per summary. */
  transcript: string;
  /** The start folder: the first recorded working folder. */
  cwd: string | null;
  /** The git branch recorded at the start; `null` when the provider records none. */
  branch: string | null;
  /** First and last record times, ISO 8601. */
  startedAt: string | null;
  lastActiveAt: string | null;
  /** The model and reasoning effort of the latest turn. */
  model: string | null;
  effort: string | null;
  tokens: TokenTotals;
  /** The latest turn's input-side tokens and the model's context window; `null` when either is unknown. */
  context: { used: number; window: number } | null;
  /** Estimated cost in USD; `null` when any turn ran on a model the price table lacks. */
  costUsd: number | null;
  /** Daniil's first and last real messages, injected content skipped. */
  firstMessage: TimedText | null;
  lastMessage: TimedText | null;
  /** The agent's last text answer. */
  lastAnswer: TimedText | null;
  /** Lines that were not JSON, skipped. */
  malformedLines: number;
};

/** Where a caller's copy stands: the `epoch` and `revision` of the last answer it applied. */
export type SessionsSince = {
  epoch: string;
  revision: number;
};

export type SessionsSummariesParams = {
  /** Omitted, or from another epoch: the answer is every summary (`full`). */
  since?: SessionsSince;
};

export type SessionsAnswer = {
  /** Names one backend run; revisions count within it. */
  epoch: string;
  revision: number;
  /** True: `summaries` is every session — replace the copy. False: only the changes since `since`. */
  full: boolean;
  summaries: SessionSummary[];
  /** Transcripts whose session is gone since `since` (always empty when `full`). */
  removed: string[];
  /** True while the first walk of the stores is still running. */
  indexing: boolean;
};

/** `sessions.changed` payload: a caller behind this revision asks `sessions.summaries` again. */
export type SessionsChanged = {
  epoch: string;
  revision: number;
};

/** Context fill in percent, one decimal. */
export function contextPercent(context: { used: number; window: number }): number {
  return Math.round((context.used / context.window) * 1000) / 10;
}

// ── Checks for answers that crossed the broker ─────────────────────────────

type Shape = Record<string, unknown>;

const isObject = (v: unknown): v is Shape => typeof v === "object" && v !== null && !Array.isArray(v);
const isStringOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

function isTimedTextOrNull(v: unknown): boolean {
  return v === null || (isObject(v) && typeof v.text === "string" && isStringOrNull(v.at));
}

function isTokenTotals(v: unknown): boolean {
  return isObject(v) && isCount(v.input) && isCount(v.output) && isCount(v.cacheRead) && isCount(v.cacheWrite);
}

export function isSessionSummary(value: unknown): value is SessionSummary {
  if (!isObject(value)) return false;
  const v = value;
  return (
    typeof v.id === "string" &&
    (v.provider === "claude-code" || v.provider === "codex") &&
    typeof v.agent === "string" &&
    typeof v.transcript === "string" &&
    isStringOrNull(v.cwd) &&
    isStringOrNull(v.branch) &&
    isStringOrNull(v.startedAt) &&
    isStringOrNull(v.lastActiveAt) &&
    isStringOrNull(v.model) &&
    isStringOrNull(v.effort) &&
    isTokenTotals(v.tokens) &&
    (v.context === null || (isObject(v.context) && isCount(v.context.used) && isCount(v.context.window) && v.context.window > 0)) &&
    (v.costUsd === null || isCount(v.costUsd)) &&
    isTimedTextOrNull(v.firstMessage) &&
    isTimedTextOrNull(v.lastMessage) &&
    isTimedTextOrNull(v.lastAnswer) &&
    isCount(v.malformedLines)
  );
}

/** True for a well-formed `sessions.summaries` answer. */
export function isSessionsAnswer(value: unknown): value is SessionsAnswer {
  if (!isObject(value)) return false;
  const v = value;
  return (
    typeof v.epoch === "string" &&
    isCount(v.revision) &&
    typeof v.full === "boolean" &&
    typeof v.indexing === "boolean" &&
    Array.isArray(v.summaries) &&
    v.summaries.every(isSessionSummary) &&
    Array.isArray(v.removed) &&
    v.removed.every((r) => typeof r === "string")
  );
}

/** True for a well-formed `sessions.changed` payload. */
export function isSessionsChanged(value: unknown): value is SessionsChanged {
  return isObject(value) && typeof value.epoch === "string" && isCount(value.revision);
}
