// One Claude Code transcript record into the session state. A transcript is JSONL; the records that
// matter here:
//
// - every record with a `timestamp` widens the session's time span; the first `cwd` and the first
//   non-empty `gitBranch` are the start folder and branch;
// - `assistant`: `message.model`, the record's `effort`, `message.usage` and the text blocks. One
//   API message is written as several consecutive records (one per content block) that repeat the
//   same `message.id` and usage, so usage counts once per id. `<synthetic>` records (API errors
//   Claude Code writes itself) are no turn;
// - `user`: Daniil's messages (`prompts.ts`).
//
// Every other record type (snapshots, titles, modes, queue operations, cost state, …) only counts
// for time.

import { tierFor } from "./prices.ts";
import { claudePrompt } from "./prompts.ts";
import { noteMessage, noteTime, timedText, type SessionState } from "./session-state.ts";
import { addUsage, type Tokens } from "./usage.ts";

type Shape = Record<string, unknown>;

const isObject = (v: unknown): v is Shape => typeof v === "object" && v !== null && !Array.isArray(v);
const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

const SYNTHETIC_MODEL = "<synthetic>";

function usageTokens(usage: Shape): Tokens {
  const write = count(usage.cache_creation_input_tokens);
  const split = usage.cache_creation;
  const writeLong = isObject(split) ? count(split.ephemeral_1h_input_tokens) : 0;
  return {
    input: count(usage.input_tokens),
    output: count(usage.output_tokens),
    cacheRead: count(usage.cache_read_input_tokens),
    cacheWrite: Math.max(0, write - writeLong),
    cacheWriteLong: writeLong,
  };
}

function applyAssistant(state: SessionState, record: Shape, message: Shape): void {
  const model = typeof message.model === "string" ? message.model : null;
  if (model === null || model === SYNTHETIC_MODEL || record.isApiErrorMessage === true) return;
  state.model = model;
  state.effort = typeof record.effort === "string" ? record.effort : null;

  const id = typeof message.id === "string" ? message.id : null;
  const usage = message.usage;
  if (isObject(usage) && (id === null || id !== state.lastMessageId)) {
    const tokens = usageTokens(usage);
    const prompt = tokens.input + tokens.cacheRead + tokens.cacheWrite + tokens.cacheWriteLong;
    addUsage(state.usage, model, tierFor(model, prompt, usage.speed === "fast"), tokens);
    state.context = { used: prompt, model, window: null };
  }
  state.lastMessageId = id;

  if (!Array.isArray(message.content)) return;
  for (const block of message.content) {
    if (isObject(block) && block.type === "text" && typeof block.text === "string" && block.text.trim() !== "") {
      state.lastAnswer = timedText(block.text, record.timestamp);
    }
  }
}

export function applyClaudeRecord(state: SessionState, record: unknown): void {
  if (!isObject(record)) return;
  noteTime(state, record.timestamp);
  if (state.cwd === null && typeof record.cwd === "string" && record.cwd !== "") state.cwd = record.cwd;
  if (state.branch === null && typeof record.gitBranch === "string" && record.gitBranch !== "") state.branch = record.gitBranch;
  if (record.isSidechain === true) return;

  const message = record.message;
  if (record.type === "assistant" && isObject(message)) {
    applyAssistant(state, record, message);
  } else if (record.type === "user") {
    const prompt = claudePrompt(record);
    if (prompt !== null) noteMessage(state, prompt, record.timestamp);
  }
}
