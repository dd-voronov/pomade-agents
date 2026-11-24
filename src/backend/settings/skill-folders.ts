// The skill folders in `settings.yaml` (DESIGN §3.8, §4): the `skillFolders` key read from the
// file's text and written back into it, and the rules a folder of the list follows.
//
// - **Absent key**: `DEFAULT_SKILL_FOLDERS`. An empty list is a list: no folders.
// - **Written** through the `yaml` library's document model, so the file's other keys, its
//   comments and its order stay; only `skillFolders` changes.
// - **A folder** is workspace-relative and POSIX (`Agents/_shared/skills`), read with its
//   subfolders. So it is never the workspace itself, never outside it, never Pomade's own
//   `.pomade`, and never inside another listed folder or around one: each skill belongs to one
//   folder.

import { isAbsolute, posix, relative, sep } from "node:path";

import { isMap, parseDocument, stringify } from "yaml";

import { DEFAULT_SKILL_FOLDERS } from "../../shared/skills.ts";

export type Parsed<T> = { ok: true; value: T } | { ok: false; problem: string };

export const SKILL_FOLDERS_KEY = "skillFolders";

const STRINGIFY = { lineWidth: 0 } as const;

/** The skill folders `settings.yaml`'s text (`null`: no file) lists, or why they cannot be read. */
export function readSkillFolders(text: string | null): Parsed<string[]> {
  if (text === null) return { ok: true, value: [...DEFAULT_SKILL_FOLDERS] };
  const doc = parseDocument(text);
  const [error] = doc.errors;
  if (error) return { ok: false, problem: `it is not valid YAML (${error.message.split("\n")[0] ?? ""})` };
  if (doc.contents === null) return { ok: true, value: [...DEFAULT_SKILL_FOLDERS] };
  if (!isMap(doc.contents)) return { ok: false, problem: "it is not a mapping of keys to values" };
  const value = (doc.toJS() as Record<string, unknown>)[SKILL_FOLDERS_KEY];
  if (value === undefined || value === null) return { ok: true, value: [...DEFAULT_SKILL_FOLDERS] };
  if (!Array.isArray(value) || !value.every((f) => typeof f === "string" && f.trim() !== "")) {
    return { ok: false, problem: `its ${SKILL_FOLDERS_KEY} is not a list of folders` };
  }
  return { ok: true, value: value.map((f: string) => f.trim().replace(/\/+$/, "")) };
}

/** `settings.yaml`'s text (`null`: no file) listing `folders`; everything else in the file kept. */
export function settingsWithSkillFolders(text: string | null, folders: readonly string[]): string {
  if (text === null || text.trim() === "") return stringify({ [SKILL_FOLDERS_KEY]: [...folders] }, STRINGIFY);
  const doc = parseDocument(text);
  doc.set(SKILL_FOLDERS_KEY, doc.createNode([...folders]));
  return doc.toString(STRINGIFY);
}

export type FolderCheck = { ok: true; folder: string } | { ok: false; reason: string };

const isInside = (child: string, parent: string): boolean => child === parent || child.startsWith(`${parent}/`);

/** `input` as a listed folder: workspace-relative, POSIX, without `.` / `..` or a trailing `/`.
 *  An absolute path is taken when it lies in the workspace, as Pomade names it or with symlinks
 *  resolved (`roots`). */
export function normalizeFolder(input: string, roots: readonly string[]): FolderCheck {
  const raw = input.trim();
  if (raw === "" || /[\0\r\n]/.test(raw)) return { ok: false, reason: "It is not a folder path." };
  let rel = raw;
  if (isAbsolute(raw)) {
    const root = roots.find((r) => {
      const back = relative(r, raw);
      return back === "" || (!back.startsWith("..") && !isAbsolute(back));
    });
    if (root === undefined) return { ok: false, reason: "It is outside the workspace: the catalog reads folders inside it." };
    rel = relative(root, raw).split(sep).join("/");
  }
  const folder = posix.normalize(rel).replace(/\/+$/, "");
  if (folder === "." || folder === "") return { ok: false, reason: "That is the whole workspace: pick a folder inside it." };
  if (folder === ".." || folder.startsWith("../")) return { ok: false, reason: "It is outside the workspace: the catalog reads folders inside it." };
  if (folder.split("/")[0]?.toLowerCase() === ".pomade") return { ok: false, reason: "It is Pomade's own folder." };
  return { ok: true, folder };
}

export type ListCheck = { ok: true; folders: string[] } | { ok: false; folder: string; reason: string };

/** `next` as a list of folders, each normalized; the first folder that cannot be listed, and why. */
export function checkFolderList(next: readonly string[], roots: readonly string[]): ListCheck {
  const folders: string[] = [];
  for (const input of next) {
    const checked = normalizeFolder(input, roots);
    if (!checked.ok) return { ok: false, folder: input, reason: checked.reason };
    const { folder } = checked;
    for (const listed of folders) {
      if (listed === folder) return { ok: false, folder: input, reason: "It is listed already." };
      if (isInside(folder, listed)) return { ok: false, folder: input, reason: `It is inside ${listed}, which is read with its subfolders.` };
      if (isInside(listed, folder)) return { ok: false, folder: input, reason: `It holds ${listed}, which is listed: remove that one first.` };
    }
    folders.push(folder);
  }
  return { ok: true, folders };
}
