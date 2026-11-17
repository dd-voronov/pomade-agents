import { appendFile, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { fixture, parse } from "./test-helpers.ts";
import { readTranscript, type ReadResult } from "./transcript-file.ts";

function parsed(result: ReadResult): Extract<ReadResult, { kind: "parsed" }> {
  if (result.kind !== "parsed") throw new Error(`expected parsed, got ${result.kind}`);
  return result;
}

describe("readTranscript", () => {
  let dir: string;
  let path: string;
  const content = fixture("claude-session.jsonl");
  const half = content.indexOf("\n", content.length / 2) + 1;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pa-read-"));
    path = join(dir, "s.jsonl");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("parses a new file, then only what was appended", async () => {
    await writeFile(path, content.subarray(0, half));
    const first = parsed(await readTranscript("claude-code", path, null));
    expect(first.mark.offset).toBe(half);
    expect(await readTranscript("claude-code", path, first)).toEqual({ kind: "unchanged" });

    await appendFile(path, content.subarray(half));
    const second = parsed(await readTranscript("claude-code", path, first));
    expect(second.mark.offset).toBe(content.length);
    expect(second.state).toEqual(parse("claude-code", content));
    expect(first.state).toEqual(parse("claude-code", content.subarray(0, half)));
  });

  it("parses from the start a file that shrank, or was replaced by another", async () => {
    await writeFile(path, content);
    const full = parsed(await readTranscript("claude-code", path, null));

    await writeFile(path, content.subarray(0, half));
    const truncated = parsed(await readTranscript("claude-code", path, full));
    expect(truncated.state).toEqual(parse("claude-code", content.subarray(0, half)));

    const other = fixture("claude-no-origin.jsonl");
    await unlink(path);
    await writeFile(path, Buffer.concat([other, other, other, other, other]));
    const replaced = parsed(await readTranscript("claude-code", path, truncated));
    expect(replaced.state.firstMessage?.text).toBe("Why does the build fail?");
  });

  it("parses from the start a file rewritten in place to a longer one", async () => {
    await writeFile(path, content.subarray(0, half));
    const first = parsed(await readTranscript("claude-code", path, null));
    // Same inode, more bytes, but no line ends where the last parse stopped.
    await writeFile(path, Buffer.concat([Buffer.from("x"), content]));
    const again = parsed(await readTranscript("claude-code", path, first));
    expect(again.state.malformed).toBe(1);
    expect(again.mark.offset).toBe(content.length + 1);
  });

  it("reads a line longer than its read buffer", async () => {
    const long = { type: "user", message: { role: "user", content: `big ${"y".repeat(3 << 20)}` }, origin: { kind: "human" } };
    await writeFile(path, `${JSON.stringify(long)}\n${JSON.stringify({ ...long, message: { role: "user", content: "small" } })}\n`);
    const result = parsed(await readTranscript("claude-code", path, null));
    expect(result.state.firstMessage?.text.startsWith("big y")).toBe(true);
    expect(result.state.lastMessage?.text).toBe("small");
  });

  it("reports a file that is gone, or a folder where a file was", async () => {
    expect(await readTranscript("claude-code", path, null)).toEqual({ kind: "gone" });
    expect(await readTranscript("claude-code", dir, null)).toEqual({ kind: "gone" });
  });
});
