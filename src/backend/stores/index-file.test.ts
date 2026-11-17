import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { INDEX_FILE, PARSER_VERSION, PRICES_FINGERPRINT, readIndex, writeIndex, type IndexedFile } from "./index-file.ts";
import { fixture, parse } from "./test-helpers.ts";

describe("the parse index", () => {
  let root: string;
  let stateDir: string;
  const entry: IndexedFile = { mark: { ino: 42, offset: 100 }, state: parse("claude-code", fixture("claude-session.jsonl")) };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "pa-index-"));
    stateDir = join(root, "app-state", "pomade-agents");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("is written into a state folder that does not exist yet, and read back", async () => {
    await writeIndex(stateDir, new Map([["/s/a.jsonl", entry]]));
    expect(await readIndex(stateDir)).toEqual(new Map([["/s/a.jsonl", entry]]));
    expect(await readdir(stateDir)).toEqual([INDEX_FILE]);
  });

  it("reads as empty when missing, corrupt, or written by another parser or price table", async () => {
    expect(await readIndex(stateDir)).toEqual(new Map());
    await writeIndex(stateDir, new Map([["/s/a.jsonl", entry]]));
    const path = join(stateDir, INDEX_FILE);
    const doc = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;

    await writeFile(path, "{\"parser\":", "utf8");
    expect(await readIndex(stateDir)).toEqual(new Map());
    await writeFile(path, JSON.stringify({ ...doc, parser: PARSER_VERSION + 1 }), "utf8");
    expect(await readIndex(stateDir)).toEqual(new Map());
    await writeFile(path, JSON.stringify({ ...doc, prices: `x${PRICES_FINGERPRINT}` }), "utf8");
    expect(await readIndex(stateDir)).toEqual(new Map());
    await writeFile(path, "null", "utf8");
    expect(await readIndex(stateDir)).toEqual(new Map());
  });

  it("drops entries that are not what this parser writes, and keeps the rest", async () => {
    await writeIndex(stateDir, new Map([["/s/a.jsonl", entry]]));
    const path = join(stateDir, INDEX_FILE);
    const doc = JSON.parse(await readFile(path, "utf8")) as { files: Record<string, unknown> };
    doc.files["/s/b.jsonl"] = { mark: { ino: 1, offset: -1 }, state: entry.state };
    doc.files["/s/c.jsonl"] = { mark: { ino: 1, offset: 0 }, state: { ...entry.state, usage: { m: { standard: { input: "1" } } } } };
    doc.files["/s/d.jsonl"] = { mark: { ino: 1, offset: 0 } };
    await writeFile(path, JSON.stringify(doc), "utf8");
    expect([...(await readIndex(stateDir)).keys()]).toEqual(["/s/a.jsonl"]);
  });
});
