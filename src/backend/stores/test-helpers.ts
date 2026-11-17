// Fixture transcripts for the unit tests: small synthetic sessions with the real stores' record
// structure and invented text (`harness/fixtures/transcripts/`, which the sandbox's stores use too).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { TRANSCRIPTS } from "../../../harness/sandbox.ts";
import type { SessionProvider, SessionSummary } from "../../shared/sessions.ts";
import { applyChunk } from "./parser.ts";
import { newSessionState, summarize, type SessionState } from "./session-state.ts";

export function fixture(name: string): Buffer {
  return readFileSync(join(TRANSCRIPTS, name));
}

/** The fixture's lines, each with its newline. */
export function fixtureLines(name: string): string[] {
  return fixture(name).toString("utf8").split(/(?<=\n)/);
}

export function parse(provider: SessionProvider, content: Buffer | string): SessionState {
  const state = newSessionState();
  applyChunk(provider, state, Buffer.from(content));
  return state;
}

export function summaryOf(provider: SessionProvider, content: Buffer | string, fileId = "file-id"): SessionSummary {
  return summarize(parse(provider, content), {
    fileId,
    provider,
    agent: provider === "codex" ? "codex" : "claude",
    transcript: `/store/${fileId}.jsonl`,
  });
}
