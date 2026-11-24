import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, lstat, stat, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ModelWriteError, readModelConfig, writeModelConfig } from "./model-config.ts";

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "model-config-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const SETTINGS = '{\n    "permissions": { "allow": [] },\n    "model": "opus"\n}\n';
const settingsOf = (): Promise<string> => readFile(join(dir, "settings.json"), "utf8");

describe("readModelConfig", () => {
  it("reads Claude Code's settings.json and Codex's config.toml", async () => {
    await writeFile(join(dir, "settings.json"), '{"model": "sonnet", "effortLevel": "low"}');
    await writeFile(join(dir, "config.toml"), 'model = "gpt-5"\nmodel_reasoning_effort = "high"\n[x]\nmodel = "no"\n');
    expect(await readModelConfig("claude", dir)).toEqual({ provider: "claude", file: join(dir, "settings.json"), exists: true, problem: null, model: "sonnet", effort: "low", writable: true });
    expect(await readModelConfig("codex", dir)).toEqual({ provider: "codex", file: join(dir, "config.toml"), exists: true, problem: null, model: "gpt-5", effort: "high", writable: false });
  });

  it("a missing settings.json is writable and sets nothing", async () => {
    expect(await readModelConfig("claude", dir)).toMatchObject({ exists: false, problem: null, model: null, effort: null, writable: true });
  });

  it("a settings.json that is not a JSON object is reported and not writable", async () => {
    await writeFile(join(dir, "settings.json"), '{ "model": "opus", }');
    expect(await readModelConfig("claude", dir)).toMatchObject({ exists: true, problem: expect.stringMatching(/^it is not valid JSON/) as unknown, model: null, writable: false });
  });
});

describe("writeModelConfig", () => {
  it("changes only the keys given, the rest of the file byte for byte", async () => {
    await writeFile(join(dir, "settings.json"), SETTINGS);
    expect(await writeModelConfig("claude", dir, { effort: "high" })).toMatchObject({ model: "opus", effort: "high" });
    expect(await settingsOf()).toBe('{\n    "permissions": { "allow": [] },\n    "model": "opus",\n    "effortLevel": "high"\n}\n');
    await writeModelConfig("claude", dir, { model: null });
    expect(await settingsOf()).toBe('{\n    "permissions": { "allow": [] },\n    "effortLevel": "high"\n}\n');
  });

  it("creates a missing file with just the keys set, and writes nothing to remove a key from none", async () => {
    await writeModelConfig("claude", dir, { model: null });
    await expect(lstat(join(dir, "settings.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await writeModelConfig("claude", dir, { model: "haiku" });
    expect(await settingsOf()).toBe('{\n  "model": "haiku"\n}\n');
  });

  it("never writes over a file that is not a JSON object", async () => {
    await writeFile(join(dir, "settings.json"), "[1]\n");
    await expect(writeModelConfig("claude", dir, { effort: "low" })).rejects.toMatchObject({ kind: "unusable" });
    expect(await settingsOf()).toBe("[1]\n");
  });

  it("refuses Codex", async () => {
    await expect(writeModelConfig("codex", dir, { model: "x" })).rejects.toBeInstanceOf(ModelWriteError);
  });

  it("writes through a symlinked settings.json, which stays a symlink, and keeps the file's mode", async () => {
    const real = join(dir, "dotfiles");
    await mkdir(real);
    await writeFile(join(real, "settings.json"), SETTINGS);
    await chmod(join(real, "settings.json"), 0o600);
    await symlink(join(real, "settings.json"), join(dir, "settings.json"));
    await writeModelConfig("claude", dir, { model: "sonnet" });
    expect((await lstat(join(dir, "settings.json"))).isSymbolicLink()).toBe(true);
    expect(await readFile(join(real, "settings.json"), "utf8")).toBe(SETTINGS.replace('"opus"', '"sonnet"'));
    expect((await stat(join(real, "settings.json"))).mode & 0o777).toBe(0o600);
  });

  it("runs writes to one file one after another, each from the file as it is then", async () => {
    await writeFile(join(dir, "settings.json"), SETTINGS);
    await Promise.all([writeModelConfig("claude", dir, { effort: "low" }), writeModelConfig("claude", dir, { model: "haiku" }), writeModelConfig("claude", dir, { effort: "xhigh" })]);
    expect(JSON.parse(await settingsOf())).toEqual({ permissions: { allow: [] }, model: "haiku", effortLevel: "xhigh" });
  });
});
