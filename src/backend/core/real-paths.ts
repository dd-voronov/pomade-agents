// Folders as the sessions contract compares them: absolute with symlinks resolved. Start folders
// repeat across thousands of sessions, so each one is resolved once and kept a while; a folder
// that does not exist (a removed worktree) stands as it is.

import { realpath } from "node:fs/promises";

/** How long a resolved folder is kept: a symlink changed or a folder created since is seen after this. */
const KEEP_MS = 30_000;

export type RealPath = (path: string) => Promise<string>;

export function createRealPaths(now: () => number = Date.now): RealPath {
  const held = new Map<string, { at: number; real: Promise<string> }>();
  return (path) => {
    const t = now();
    const hit = held.get(path);
    if (hit !== undefined && t - hit.at < KEEP_MS) return hit.real;
    const real = realpath(path).catch(() => path);
    held.set(path, { at: t, real });
    return real;
  };
}
