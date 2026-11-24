// The app's own settings the backend follows (DESIGN §3.8, §4): the list of skill folders in
// `settings.yaml`, read from the record store's copy of the file — which follows the file on disk —
// and written through it, one settings write at a time.
//
// - **Unusable file** (not YAML, not a mapping, a malformed `adoptedAt` or `skillFolders`): the
//   catalog reads the default folders, `foldersOff` says why, and nothing is written over the file.
// - **No workspace, or no app data folder**: no list can be kept; `foldersOff` says why.
// - **A new folder** must be a folder now, inside the workspace also by its real path; a folder
//   already listed may be gone (it shows as missing).

import { realpath, stat } from "node:fs/promises";
import { join } from "node:path";

import { DEFAULT_SKILL_FOLDERS } from "../../shared/skills.ts";
import type { RecordStore } from "../records/record-store.ts";
import { checkFolderList, readSkillFolders, settingsWithSkillFolders, type ListCheck } from "./skill-folders.ts";

export interface FolderList {
  /** Workspace-relative, in the file's order. */
  folders: string[];
  /** Why the list cannot be changed now; `null` while it can. */
  foldersOff: string | null;
}

export type SetFoldersResult = { ok: true } | { ok: false; folder: string; reason: string };

export interface SkillFolderSettings {
  folders(): FolderList;
  /** Write `next` as the list, when every folder in it can be listed. */
  set(next: readonly string[]): Promise<SetFoldersResult>;
  /** Called after the list or `foldersOff` changed; returns an unsubscribe function. */
  onChange(listener: () => void): () => void;
  stop(): void;
}

export interface SkillFolderSettingsOptions {
  /** The app data; `null` when none is kept (`off` says why). */
  store: Pick<RecordStore, "settings" | "settingsText" | "rewriteSettings" | "onChange"> | null;
  off: string;
  /** The workspace as Pomade names it, and with symlinks resolved; `null` without one. */
  workspace: string | null;
  workspaceReal: string | null;
  /** `settings.yaml` as messages name it (workspace-relative). */
  settingsPath: string | null;
}

const inside = (child: string, parent: string): boolean => child === parent || child.startsWith(`${parent}/`);

export function startSkillFolderSettings(options: SkillFolderSettingsOptions): SkillFolderSettings {
  const { store, off, workspace, workspaceReal, settingsPath } = options;
  const roots = [workspace, workspaceReal].filter((r): r is string => r !== null);
  const listeners = new Set<() => void>();

  const current = (): FolderList => {
    if (store === null || workspace === null) return { folders: [...DEFAULT_SKILL_FOLDERS], foldersOff: off };
    const read = readSkillFolders(store.settingsText());
    const whole = store.settings();
    const unusable = (problem: string): string => `${settingsPath ?? "settings.yaml"} cannot be used: ${problem}. Fix or delete the file.`;
    if (!read.ok) return { folders: [...DEFAULT_SKILL_FOLDERS], foldersOff: unusable(read.problem) };
    if (!whole.ok) return { folders: read.value, foldersOff: unusable(whole.problem) };
    return { folders: read.value, foldersOff: null };
  };

  let last = JSON.stringify(current());
  const unsubscribe =
    store?.onChange((id) => {
      if (id !== null) return;
      const text = JSON.stringify(current());
      if (text === last) return;
      last = text;
      for (const listener of listeners) listener();
    }) ?? (() => undefined);

  /** Why a folder new to the list cannot be listed; `null` when it can. */
  const refuseNew = async (folder: string): Promise<string | null> => {
    if (workspace === null) return off;
    const abs = join(workspace, folder);
    try {
      if (!(await stat(abs)).isDirectory()) return "It is not a folder.";
    } catch {
      return "There is no such folder in the workspace.";
    }
    const real = await realpath(abs);
    const realRoot = workspaceReal ?? workspace;
    if (!inside(real, realRoot)) return "It leads outside the workspace (a symlink): the catalog reads folders inside it.";
    return null;
  };

  return {
    folders: current,

    async set(next) {
      if (store === null || workspace === null) return { ok: false, folder: "", reason: off };
      const checked: ListCheck = checkFolderList(next, roots);
      if (!checked.ok) return checked;
      const before = current().folders;
      for (const folder of checked.folders) {
        if (before.includes(folder)) continue;
        const reason = await refuseNew(folder);
        if (reason !== null) return { ok: false, folder, reason };
      }
      await store.rewriteSettings((text) => {
        const read = readSkillFolders(text);
        if (!read.ok) throw new Error(`${settingsPath ?? "settings.yaml"} cannot be used: ${read.problem}. Fix or delete the file.`);
        return settingsWithSkillFolders(text, checked.folders);
      });
      return { ok: true };
    },

    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    stop() {
      unsubscribe();
    },
  };
}
