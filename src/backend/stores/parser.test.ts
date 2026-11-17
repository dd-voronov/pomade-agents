import { describe, expect, it } from "vitest";

import { applyChunk } from "./parser.ts";
import { newSessionState } from "./session-state.ts";
import { fixture, parse } from "./test-helpers.ts";

describe("applyChunk", () => {
  it("leaves a half-written last line for the next read", () => {
    const content = fixture("claude-session.jsonl");
    const cut = content.indexOf("Now write it");
    const state = newSessionState();
    const consumed = applyChunk("claude-code", state, content.subarray(0, cut));
    expect(content[consumed - 1]).toBe(0x0a);
    expect(state.malformed).toBe(0);
    expect(state.lastMessage?.text).toBe("Plan the sessions table");

    applyChunk("claude-code", state, content.subarray(consumed));
    expect(state).toEqual(parse("claude-code", content));
  });

  it("gives the same state read in any number of pieces", () => {
    const content = fixture("codex-session.jsonl");
    const whole = parse("codex", content);
    for (const size of [1, 7, 100, 1000]) {
      const state = newSessionState();
      let offset = 0;
      let end = 0;
      while (end < content.length) {
        end = Math.min(content.length, end + size);
        offset += applyChunk("codex", state, content.subarray(offset, end));
      }
      expect(offset).toBe(content.length);
      expect(state).toEqual(whole);
    }
  });

  it("counts and skips malformed lines, and keeps the session", () => {
    const content = Buffer.concat([Buffer.from('{"type":"user",\nnot json\n\n   \n'), fixture("claude-session.jsonl")]);
    const state = parse("claude-code", content);
    expect(state.malformed).toBe(2);
    expect(state.firstMessage?.text).toBe("Plan the sessions table");
  });

  it("ignores JSON that is not a record", () => {
    expect(parse("claude-code", '[1,2]\n"text"\nnull\n42\n')).toEqual(newSessionState());
    expect(parse("codex", '[1,2]\n{"type":"event_msg"}\n{"type":"event_msg","payload":[]}\n')).toEqual(newSessionState());
  });

  it("reads UTF-8 split across pieces", () => {
    const record = { type: "user", message: { role: "user", content: "Привет, мир 🌍" }, origin: { kind: "human" } };
    const content = Buffer.from(`${JSON.stringify(record)}\n`);
    const state = newSessionState();
    const split = content.indexOf("🌍") + 2;
    const consumed = applyChunk("claude-code", state, content.subarray(0, split));
    expect(consumed).toBe(0);
    applyChunk("claude-code", state, content.subarray(consumed));
    expect(state.firstMessage?.text).toBe("Привет, мир 🌍");
  });
});
