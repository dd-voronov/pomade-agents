import { mkdir, mkdtemp, readFile, readdir, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SessionRecord } from "../../shared/sessions.ts";
import { RecordError, SESSIONS_FOLDER, SETTINGS_FILE, openRecordStore, type RecordStore } from "./record-store.ts";

const SOON = { timeout: 2000, interval: 20 };
const NOW = new Date("2026-11-17T12:00:00.000Z");
const record = (id: string, patch: Partial<SessionRecord> = {}): SessionRecord => ({ id, provider: "codex", agent: "codex", status: "active", ...patch });

describe("the record store", () => {
  let dir: string;
  let dataDir: string;
  let store: RecordStore | null = null;
  const lines: string[] = [];
  const changes: (string | null)[] = [];

  const fileOf = (id: string): string => join(dataDir, SESSIONS_FOLDER, `${id}.yaml`);
  const open = async (): Promise<RecordStore> => {
    store = await openRecordStore({ dataDir, now: () => NOW, log: (line) => lines.push(line) });
    store.onChange((id) => changes.push(id));
    return store;
  };

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), "pa-records-")));
    dataDir = join(dir, "Apps", "pomade-agents");
    lines.length = 0;
    changes.length = 0;
  });

  afterEach(async () => {
    await store?.stop();
    store = null;
    await rm(dir, { recursive: true, force: true });
  });

  it("starts empty with no first run, and makes only its sessions folder", async () => {
    const s = await open();
    expect(s.settings()).toEqual({ ok: true, value: { adoptedAt: null } });
    expect(s.get("a")).toBeUndefined();
    expect(await readdir(dataDir)).toEqual([SESSIONS_FOLDER]);
  });

  it("reads the records and settings already on disk, holding an unreadable record as a problem", async () => {
    await mkdir(join(dataDir, SESSIONS_FOLDER), { recursive: true });
    await writeFile(join(dataDir, SETTINGS_FILE), "adoptedAt: 2026-11-01T00:00:00.000Z\n");
    await writeFile(fileOf("a"), "id: a\nprovider: codex\nagent: codex\nstatus: done\n");
    await writeFile(fileOf("bad"), "id: [\n");
    await writeFile(join(dataDir, SESSIONS_FOLDER, "notes.txt"), "not a record");
    const s = await open();
    expect(s.settings()).toEqual({ ok: true, value: { adoptedAt: "2026-11-01T00:00:00.000Z" } });
    expect(s.get("a")).toEqual({ record: record("a", { status: "done" }), problem: null });
    expect(s.get("bad")).toMatchObject({ record: null, problem: expect.stringContaining("not valid YAML") });
    expect(lines.join("\n")).toContain("bad.yaml cannot be used");
  });

  it("creates a record with its write time, and never over a file that is there", async () => {
    const s = await open();
    await s.create(record("a"));
    expect(await readFile(fileOf("a"), "utf8")).toBe("id: a\nprovider: codex\nagent: codex\nstatus: active\nupdated: 2026-11-17T12:00:00.000Z\n");
    expect(s.get("a")?.record).toEqual(record("a", { updated: NOW.toISOString() }));
    expect(changes).toContain("a");

    await writeFile(fileOf("b"), "id: b\nprovider: codex\nagent: codex\nstatus: on-hold\n");
    await s.create(record("b"));
    expect(await readFile(fileOf("b"), "utf8")).toBe("id: b\nprovider: codex\nagent: codex\nstatus: on-hold\n");
    expect(s.get("b")?.record?.status).toBe("on-hold");
    expect((await readdir(join(dataDir, SESSIONS_FOLDER))).sort()).toEqual(["a.yaml", "b.yaml"]);
  });

  it("applies a change to the file as it is on disk, keeping a hand edit made meanwhile", async () => {
    const s = await open();
    await s.create(record("a"));
    await writeFile(fileOf("a"), "# mine\nid: a\nprovider: codex\nagent: codex\nstatus: active\nname: Hand named\n");
    const written = await s.update("a", (r) => ({ ...r, status: "done" }));
    expect(written).toEqual(record("a", { status: "done", name: "Hand named", updated: NOW.toISOString() }));
    expect(await readFile(fileOf("a"), "utf8")).toBe("# mine\nid: a\nprovider: codex\nagent: codex\nstatus: done\nname: Hand named\nupdated: 2026-11-17T12:00:00.000Z\n");
  });

  it("does not write a change that changes nothing", async () => {
    const s = await open();
    const text = "id: a\nprovider: codex\nagent: codex\nstatus: done\n";
    await mkdir(join(dataDir, SESSIONS_FOLDER), { recursive: true });
    await writeFile(fileOf("a"), text);
    await s.update("a", (r) => ({ ...r }));
    expect(await readFile(fileOf("a"), "utf8")).toBe(text);
  });

  it("refuses to write over an unreadable or missing record", async () => {
    const s = await open();
    await writeFile(fileOf("bad"), "status: [\n");
    await expect(s.update("bad", (r) => ({ ...r, status: "done" }))).rejects.toThrow(RecordError);
    await expect(s.update("bad", (r) => r)).rejects.toMatchObject({ kind: "unreadable" });
    expect(await readFile(fileOf("bad"), "utf8")).toBe("status: [\n");
    expect(s.get("bad")?.problem).toContain("not valid YAML");
    await expect(s.update("none", (r) => r)).rejects.toMatchObject({ kind: "missing" });
  });

  it("runs changes to one record one after another, each from the last one's result", async () => {
    const s = await open();
    await s.create(record("a", { note: "0" }));
    await Promise.all(Array.from({ length: 10 }, () => s.update("a", (r) => ({ ...r, note: String(Number(r.note) + 1) }))));
    expect(s.get("a")?.record?.note).toBe("10");
    expect(await readFile(fileOf("a"), "utf8")).toContain("note: \"10\"");
    expect((await readdir(join(dataDir, SESSIONS_FOLDER))).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("re-reads a record edited, broken, fixed or deleted on disk, and settings written by hand", async () => {
    const s = await open();
    await s.create(record("a"));
    await writeFile(fileOf("a"), "id: a\nprovider: codex\nagent: codex\nstatus: done\n");
    await expect.poll(() => s.get("a")?.record?.status, SOON).toBe("done");
    await writeFile(fileOf("a"), "id: a\nstatus: [\n");
    await expect.poll(() => s.get("a")?.problem ?? null, SOON).toContain("not valid YAML");
    await writeFile(fileOf("a"), "id: a\nprovider: codex\nagent: codex\nstatus: on-hold\n");
    await expect.poll(() => s.get("a")?.record?.status, SOON).toBe("on-hold");
    await unlink(fileOf("a"));
    await expect.poll(() => s.get("a"), SOON).toBeUndefined();

    await writeFile(join(dataDir, SETTINGS_FILE), "adoptedAt: nope\n");
    await expect.poll(() => s.settings().ok, SOON).toBe(false);
    expect(changes).toContain(null);
  });

  it("writes the first run's settings once, never over settings that are there", async () => {
    const s = await open();
    await s.adopt("2026-11-17T12:00:00.000Z");
    expect(s.settings()).toEqual({ ok: true, value: { adoptedAt: "2026-11-17T12:00:00.000Z" } });
    await s.adopt("2026-12-01T00:00:00.000Z");
    expect(await readFile(join(dataDir, SETTINGS_FILE), "utf8")).toBe("adoptedAt: 2026-11-17T12:00:00.000Z\n");
  });

  it("follows its sessions folder being removed and made again", async () => {
    const s = await open();
    await s.create(record("a"));
    await rm(join(dataDir, SESSIONS_FOLDER), { recursive: true });
    await expect.poll(() => s.get("a"), SOON).toBeUndefined();
    await s.create(record("a", { status: "done" }));
    expect(s.get("a")?.record?.status).toBe("done");
    await writeFile(fileOf("b"), "id: b\nprovider: codex\nagent: codex\nstatus: done\n");
    await expect.poll(() => s.get("b")?.record?.status, { timeout: 5000, interval: 50 }).toBe("done");
  });
});
