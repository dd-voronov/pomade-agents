// What the app knows of an agent before it has a profile — the values its first `agent.yaml` is
// written with (ARCHITECTURE §3.2): the folder scan (ARCHITECTURE §3.1), Pomade's `.pomade/agents.json`
// (command overrides, hidden agents) and the role line from the first sentence under `## Role` in
// the agent's `CLAUDE.md`. The same values stand in for an agent whose profile cannot be used, or
// that has none because no workspace is open.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { MODE_IDS, type AgentProfile } from "../../shared/roster.ts";
import { AGENTS_FOLDER, AGENT_MARKER, BUILTIN_CLAUDE, BUILTIN_CODEX } from "../stores/roots.ts";

/** Pomade's per-workspace agent overrides, `<workspace>/.pomade/agents.json`. */
export interface PomadeOverrides {
  commands: Record<string, string>;
  hidden: string[];
}

export const NO_OVERRIDES: PomadeOverrides = { commands: {}, hidden: [] };

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Pomade's overrides for the workspace: none when the file is missing; malformed parts are left out. */
export async function readPomadeOverrides(workspace: string, log: (line: string) => void): Promise<PomadeOverrides> {
  const path = join(workspace, ".pomade", "agents.json");
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") log(`roster: ${path} cannot be read: ${message(err)}`);
    return NO_OVERRIDES;
  }
  if (typeof raw !== "object" || raw === null) return NO_OVERRIDES;
  const { commands, hidden } = raw as Record<string, unknown>;
  const out: PomadeOverrides = { commands: {}, hidden: [] };
  if (typeof commands === "object" && commands !== null && !Array.isArray(commands)) {
    for (const [id, command] of Object.entries(commands)) {
      if (typeof command === "string" && command.trim() !== "" && !/[\r\n]/.test(command)) out.commands[id] = command.trim();
    }
  }
  if (Array.isArray(hidden)) out.hidden = hidden.filter((id): id is string => typeof id === "string");
  return out;
}

/** The first sentence of the first paragraph under a `## Role` heading, on one line; `undefined`
 *  when there is none. */
export function roleLine(markdown: string): string | undefined {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+Role\s*$/i.test(line.trim()));
  if (start === -1) return undefined;
  const paragraph: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const text = line.trim();
    if (/^#{1,6}\s/.test(text)) break;
    if (text === "") {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(text);
  }
  const text = paragraph.join(" ").replace(/\s+/g, " ").trim();
  if (text === "") return undefined;
  const end = /[.!?](?=\s|$)/.exec(text);
  return end === null ? text : text.slice(0, end.index + 1);
}

/** Where a built-in's config is, as `agent.yaml` writes it. */
const BUILTIN_CONFIG: Readonly<Record<string, { provider: AgentProfile["provider"]; configDir: string }>> = {
  [BUILTIN_CLAUDE]: { provider: "claude", configDir: "~/.claude" },
  [BUILTIN_CODEX]: { provider: "codex", configDir: "~/.codex" },
};

export const BUILTIN_IDS: readonly string[] = [BUILTIN_CLAUDE, BUILTIN_CODEX];

/** What "+" menus and tabs call an agent: the built-ins by their CLI's name, a folder agent by its folder. */
export function agentName(id: string): string {
  return id === BUILTIN_CLAUDE ? "Claude" : id === BUILTIN_CODEX ? "Codex" : id;
}

const allModes = (): AgentProfile["modes"] => Object.fromEntries(MODE_IDS.map((id) => [id, { enabled: true }]));

/** A built-in's first profile. */
export function builtinProfile(id: string, overrides: PomadeOverrides): AgentProfile {
  const builtin = BUILTIN_CONFIG[id];
  if (builtin === undefined) throw new Error(`${id} is not a built-in agent`);
  return {
    id,
    provider: builtin.provider,
    kind: "builtin",
    configDir: builtin.configDir,
    command: overrides.commands[id] ?? id,
    tags: [],
    hidden: overrides.hidden.includes(id),
    modes: allModes(),
  };
}

/** A folder agent's first profile; its role from its `CLAUDE.md`. */
export async function folderProfile(workspace: string, id: string, overrides: PomadeOverrides): Promise<AgentProfile> {
  const configDir = `${AGENTS_FOLDER}/${id}`;
  let role: string | undefined;
  try {
    role = roleLine(await readFile(join(workspace, configDir, AGENT_MARKER), "utf8"));
  } catch {
    role = undefined;
  }
  return {
    id,
    provider: "claude",
    kind: "folder",
    configDir,
    command: overrides.commands[id] ?? id,
    ...(role === undefined ? {} : { role }),
    tags: [],
    hidden: overrides.hidden.includes(id),
    modes: allModes(),
  };
}
