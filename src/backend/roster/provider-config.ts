// An agent's default model and effort, read from its provider's own config — their single truth
// (ARCHITECTURE §3.2): Claude Code's `<configDir>/settings.json` (`model`, `effortLevel`), Codex's
// `<configDir>/config.toml` (`model`, `model_reasoning_effort`, top-level keys). Only read here.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { AgentProvider } from "../../shared/roster.ts";

export interface ModelDefaults {
  model: string | null;
  effort: string | null;
}

const NONE: ModelDefaults = { model: null, effort: null };

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** The top-level string keys of a TOML file (those before its first table), e.g. `model = "gpt-5"`. */
export function tomlTopLevelStrings(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) break;
    const match = /^([A-Za-z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')\s*(?:#.*)?$/.exec(line);
    if (match === null) continue;
    const [, key = "", basic, literal] = match;
    out[key] = literal ?? (basic ?? "").replace(/\\(["\\])/g, "$1");
  }
  return out;
}

export async function modelDefaults(provider: AgentProvider, configDir: string | null): Promise<ModelDefaults> {
  if (configDir === null) return NONE;
  try {
    if (provider === "claude") {
      const settings: unknown = JSON.parse(await readFile(join(configDir, "settings.json"), "utf8"));
      if (typeof settings !== "object" || settings === null) return NONE;
      const { model, effortLevel } = settings as Record<string, unknown>;
      return { model: text(model), effort: text(effortLevel) };
    }
    const keys = tomlTopLevelStrings(await readFile(join(configDir, "config.toml"), "utf8"));
    return { model: text(keys.model), effort: text(keys.model_reasoning_effort) };
  } catch {
    return NONE;
  }
}
