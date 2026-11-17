// Incremental JSONL parsing: a chunk of a transcript, read from the offset the last parse reached,
// becomes complete lines applied to the session state. A last line without its newline is still
// being written: it is left for the next read, so offsets always sit on a line boundary.

import type { SessionProvider } from "../../shared/sessions.ts";
import { applyClaudeRecord } from "./claude.ts";
import { applyCodexRecord } from "./codex.ts";
import type { SessionState } from "./session-state.ts";

const NEWLINE = 0x0a;

const APPLY: Record<SessionProvider, (state: SessionState, record: unknown) => void> = {
  "claude-code": applyClaudeRecord,
  codex: applyCodexRecord,
};

/**
 * Apply every complete line of `chunk` to `state`; returns how many bytes of `chunk` were consumed
 * (up to and including its last newline). A line that is not JSON is counted in `state.malformed`
 * and skipped.
 */
export function applyChunk(provider: SessionProvider, state: SessionState, chunk: Buffer): number {
  const apply = APPLY[provider];
  let start = 0;
  for (let nl = chunk.indexOf(NEWLINE, start); nl !== -1; nl = chunk.indexOf(NEWLINE, start)) {
    const line = chunk.toString("utf8", start, nl).trim();
    start = nl + 1;
    if (line === "") continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      state.malformed += 1;
      continue;
    }
    apply(state, record);
  }
  return start;
}
