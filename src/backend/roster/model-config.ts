// An agent's default model and effort in its provider config (DESIGN §3.2, §3.4): read for both
// providers, written for Claude Code only — `settings.json`'s `model` and `effortLevel`, every
// other byte of the file kept (`json-keys.ts`).
//
// - **Never over an unusable file.** A `settings.json` that cannot be read or is not a JSON object
//   is reported and refused for writes.
// - **A missing file** is created holding just the keys set; removing a key from a missing file
//   writes nothing.
// - **One write at a time per file**, each starting from the file as it is on disk then, so a hand
//   edit made before it stays. The new text replaces the file through a sibling temporary file and a
//   rename at the path the file resolves to — a symlinked `settings.json` stays a symlink.

import { randomUUID } from "node:crypto";
import { readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type { AgentModelConfig, AgentProvider } from "../../shared/roster.ts";
import { editJsonKeys, jsonObjectProblem, newJsonObject, type JsonKeyChanges } from "./json-keys.ts";
import { tomlTopLevelStrings } from "./provider-config.ts";

/** The keys `roster.setModel` writes, by what they hold. */
export const SETTINGS_KEYS = { model: "model", effort: "effortLevel" } as const;

export type ModelChange = { model?: string | null; effort?: string | null };

const code = (err: unknown): string | undefined => (typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : undefined);
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** The provider config file holding an agent's model. */
export function modelConfigFile(provider: AgentProvider, configDir: string): string {
  return join(configDir, provider === "claude" ? "settings.json" : "config.toml");
}

async function readText(path: string): Promise<{ text: string | null; problem: string | null }> {
  try {
    return { text: await readFile(path, "utf8"), problem: null };
  } catch (err) {
    if (code(err) === "ENOENT") return { text: null, problem: null };
    return { text: null, problem: `it cannot be read (${message(err)})` };
  }
}

/** What `text` (or no file) says of the model, for `provider`. */
function configOf(provider: AgentProvider, file: string, read: { text: string | null; problem: string | null }): AgentModelConfig {
  const base = { provider, file, exists: read.text !== null || read.problem !== null };
  if (read.problem !== null) return { ...base, problem: read.problem, model: null, effort: null, writable: false };
  if (read.text === null) return { ...base, problem: null, model: null, effort: null, writable: provider === "claude" };
  if (provider === "codex") {
    const keys = tomlTopLevelStrings(read.text);
    return { ...base, problem: null, model: text(keys.model), effort: text(keys.model_reasoning_effort), writable: false };
  }
  const problem = jsonObjectProblem(read.text);
  if (problem !== null) return { ...base, problem, model: null, effort: null, writable: false };
  const settings = JSON.parse(read.text) as Record<string, unknown>;
  return { ...base, problem: null, model: text(settings[SETTINGS_KEYS.model]), effort: text(settings[SETTINGS_KEYS.effort]), writable: true };
}

export async function readModelConfig(provider: AgentProvider, configDir: string): Promise<AgentModelConfig> {
  const file = modelConfigFile(provider, configDir);
  return configOf(provider, file, await readText(file));
}

/** Why a model change cannot be written, as `roster.setModel` refuses it. */
export class ModelWriteError extends Error {
  readonly kind: "read-only" | "unusable" | "io";
  constructor(kind: "read-only" | "unusable" | "io", text: string) {
    super(text);
    this.kind = kind;
  }
}

async function replaceFile(path: string, text: string): Promise<void> {
  let target = path;
  let mode: number | undefined;
  try {
    target = await realpath(path);
    mode = (await stat(target)).mode & 0o7777;
  } catch (err) {
    if (code(err) !== "ENOENT") throw err;
  }
  const tmp = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
  await writeFile(tmp, text, mode === undefined ? "utf8" : { encoding: "utf8", mode });
  try {
    await rename(tmp, target);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

/** Writes to one file run one after another. */
const queues = new Map<string, Promise<unknown>>();

function queued<T>(path: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(path) ?? Promise.resolve();
  const run = previous.then(task, task);
  const tail = run.catch(() => undefined);
  queues.set(path, tail);
  void tail.then(() => {
    if (queues.get(path) === tail) queues.delete(path);
  });
  return run;
}

/** Apply `change` to a Claude Code agent's `settings.json` and answer the config as written.
 *  Rejects with `ModelWriteError`: `read-only` (Codex), `unusable` (a file that is not a JSON object), `io`. */
export function writeModelConfig(provider: AgentProvider, configDir: string, change: ModelChange): Promise<AgentModelConfig> {
  const file = modelConfigFile(provider, configDir);
  if (provider !== "claude") return Promise.reject(new ModelWriteError("read-only", "Codex's model is read-only here: it is set in its config.toml"));
  const changes: Record<string, string | null> = {};
  if (change.model !== undefined) changes[SETTINGS_KEYS.model] = change.model;
  if (change.effort !== undefined) changes[SETTINGS_KEYS.effort] = change.effort;
  return queued(file, async () => {
    const read = await readText(file);
    const current = configOf(provider, file, read);
    if (current.problem !== null) throw new ModelWriteError("unusable", `${file} cannot be used: ${current.problem}. Fix the file; the app never writes over it.`);
    const next = read.text === null ? (Object.values(changes).some((v) => v !== null) ? newJsonObject(changes as JsonKeyChanges) : null) : editJsonKeys(read.text, changes);
    if (next === null || next === read.text) return current;
    try {
      await replaceFile(file, next);
    } catch (err) {
      throw new ModelWriteError("io", `${file} could not be written: ${message(err)}`);
    }
    return configOf(provider, file, { text: next, problem: null });
  });
}
