// What the parsers accumulate while reading one transcript, line by line, and the summary built
// from it. The state is plain JSON: the parse index stores it with the byte offset it reached, so
// a grown transcript is parsed from there on (`parser.ts`).

import type { SessionProvider, SessionSummary, TimedText } from "../../shared/sessions.ts";
import { resolveModel } from "./prices.ts";
import { costOf, totalsOf, type Usage } from "./usage.ts";

/** Longest message text a summary keeps; longer texts end in "…". */
export const MESSAGE_MAX_CHARS = 4000;

export interface SessionState {
  /** The session id the transcript names (Codex `session_meta`); `null` until read, or for Claude (the file name is the id). */
  id: string | null;
  /** True for a transcript that is not a session of its own (a Codex sub-agent's). */
  excluded: boolean;
  cwd: string | null;
  branch: string | null;
  startedAt: string | null;
  lastActiveAt: string | null;
  model: string | null;
  effort: string | null;
  usage: Usage;
  /** The latest turn's input-side tokens, its model, and the window the transcript recorded (Codex). */
  context: { used: number; model: string | null; window: number | null } | null;
  firstMessage: TimedText | null;
  lastMessage: TimedText | null;
  lastAnswer: TimedText | null;
  malformed: number;
  /** Claude: the last assistant message id, whose usage is already counted (one message spans several records). */
  lastMessageId: string | null;
  /** Codex: the last cumulative token counts seen, to take each turn's share as a difference. */
  codexTotals: CodexTotals | null;
  /** Codex: the rollout records `user_message` events, the messages' source from then on. */
  codexUserEvents: boolean;
}

export interface CodexTotals {
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
}

export function newSessionState(): SessionState {
  return {
    id: null,
    excluded: false,
    cwd: null,
    branch: null,
    startedAt: null,
    lastActiveAt: null,
    model: null,
    effort: null,
    usage: {},
    context: null,
    firstMessage: null,
    lastMessage: null,
    lastAnswer: null,
    malformed: 0,
    lastMessageId: null,
    codexTotals: null,
    codexUserEvents: false,
  };
}

const isStringOrNull = (v: unknown): boolean => v === null || typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isTimedTextOrNull = (v: unknown): boolean => v === null || (isPlainObject(v) && typeof v.text === "string" && isStringOrNull(v.at));

function isUsage(v: unknown): boolean {
  return (
    isPlainObject(v) &&
    Object.values(v).every(
      (byTier) => isPlainObject(byTier) && Object.values(byTier).every((t) => isPlainObject(t) && Object.values(t).every(isNumber)),
    )
  );
}

/** True for a state as this parser version writes it (one read back from the parse index). */
export function isSessionState(value: unknown): value is SessionState {
  if (!isPlainObject(value)) return false;
  const v = value;
  const ctx = v.context;
  const totals = v.codexTotals;
  return (
    isStringOrNull(v.id) &&
    typeof v.excluded === "boolean" &&
    isStringOrNull(v.cwd) &&
    isStringOrNull(v.branch) &&
    isStringOrNull(v.startedAt) &&
    isStringOrNull(v.lastActiveAt) &&
    isStringOrNull(v.model) &&
    isStringOrNull(v.effort) &&
    isUsage(v.usage) &&
    (ctx === null || (isPlainObject(ctx) && isNumber(ctx.used) && isStringOrNull(ctx.model) && (ctx.window === null || isNumber(ctx.window)))) &&
    isTimedTextOrNull(v.firstMessage) &&
    isTimedTextOrNull(v.lastMessage) &&
    isTimedTextOrNull(v.lastAnswer) &&
    isNumber(v.malformed) &&
    isStringOrNull(v.lastMessageId) &&
    (totals === null || (isPlainObject(totals) && Object.values(totals).every(isNumber))) &&
    typeof v.codexUserEvents === "boolean"
  );
}

/** Widen the session's time span to include a record's `timestamp`. */
export function noteTime(state: SessionState, timestamp: unknown): void {
  if (typeof timestamp !== "string") return;
  const t = Date.parse(timestamp);
  if (Number.isNaN(t)) return;
  if (state.startedAt === null || t < Date.parse(state.startedAt)) state.startedAt = timestamp;
  if (state.lastActiveAt === null || t > Date.parse(state.lastActiveAt)) state.lastActiveAt = timestamp;
}

export function timedText(text: string, at: unknown): TimedText {
  const trimmed = text.trim();
  const capped = trimmed.length > MESSAGE_MAX_CHARS ? `${trimmed.slice(0, MESSAGE_MAX_CHARS - 1)}…` : trimmed;
  return { text: capped, at: typeof at === "string" ? at : null };
}

/** Record one of the user's messages: the first one stays first, every one becomes the last. */
export function noteMessage(state: SessionState, text: string, at: unknown): void {
  const message = timedText(text, at);
  state.firstMessage ??= message;
  state.lastMessage = message;
}

export interface SummaryMeta {
  /** The id from the file name: Claude's whole name, Codex's trailing uuid. */
  fileId: string;
  provider: SessionProvider;
  agent: string;
  transcript: string;
}

export function summarize(state: SessionState, meta: SummaryMeta): SessionSummary {
  const ctx = state.context;
  const window = ctx === null ? null : (ctx.window ?? (ctx.model === null ? null : (resolveModel(ctx.model)?.contextWindow ?? null)));
  return {
    id: state.id ?? meta.fileId,
    provider: meta.provider,
    agent: meta.agent,
    transcript: meta.transcript,
    cwd: state.cwd,
    branch: state.branch,
    startedAt: state.startedAt,
    lastActiveAt: state.lastActiveAt,
    model: state.model,
    effort: state.effort,
    tokens: totalsOf(state.usage),
    context: ctx !== null && window !== null && window > 0 ? { used: ctx.used, window } : null,
    costUsd: costOf(state.usage),
    firstMessage: state.firstMessage,
    lastMessage: state.lastMessage,
    lastAnswer: state.lastAnswer,
    malformedLines: state.malformed,
  };
}
