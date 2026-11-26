// What an agent's provider config says, read for its page (ARCHITECTURE §3.4): permissions, MCP servers
// and plugins from Claude Code's `settings.json` and `.claude.json`, or Codex's `config.toml`; and
// the project memory a Claude Code agent keeps under `<configDir>/projects/<folder>/memory/`.
// Read only — the files are the provider's.

import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import type { AgentMemory, AgentMemoryFolder, AgentPermissions, AgentProvider, McpServer } from "../../shared/roster.ts";
import { tomlTopLevelStrings } from "./provider-config.ts";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const texts = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim() !== "") : []);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The MCP servers of a Claude Code `.claude.json` (its user-level `mcpServers`); none when the file is absent or unreadable. */
async function claudeMcp(path: string | null): Promise<McpServer[]> {
  if (path === null) return [];
  try {
    const source = await readText(path);
    if (source === null) return [];
    const servers: unknown = (JSON.parse(source) as Record<string, unknown>).mcpServers;
    if (!isObject(servers)) return [];
    return Object.entries(servers)
      .map(([name, server]): McpServer => ({ name, type: isObject(server) ? (text(server.type) ?? (typeof server.command === "string" ? "stdio" : null)) : null }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/** The MCP servers a Codex `config.toml` declares: its `[mcp_servers.<name>]` tables. */
export function codexMcp(source: string): McpServer[] {
  const servers: McpServer[] = [];
  let current: { name: string; keys: Set<string> } | null = null;
  const close = (): void => {
    if (current === null) return;
    servers.push({ name: current.name, type: current.keys.has("command") ? "stdio" : current.keys.has("url") ? "http" : null });
    current = null;
  };
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      close();
      const header = /^\[mcp_servers\.(?:"([^"]+)"|([A-Za-z0-9_-]+))\]$/.exec(line);
      if (header !== null) current = { name: header[1] ?? header[2] ?? "", keys: new Set() };
      continue;
    }
    const key = /^([A-Za-z0-9_-]+)\s*=/.exec(line)?.[1];
    if (current !== null && key !== undefined) current.keys.add(key);
  }
  close();
  return servers.sort((a, b) => a.name.localeCompare(b.name));
}

export interface PermissionsSource {
  provider: AgentProvider;
  /** The agent's config folder, absolute. */
  configDir: string;
  /** A built-in's `.claude.json` lies beside its folder, in the home folder. */
  builtin: boolean;
  home: string | null;
}

/** A config that grants nothing: what an absent or unreadable file says. */
const nothing = (): Omit<AgentPermissions, "provider" | "file" | "exists" | "problem"> => ({ defaultMode: null, sandbox: null, allow: [], ask: [], deny: [], mcp: [], plugins: [] });

export async function readPermissions({ provider, configDir, builtin, home }: PermissionsSource): Promise<AgentPermissions> {
  if (provider === "codex") {
    const file = join(configDir, "config.toml");
    const base = { provider, file, ...nothing() };
    try {
      const source = await readText(file);
      if (source === null) return { ...base, exists: false, problem: null };
      const keys = tomlTopLevelStrings(source);
      return { ...base, exists: true, problem: null, defaultMode: text(keys.approval_policy), sandbox: text(keys.sandbox_mode), mcp: codexMcp(source) };
    } catch (err) {
      return { ...base, exists: true, problem: message(err) };
    }
  }
  const file = join(configDir, "settings.json");
  const base = { provider, file, ...nothing() };
  try {
    const source = await readText(file);
    if (source === null) return { ...base, exists: false, problem: null, mcp: await claudeMcp(claudeJson(configDir, builtin, home)) };
    const settings: unknown = JSON.parse(source);
    if (!isObject(settings)) return { ...base, exists: true, problem: "it is not a JSON object" };
    const permissions = isObject(settings.permissions) ? settings.permissions : {};
    const plugins = isObject(settings.enabledPlugins) ? Object.entries(settings.enabledPlugins).filter(([, on]) => on === true).map(([name]) => name) : [];
    return {
      ...base,
      exists: true,
      problem: null,
      defaultMode: text(permissions.defaultMode),
      allow: texts(permissions.allow),
      ask: texts(permissions.ask),
      deny: texts(permissions.deny),
      mcp: await claudeMcp(claudeJson(configDir, builtin, home)),
      plugins: plugins.sort((a, b) => a.localeCompare(b)),
    };
  } catch (err) {
    return { ...base, exists: true, problem: message(err) };
  }
}

/** Where a Claude Code agent's `.claude.json` is: in its config folder, or for the built-in, in the home folder. */
function claudeJson(configDir: string, builtin: boolean, home: string | null): string | null {
  if (!builtin) return join(configDir, ".claude.json");
  return home === null ? null : join(home, ".claude.json");
}

const MEMORY_INDEX = "MEMORY.md";

const byMemoryName = (a: string, b: string): number => (a === MEMORY_INDEX ? -1 : b === MEMORY_INDEX ? 1 : a.localeCompare(b));

/** The memory a Claude Code agent keeps: the Markdown files of every `projects/<folder>/memory/` that has some. */
export async function readMemory(provider: AgentProvider, configDir: string): Promise<AgentMemory> {
  if (provider !== "claude") return { folders: [] };
  const projects = join(configDir, "projects");
  let folders;
  try {
    folders = await readdir(projects, { withFileTypes: true });
  } catch {
    return { folders: [] };
  }
  const out: AgentMemoryFolder[] = [];
  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    const dir = join(projects, folder.name, "memory");
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    const files: AgentMemoryFolder["files"] = [];
    for (const name of names.filter((n) => n.toLowerCase().endsWith(".md")).sort(byMemoryName)) {
      const path = join(dir, name);
      if ((await stat(path).catch(() => null))?.isFile() === true) files.push({ name, path });
    }
    if (files.length > 0) out.push({ folder: folder.name, files });
  }
  return { folders: out.sort((a, b) => a.folder.localeCompare(b.folder)) };
}
