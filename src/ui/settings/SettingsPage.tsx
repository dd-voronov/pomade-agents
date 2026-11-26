// The app's Settings page (route `settings`, ARCHITECTURE §3.8): the skill folders the skills catalog
// reads, each with its skill count and the links that point into it; **Add folder…** through
// Pomade's folder picker; **Remove**, which first warns — naming the agents — when links depend on
// the folder, and keeps the links. Every change offers Undo.

import { useState, type ReactElement } from "react";
import { HostError, type HostClient } from "pomade-kit/sdk";

import type { SkillFolder } from "../../shared/skills.ts";
import { FolderIcon, PlusIcon, TrashIcon, WarningIcon } from "../core/icons.tsx";
import { Toast } from "../sessions/Toast.tsx";
import { useToast } from "../sessions/useToast.ts";
import { addedText, dependText, linksText, plural, refusedText, removedText } from "./settings-copy.ts";
import styles from "./SettingsPage.module.css";
import { useSkillsCatalog } from "./useSkillsCatalog.ts";

/** Why a change did not go through, in plain words; the backend's own message is the hover text. */
function failure(err: unknown): { text: string; title: string } {
  const message = err instanceof Error ? err.message : String(err);
  const code = err instanceof HostError ? err.code : null;
  const cause =
    code === "not-ready"
      ? message
      : code === "io-error"
        ? "The settings file could not be written."
        : code === "app-absent" || code === "app-not-responding"
          ? "The Agents backend is not answering."
          : "Something went wrong.";
  return { text: `The skill folders were not changed. ${cause}`, title: message };
}

export function SettingsPage({ host }: { host: HostClient }): ReactElement {
  const { catalog, setFolders } = useSkillsCatalog(host);
  const { toast, show } = useToast();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const folders = catalog?.folders ?? [];
  const off = catalog?.foldersOff ?? null;
  const locked = catalog === null || off !== null || busy;

  /** Write `next`; on success the toast says `done(...)` and Undo writes `before` back. */
  const change = async (next: string[], before: string[], done: (skills: number) => string): Promise<void> => {
    setBusy(true);
    try {
      const result = await setFolders(next);
      if (!result.ok) {
        show(refusedText(result.folder, result.reason), null);
        return;
      }
      const added = next.find((f) => !before.includes(f));
      const skills = result.catalog.folders.find((f) => f.path === added)?.skills ?? 0;
      show(done(skills), () => {
        setFolders(before).then(
          (undone) => {
            if (!undone.ok) show(refusedText(undone.folder, undone.reason), null);
          },
          (err: unknown) => {
            const { text, title } = failure(err);
            show(text, null, title);
          },
        );
      });
    } catch (err) {
      const { text, title } = failure(err);
      show(text, null, title);
    } finally {
      setBusy(false);
    }
  };

  const add = async (): Promise<void> => {
    let picked: string | null;
    try {
      picked = (await host.files.pickFolder({})).path;
    } catch (err) {
      const { text, title } = failure(err);
      show(text, null, title);
      return;
    }
    if (picked === null) return;
    const path = picked;
    const before = folders.map((f) => f.path);
    await change([...before, path], before, (skills) => addedText(path, skills));
  };

  const remove = async (path: string): Promise<void> => {
    setConfirming(null);
    const before = folders.map((f) => f.path);
    await change(
      before.filter((f) => f !== path),
      before,
      () => removedText(path),
    );
  };

  const askRemove = (folder: SkillFolder): void => {
    if (folder.links > 0) setConfirming(folder.path);
    else void remove(folder.path);
  };

  return (
    <div className={styles.page} data-testid="settings">
      <header className={styles.head}>
        <h1 className={styles.title}>Settings</h1>
        <div className={styles.sub}>
          The Agents app’s own settings, in <code>Apps/pomade-agents/settings.yaml</code>
        </div>
      </header>
      <div className={styles.body}>
        <div className={styles.content}>
          {off !== null && (
            <div className={`${styles.notice} ${styles.offNotice}`} data-testid="folders-off">
              <WarningIcon size={14} />
              <div>{off}</div>
            </div>
          )}
          <section data-testid="skill-folders">
            <div className={styles.secHead}>
              <h2>Skill folders</h2>
              <button type="button" className={styles.btn} disabled={locked} data-testid="add-folder" onClick={() => void add()}>
                <PlusIcon size={14} />
                Add folder…
              </button>
            </div>
            <p className={styles.hint}>
              The folders the skills catalog reads: each agent’s Skills tab groups its links by them, and Add skill offers what they hold. Paths are relative to
              the workspace. An agent’s own <code>skills/</code> is always read.
            </p>
            <div className={styles.block}>
              {catalog === null ? (
                <p className={styles.none}>Reading the skill folders…</p>
              ) : folders.length === 0 ? (
                <p className={styles.none} data-testid="no-folders">
                  No skill folders: Add skill has nothing to offer.
                </p>
              ) : (
                folders.map((folder) => (
                  <FolderRow
                    key={folder.path}
                    folder={folder}
                    locked={locked}
                    confirming={confirming === folder.path}
                    onRemove={() => askRemove(folder)}
                    onConfirm={() => void remove(folder.path)}
                    onCancel={() => setConfirming(null)}
                  />
                ))
              )}
            </div>
          </section>
        </div>
      </div>
      {toast !== null && <Toast key={toast.key} toast={toast} />}
    </div>
  );
}

interface FolderRowProps {
  folder: SkillFolder;
  locked: boolean;
  confirming: boolean;
  onRemove: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

function FolderRow({ folder, locked, confirming, onRemove, onConfirm, onCancel }: FolderRowProps): ReactElement {
  const missing = folder.state === "missing";
  return (
    <div className={styles.item} data-testid="skill-folder" data-path={folder.path}>
      <div className={styles.row}>
        <span className={styles.ico}>
          <FolderIcon size={14} />
        </span>
        <span className={styles.path}>
          <code title={folder.path}>{folder.path}</code>
          {folder.nested && <span className={styles.faint}>and its subfolders</span>}
        </span>
        <span className={styles.count} data-testid="folder-skills">
          {missing ? (
            <span className={styles.chip} title="Nothing is at this path in the workspace: the catalog finds no skills here.">
              Not found
            </span>
          ) : (
            plural(folder.skills, "skill")
          )}
        </span>
        <span className={styles.links} title={folder.agents.join(", ")} data-testid="folder-links">
          {linksText(folder)}
        </span>
        <button type="button" className={styles.btn} disabled={locked || confirming} data-testid="remove-folder" onClick={onRemove}>
          Remove
        </button>
      </div>
      {confirming && (
        <div className={`${styles.notice} ${styles.confirm}`} data-testid="remove-warning">
          <WarningIcon size={14} />
          <div>
            <b>{dependText(folder)}</b> ({folder.agents.join(", ")}). They stay and keep working; Add skill stops offering its skills, and the Skills tab shows
            them as “not in Skill folders”.
            <div className={styles.actions}>
              <button type="button" className={`${styles.btn} ${styles.danger}`} data-testid="confirm-remove" onClick={onConfirm}>
                <TrashIcon size={14} />
                Remove from the list
              </button>
              <button type="button" className={styles.btn} data-testid="cancel-remove" onClick={onCancel}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
