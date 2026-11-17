import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RUN_RECORD_FILE, readRunRecord, removeRunRecord, writeRunRecord, type RunRecord } from "./run-record.ts";

const RECORD: RunRecord = { pid: 4242, version: "0.1.0", startedAt: "2026-11-17T10:00:00.000Z" };

describe("the run record", () => {
  let root: string;
  let stateDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "pa-run-"));
    stateDir = join(root, "app-state", "pomade-agents");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("is written into a state folder that does not exist yet, and read back", async () => {
    await writeRunRecord(stateDir, RECORD);
    expect(await readRunRecord(stateDir)).toEqual(RECORD);
    expect(await readdir(stateDir)).toEqual([RUN_RECORD_FILE]);
  });

  it("is removed by the process that wrote it, and only by that one", async () => {
    await writeRunRecord(stateDir, RECORD);
    await removeRunRecord(stateDir, RECORD.pid + 1);
    expect(await readRunRecord(stateDir)).toEqual(RECORD);
    await removeRunRecord(stateDir, RECORD.pid);
    expect(await readRunRecord(stateDir)).toBeNull();
    await removeRunRecord(stateDir, RECORD.pid);
  });

  it("reads a missing or malformed file as no record", async () => {
    expect(await readRunRecord(stateDir)).toBeNull();
    await writeRunRecord(stateDir, RECORD);
    await writeFile(join(stateDir, RUN_RECORD_FILE), "{", "utf8");
    expect(await readRunRecord(stateDir)).toBeNull();
    await writeFile(join(stateDir, RUN_RECORD_FILE), JSON.stringify({ pid: "1" }), "utf8");
    expect(await readRunRecord(stateDir)).toBeNull();
  });
});
