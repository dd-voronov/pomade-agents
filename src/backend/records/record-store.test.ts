import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AgentProfile } from "../../shared/roster.ts";
import type { SessionRecord } from "../../shared/sessions.ts";
import { AGENTS_FOLDER, PROFILE_FILE, RecordError, SESSIONS_FOLDER, SETTINGS_FILE, openRecordStore, type RecordStore } from "./record-store.ts";

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
    expect(s.get("a")).toEqual({ value: record("a", { status: "done" }), problem: null });
    expect(s.get("bad")).toMatchObject({ value: null, problem: expect.stringContaining("not valid YAML") });
    expect(lines.join("\n")).toContain("bad.yaml cannot be used");
  });

  it("creates a record with its write time, and never over a file that is there", async () => {
    const s = await open();
    await s.create(record("a"));
    expect(await readFile(fileOf("a"), "utf8")).toBe("id: a\nprovider: codex\nagent: codex\nstatus: active\nupdated: 2026-11-17T12:00:00.000Z\n");
    expect(s.get("a")?.value).toEqual(record("a", { updated: NOW.toISOString() }));
    expect(changes).toContain("a");

    await writeFile(fileOf("b"), "id: b\nprovider: codex\nagent: codex\nstatus: on-hold\n");
    await s.create(record("b"));
    expect(await readFile(fileOf("b"), "utf8")).toBe("id: b\nprovider: codex\nagent: codex\nstatus: on-hold\n");
    expect(s.get("b")?.value?.status).toBe("on-hold");
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

  it("a write refused by the system names the record file and the reason, never the temporary file", async () => {
    const s = await open();
    await s.create(record("a"));
    const folder = join(dataDir, SESSIONS_FOLDER);
    await chmod(folder, 0o555);
    try {
      const refused = await s.update("a", (r) => ({ ...r, status: "done" })).then(
        () => null,
        (err: unknown) => err,
      );
      expect(refused).toBeInstanceOf(Error);
      expect((refused as Error).message).toBe(`${fileOf("a")} could not be written (EACCES: permission denied)`);
    } finally {
      await chmod(folder, 0o755);
    }
    expect(s.get("a")?.value?.status).toBe("active");
    expect((await readdir(folder)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("runs changes to one record one after another, each from the last one's result", async () => {
    const s = await open();
    await s.create(record("a", { note: "0" }));
    await Promise.all(Array.from({ length: 10 }, () => s.update("a", (r) => ({ ...r, note: String(Number(r.note) + 1) }))));
    expect(s.get("a")?.value?.note).toBe("10");
    expect(await readFile(fileOf("a"), "utf8")).toContain("note: \"10\"");
    expect((await readdir(join(dataDir, SESSIONS_FOLDER))).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("re-reads a record edited, broken, fixed or deleted on disk, and settings written by hand", async () => {
    const s = await open();
    await s.create(record("a"));
    await writeFile(fileOf("a"), "id: a\nprovider: codex\nagent: codex\nstatus: done\n");
    await expect.poll(() => s.get("a")?.value?.status, SOON).toBe("done");
    await writeFile(fileOf("a"), "id: a\nstatus: [\n");
    await expect.poll(() => s.get("a")?.problem ?? null, SOON).toContain("not valid YAML");
    await writeFile(fileOf("a"), "id: a\nprovider: codex\nagent: codex\nstatus: on-hold\n");
    await expect.poll(() => s.get("a")?.value?.status, SOON).toBe("on-hold");
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
    expect(s.get("a")?.value?.status).toBe("done");
    await writeFile(fileOf("b"), "id: b\nprovider: codex\nagent: codex\nstatus: done\n");
    await expect.poll(() => s.get("b")?.value?.status, { timeout: 5000, interval: 50 }).toBe("done");
  });

  describe("agent profiles", () => {
    const profile = (id: string, patch: Partial<AgentProfile> = {}): AgentProfile => ({
      id,
      provider: "claude",
      kind: "folder",
      configDir: `Agents/${id}`,
      command: id,
      tags: [],
      hidden: false,
      modes: { normal: { enabled: true } },
      ...patch,
    });
    const profileFile = (id: string): string => join(dataDir, AGENTS_FOLDER, id, PROFILE_FILE);

    it("writes each in its agent's folder, never over a file that is there, and changes it key by key", async () => {
      await mkdir(join(dataDir, AGENTS_FOLDER, "b"), { recursive: true });
      await writeFile(profileFile("b"), "# mine\nid: b\nprovider: codex\nkind: builtin\nconfigDir: ~/.codex\ncommand: codex\nmodes: {}\n");
      const s = await open();
      expect(s.profiles.ids()).toEqual(["b"]);
      await s.profiles.create(profile("a"));
      await s.profiles.create(profile("b"));
      expect(s.profiles.get("a")).toEqual({ value: profile("a"), problem: null });
      expect(s.profiles.get("b")?.value?.provider).toBe("codex");
      await s.profiles.update("b", (p) => ({ ...p, hidden: true }));
      expect(await readFile(profileFile("b"), "utf8")).toBe("# mine\nid: b\nprovider: codex\nkind: builtin\nconfigDir: ~/.codex\ncommand: codex\nmodes: {}\nhidden: true\n");
      await expect(s.profiles.update("ghost", (p) => p)).rejects.toMatchObject({ kind: "missing", message: expect.stringContaining("Agent ghost has no profile file") });
      expect(changes.every((id) => id === null || !["a", "b"].includes(id))).toBe(true);
    });

    it("re-reads a profile edited, broken, deleted, or its whole folder removed, on disk", async () => {
      const s = await open();
      const seen: string[] = [];
      s.profiles.onChange((id) => seen.push(id));
      await s.profiles.create(profile("a"));
      await writeFile(profileFile("a"), "id: a\nprovider: [\n");
      await expect.poll(() => s.profiles.get("a")?.problem ?? null, SOON).toContain("not valid YAML");
      await expect(s.profiles.update("a", (p) => p)).rejects.toMatchObject({ kind: "unreadable" });
      expect(await readFile(profileFile("a"), "utf8")).toBe("id: a\nprovider: [\n");
      await unlink(profileFile("a"));
      await expect.poll(() => s.profiles.get("a"), SOON).toBeUndefined();
      await s.profiles.create(profile("a"));
      await rm(join(dataDir, AGENTS_FOLDER), { recursive: true });
      await expect.poll(() => s.profiles.ids(), SOON).toEqual([]);
      await mkdir(join(dataDir, AGENTS_FOLDER, "c"), { recursive: true });
      await writeFile(profileFile("c"), "id: c\nprovider: claude\nkind: folder\nconfigDir: Agents/c\ncommand: c\nmodes: {}\n");
      await expect.poll(() => s.profiles.get("c")?.value?.command, { timeout: 5000, interval: 50 }).toBe("c");
      expect(seen).toContain("a");
    });

    it("removes a profile and its folder, keeps a folder that holds more, and takes a file already gone", async () => {
      const s = await open();
      const seen: string[] = [];
      s.profiles.onChange((id) => seen.push(id));
      await s.profiles.create(profile("a"));
      await s.profiles.create(profile("b"));
      await writeFile(join(dataDir, AGENTS_FOLDER, "b", "notes.md"), "kept\n");
      const removed = await s.profiles.remove("a");
      expect(removed).toContain("id: a\n");
      expect(s.profiles.get("a")).toBeUndefined();
      expect(seen).toContain("a");
      await expect(stat(join(dataDir, AGENTS_FOLDER, "a"))).rejects.toMatchObject({ code: "ENOENT" });
      await s.profiles.remove("b");
      expect(s.profiles.ids()).toEqual([]);
      expect(await readFile(join(dataDir, AGENTS_FOLDER, "b", "notes.md"), "utf8")).toBe("kept\n");
      await expect(s.profiles.remove("ghost")).resolves.toBeNull();

      // Restored as it was: written new, over other text, never from a text that is not the id's profile.
      await s.profiles.restore("a", removed ?? "");
      expect(await readFile(profileFile("a"), "utf8")).toBe(removed);
      expect(s.profiles.get("a")?.value).toEqual(profile("a"));
      expect(s.profiles.text("a")).toBe(removed);
      await writeFile(profileFile("a"), "# edited\nid: a\nprovider: codex\nkind: folder\nconfigDir: Agents/a\ncommand: a\nmodes: {}\n");
      await s.profiles.restore("a", removed ?? "");
      expect(await readFile(profileFile("a"), "utf8")).toBe(removed);
      await expect(s.profiles.restore("a", "id: b\nprovider: claude\n")).rejects.toMatchObject({ kind: "unreadable" });
      expect(await readFile(profileFile("a"), "utf8")).toBe(removed);
    });
  });
});
