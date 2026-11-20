// One Codex rollout record into the session state. A rollout is JSONL of `{ timestamp, type, payload }`;
// the records that matter here:
//
// - `session_meta` (line 0): the session's `id`, `cwd`, `git.branch`, and `source` — an object
//   naming a `subagent` marks a sub-agent's rollout, which is not a session of its own. Later
//   `session_meta` lines are not this session's: a sub-agent's rollout repeats its parent's, and the
//   desktop app writes the same one again on a resume;
// - `turn_context`: the model and effort of the turn that follows;
// - `event_msg` `token_count`: cumulative `total_token_usage` (OpenAI's convention: `input_tokens`
//   includes the cached and cache-write tokens, `output_tokens` the reasoning tokens), the latest
//   request's `last_token_usage`, and `model_context_window`. A turn's tokens are the difference
//   between consecutive totals, billed at the model of the turn context in force;
// - `event_msg` `user_message`: the user's message (`prompts.ts`). Some rollouts carry no such
//   events (seen from codex-tui 0.147 to 0.153); their messages are the user `response_item`s
//   that are not Codex's own context. Once a rollout shows a `user_message` event, the events are
//   the only source, and what the items gave before is dropped;
// - `response_item` `message` of the assistant: its `output_text` is the agent's text answer.

import { tierFor } from "./prices.ts";
import { codexInputPrompt, codexPrompt } from "./prompts.ts";
import { noteMessage, noteTime, timedText, type CodexTotals, type SessionState } from "./session-state.ts";
import { addUsage } from "./usage.ts";

type Shape = Record<string, unknown>;

const isObject = (v: unknown): v is Shape => typeof v === "object" && v !== null && !Array.isArray(v);
const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

/** The model key for tokens counted before any turn context named a model: never in the price table. */
export const UNKNOWN_MODEL = "unknown";

function totalsOf(usage: Shape): CodexTotals {
  return {
    input: count(usage.input_tokens),
    cached: count(usage.cached_input_tokens),
    cacheWrite: count(usage.cache_write_input_tokens),
    output: count(usage.output_tokens),
  };
}

/** The text parts of a `response_item` message's content, joined. */
function itemText(content: unknown, partType: string): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) if (isObject(part) && part.type === partType && typeof part.text === "string") parts.push(part.text);
  return parts.join("\n");
}

function applyItem(state: SessionState, payload: Shape, at: unknown): void {
  if (payload.type !== "message") return;
  if (payload.role === "assistant") {
    const text = itemText(payload.content, "output_text");
    if (text.trim() !== "") state.lastAnswer = timedText(text, at);
  } else if (payload.role === "user" && !state.codexUserEvents) {
    const prompt = codexInputPrompt(itemText(payload.content, "input_text"));
    if (prompt !== null) noteMessage(state, prompt, at);
  }
}

function applyMeta(state: SessionState, payload: Shape): void {
  if (state.id !== null) return;
  state.id = typeof payload.id === "string" ? payload.id : null;
  if (typeof payload.cwd === "string" && payload.cwd !== "") state.cwd = payload.cwd;
  const git = payload.git;
  if (isObject(git) && typeof git.branch === "string" && git.branch !== "") state.branch = git.branch;
  state.excluded = isObject(payload.source) && "subagent" in payload.source;
}

function applyTokenCount(state: SessionState, info: Shape): void {
  const total = isObject(info.total_token_usage) ? totalsOf(info.total_token_usage) : null;
  const last = isObject(info.last_token_usage) ? totalsOf(info.last_token_usage) : null;
  if (total === null) return;
  const prev = state.codexTotals ?? { input: 0, cached: 0, cacheWrite: 0, output: 0 };
  const delta = {
    input: total.input - prev.input,
    cached: total.cached - prev.cached,
    cacheWrite: total.cacheWrite - prev.cacheWrite,
    output: total.output - prev.output,
  };
  state.codexTotals = total;
  const model = state.model ?? UNKNOWN_MODEL;
  // Totals only grow; a drop means the counters restarted, and the new totals are this turn's share.
  const share = Object.values(delta).some((d) => d < 0) ? total : delta;
  if (Object.values(share).some((d) => d > 0)) {
    addUsage(state.usage, model, tierFor(model, last?.input ?? share.input, false), {
      input: Math.max(0, share.input - share.cached - share.cacheWrite),
      output: share.output,
      cacheRead: share.cached,
      cacheWrite: share.cacheWrite,
      cacheWriteLong: 0,
    });
  }
  const window = count(info.model_context_window);
  if (last !== null) state.context = { used: last.input, model: state.model, window: window > 0 ? window : null };
}

export function applyCodexRecord(state: SessionState, record: unknown): void {
  if (!isObject(record)) return;
  noteTime(state, record.timestamp);
  const payload = record.payload;
  if (!isObject(payload)) return;
  switch (record.type) {
    case "session_meta":
      applyMeta(state, payload);
      return;
    case "turn_context":
      state.model = typeof payload.model === "string" ? payload.model : null;
      state.effort = typeof payload.effort === "string" ? payload.effort : null;
      if (state.cwd === null && typeof payload.cwd === "string" && payload.cwd !== "") state.cwd = payload.cwd;
      return;
    case "event_msg":
      if (payload.type === "token_count" && isObject(payload.info)) {
        applyTokenCount(state, payload.info);
      } else if (payload.type === "user_message") {
        if (!state.codexUserEvents) {
          state.codexUserEvents = true;
          state.firstMessage = null;
          state.lastMessage = null;
        }
        const prompt = codexPrompt(payload.message);
        if (prompt !== null) noteMessage(state, prompt, record.timestamp);
      }
      return;
    case "response_item":
      applyItem(state, payload, record.timestamp);
      return;
  }
}
