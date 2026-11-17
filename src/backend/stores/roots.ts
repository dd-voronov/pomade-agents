// Where the agents' transcript stores are (DESIGN §2.2) and which files in them are sessions.
//
// | Store | Root | Session file |
// |---|---|---|
// | built-in `claude` | `~/.claude/projects` | `<encoded-cwd>/<sessionId>.jsonl` |
// | folder agent `<name>` | `<workspace>/Agents/<name>/projects` | same |
// | built-in `codex` | `~/.codex/sessions` | `**/rollout-<launch time>-<sessionId>.jsonl` |
//
// Only regular `.jsonl` files at those places count: a Claude store also holds `memory/`,
// per-session folders and `<sessionId>/subagents/*.jsonl`, all one level deeper.

import { access, readdir } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";

import type { SessionProvider } from "../../shared/sessions.ts";

export interface StoreRoot {
  /** Absolute folder the store's session files live under. */
  path: string;
  provider: SessionProvider;
  /** Roster id of the agent whose store it is. */
  agent: string;
}

export interface SessionFile {
  root: StoreRoot;
  path: string;
  /** The session id the file name carries. */
  fileId: string;
}

export const BUILTIN_CLAUDE = "claude";
export const BUILTIN_CODEX = "codex";

const AGENTS_FOLDER = "Agents";
const SHARED_FOLDER = "_shared";
const AGENT_MARKER = "CLAUDE.md";

const CLAUDE_FILE_RE = /^(.+)\.jsonl$/;
const CODEX_FILE_RE = /^rollout-.*?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;

export function builtinRoots(home: string): StoreRoot[] {
  return [
    { path: join(home, ".claude", "projects"), provider: "claude-code", agent: BUILTIN_CLAUDE },
    { path: join(home, ".codex", "sessions"), provider: "codex", agent: BUILTIN_CODEX },
  ];
}

/** True for a folder name the roster scan skips (DESIGN §3.1). */
export function isSkippedAgentFolder(name: string): boolean {
  return name === SHARED_FOLDER || name.toLowerCase().includes("template");
}

/** One store per folder agent: every `<workspace>/Agents/<name>/` holding a `CLAUDE.md`. */
export async function folderAgentRoots(workspace: string): Promise<StoreRoot[]> {
  const agents = join(workspace, AGENTS_FOLDER);
  let entries;
  try {
    entries = await readdir(agents, { withFileTypes: true });
  } catch {
    return [];
  }
  const roots: StoreRoot[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || isSkippedAgentFolder(entry.name)) continue;
    try {
      await access(join(agents, entry.name, AGENT_MARKER));
    } catch {
      continue;
    }
    roots.push({ path: join(agents, entry.name, "projects"), provider: "claude-code", agent: entry.name });
  }
  return roots.sort((a, b) => a.agent.localeCompare(b.agent));
}

/** The session a path names, when it is a session file's place in `root`; else `null`. */
export function sessionFileAt(root: StoreRoot, path: string): SessionFile | null {
  const rel = relative(root.path, path);
  if (rel === "" || rel.startsWith("..")) return null;
  const parts = rel.split(sep);
  const name = basename(path);
  if (root.provider === "claude-code") {
    const id = parts.length === 2 ? CLAUDE_FILE_RE.exec(name)?.[1] : undefined;
    return id === undefined ? null : { root, path, fileId: id };
  }
  const id = CODEX_FILE_RE.exec(name)?.[1];
  return id === undefined ? null : { root, path, fileId: id };
}

/** True when `path` is a folder inside `root` that can hold session files (or folders that do). */
export function mayHoldSessions(root: StoreRoot, path: string): boolean {
  const rel = relative(root.path, path);
  if (rel.startsWith("..")) return false;
  if (rel === "") return true;
  return root.provider === "codex" || rel.split(sep).length === 1;
}

/** Every session file under `folder` (the root or a folder inside it), walking only where sessions can be. */
export async function listSessionFiles(root: StoreRoot, folder: string = root.path): Promise<SessionFile[]> {
  let entries;
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: SessionFile[] = [];
  for (const entry of entries) {
    const path = join(folder, entry.name);
    if (entry.isFile()) {
      const file = sessionFileAt(root, path);
      if (file) found.push(file);
    } else if (entry.isDirectory() && mayHoldSessions(root, path)) {
      found.push(...(await listSessionFiles(root, path)));
    }
  }
  return found;
}
