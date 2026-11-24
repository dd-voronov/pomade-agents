// The Skills tab's writes (DESIGN §3.4): a skill is switched on by making a symlink in the agent's
// own `skills/` folder and off by taking that symlink away. The rules keep every write inside that
// one folder:
//
// - **Only `skills/` itself.** The entry name is one plain path segment — no `/`, no `.`/`..`, no
//   leading `.` — so the link is always a direct child of the folder. A `skills/` that is itself a
//   symlink, or not a folder, is refused: writing through it would land somewhere else.
// - **Only symlinks.** Removing refuses anything that is not a symlink: an own skill (a real
//   folder) is never removed. `unlink` takes the link away and never follows it, so its target is
//   untouched. Making a link never replaces an entry already there.
// - **The link's form** is the one the workspace's links already use: relative to `skills/` when
//   both the folder and the target lie in the workspace (`../../_shared/skills/grill-me`, as the
//   agent template's), else absolute (`~/.claude/skills` → the workspace).

import { lstat, mkdir, readlink, symlink, unlink } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

/** The longest entry name taken (a file name's limit on macOS). */
export const ENTRY_NAME_MAX = 255;

export type LinkWrite = { ok: true; target: string } | { ok: false; reason: string };

const code = (err: unknown): string | undefined => (err as NodeJS.ErrnoException | null)?.code;

const inside = (child: string, parent: string): boolean => child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);

/** Why `name` cannot be an entry of `skills/`; `null` when it can. */
export function entryNameProblem(name: string): string | null {
  if (name.trim() === "") return "The name is empty.";
  if (name.length > ENTRY_NAME_MAX) return `The name is longer than ${ENTRY_NAME_MAX} characters.`;
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) return "The name must be one folder name, without slashes.";
  if (name.startsWith(".")) return "The name must not start with a dot.";
  return null;
}

/** The text a new link in `skillsDir` holds for `target` (absolute): relative when both lie in `workspace`. */
export function linkText(skillsDir: string, target: string, workspace: string | null): string {
  if (workspace !== null && inside(skillsDir, workspace) && inside(target, workspace)) return relative(skillsDir, target);
  return target;
}

/** `skillsDir` is a real folder (made when missing, its parent must exist); else why it cannot be written. */
async function ownFolder(skillsDir: string, make: boolean): Promise<string | null> {
  try {
    const stat = await lstat(skillsDir);
    if (stat.isSymbolicLink()) return `${skillsDir} is a symlink: the app writes only inside the agent's own skills folder.`;
    if (!stat.isDirectory()) return `${skillsDir} is not a folder.`;
    return null;
  } catch (err) {
    if (code(err) !== "ENOENT") throw err;
  }
  if (!make) return `${skillsDir} does not exist.`;
  try {
    await mkdir(skillsDir);
    return null;
  } catch (err) {
    if (code(err) === "ENOENT") return `The agent's folder ${skillsDir.slice(0, skillsDir.lastIndexOf(sep))} does not exist.`;
    throw err;
  }
}

/** Make the link `skillsDir/name` → `target` (absolute). Never replaces an entry. */
export async function linkSkill(skillsDir: string, name: string, target: string, workspace: string | null): Promise<LinkWrite> {
  const problem = entryNameProblem(name);
  if (problem !== null) return { ok: false, reason: problem };
  if (!isAbsolute(target)) return { ok: false, reason: "The target must be an absolute path." };
  const folder = await ownFolder(skillsDir, true);
  if (folder !== null) return { ok: false, reason: folder };
  try {
    await symlink(linkText(skillsDir, target, workspace), join(skillsDir, name));
  } catch (err) {
    if (code(err) === "EEXIST") return { ok: false, reason: `skills/${name} already exists.` };
    throw err;
  }
  return { ok: true, target };
}

/** Take the link `skillsDir/name` away, never its target; a real folder or file is refused. */
export async function unlinkSkill(skillsDir: string, name: string): Promise<LinkWrite> {
  const problem = entryNameProblem(name);
  if (problem !== null) return { ok: false, reason: problem };
  const folder = await ownFolder(skillsDir, false);
  if (folder !== null) return { ok: false, reason: folder };
  const path = join(skillsDir, name);
  try {
    const stat = await lstat(path);
    if (!stat.isSymbolicLink()) {
      return { ok: false, reason: stat.isDirectory() ? `skills/${name} is the agent's own skill, not a link: the app never removes it.` : `skills/${name} is not a link.` };
    }
    const target = resolve(skillsDir, await readlink(path));
    await unlink(path);
    return { ok: true, target };
  } catch (err) {
    if (code(err) === "ENOENT") return { ok: false, reason: `skills/${name} is not there.` };
    throw err;
  }
}
