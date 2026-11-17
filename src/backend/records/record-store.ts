// The session records and the app settings on disk, `<workspace>/Apps/pomade-agents/` (DESIGN §4),
// mirrored in memory and kept in step with the disk (PLATFORM rule 8: the file is the truth).
//
// The backend writes these files itself rather than through the Host API's file methods
// (PLATFORM rule 3 allows a backend either): the records must be written whether or not Pomade's
// socket is up at that moment — the first run adopts every session the moment indexing ends, and
// a reconnecting backend keeps working — and one writer path keeps one set of guarantees. Pomade
// sees these writes as any external write, exactly as it sees a Host API write.
//
// Guarantees:
// - **Atomic.** A record is written to a temporary file beside it and renamed over it; a new
//   record is linked into place, so it never replaces a file that appeared meanwhile.
// - **One write at a time per file**, each starting from the file as it is on disk then: a change
//   is applied to what the disk holds, never to an older copy, so a hand edit made before it stays.
// - **Never over an unreadable file.** A record that is not valid YAML or not a session record is
//   held as a problem and refused for writes until someone fixes or deletes it.
// - **Re-read on change.** One recursive watch on the app's data folder re-reads a record or the
//   settings when they change on disk — a hand edit, a git pull — and says so. FSEvents may swallow
//   a second change to a file that changed moments before, so a file that changed is read once
//   more `RECHECK_MS` later, until a read finds it as it was.

import { watch, type FSWatcher } from "node:fs";
import { link, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";

import type { SessionRecord } from "../../shared/sessions.ts";
import { isRecordId, sameRecord } from "../sessions/rules.ts";
import { parseRecord, parseSettings, renderRecord, rewriteRecord, settingsWithAdoptedAt, type AppSettings, type Parsed } from "./record-file.ts";

export const SESSIONS_FOLDER = "sessions";
export const SETTINGS_FILE = "settings.yaml";

/** How long watch events gather before the files they name are read. */
const SETTLE_MS = 40;
/** How long after the watch fails it is set up again. */
const REWATCH_MS = 2000;
/** How long after a file changed it is read once more (FSEvents may swallow the next change). */
const RECHECK_MS = 500;
/** Records read at once at the start. */
const READ_BATCH = 32;

/** A record as the disk holds it: usable, or why it is not. */
export type HeldRecord = { record: SessionRecord; problem: null } | { record: null; problem: string };

/** Why a change could not be written. */
export class RecordError extends Error {
  /** `missing`: no record file; `unreadable`: a file the app cannot use. */
  readonly kind: "missing" | "unreadable";
  constructor(kind: "missing" | "unreadable", message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface RecordStoreOptions {
  /** `<workspace>/Apps/pomade-agents`. */
  dataDir: string;
  now: () => Date;
  log: (line: string) => void;
}

export interface RecordStore {
  /** The record of session `id`; `undefined` when it has no file. */
  get(id: string): HeldRecord | undefined;
  /** The app settings, or why `settings.yaml` cannot be read; a missing file is no settings yet. */
  settings(): Parsed<AppSettings>;
  /** Write a new record, unless a file for the session is there already (then that file is read). */
  create(record: SessionRecord): Promise<void>;
  /** Apply `change` to the record as the disk holds it now and write the result (when it differs).
   *  Rejects with `RecordError` when the file is missing or unreadable. */
  update(id: string, change: (record: SessionRecord) => SessionRecord): Promise<SessionRecord>;
  /** Write the first run's time into `settings.yaml`, unless the file holds one already. Rejects
   *  when the file cannot be read. */
  adopt(adoptedAt: string): Promise<void>;
  /** Called after a record (`id`) or the settings (`null`) changed in memory; returns an unsubscribe function. */
  onChange(listener: (id: string | null) => void): () => void;
  /** Stop watching; resolves once the writes in flight are done. */
  stop(): Promise<void>;
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const code = (err: unknown): string | undefined => (err as NodeJS.ErrnoException | null)?.code;

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if (code(err) === "ENOENT") return null;
    throw err;
  }
}

let tmpCount = 0;
const tmpPathFor = (folder: string, name: string): string => join(folder, `.${name}.${process.pid}.${++tmpCount}.tmp`);

/** Write `text` to `path` only if nothing is there; false when something is. */
async function writeNew(folder: string, name: string, text: string): Promise<boolean> {
  await mkdir(folder, { recursive: true });
  const tmp = tmpPathFor(folder, name);
  await writeFile(tmp, text, "utf8");
  try {
    await link(tmp, join(folder, name));
    return true;
  } catch (err) {
    if (code(err) === "EEXIST") return false;
    throw err;
  } finally {
    await unlink(tmp);
  }
}

async function replace(folder: string, name: string, text: string): Promise<void> {
  const tmp = tmpPathFor(folder, name);
  await writeFile(tmp, text, "utf8");
  try {
    await rename(tmp, join(folder, name));
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

/** The session a path under the data folder names (`sessions/<id>.yaml`), if any. */
function recordIdAt(relative: string): string | null {
  const prefix = SESSIONS_FOLDER + sep;
  if (!relative.startsWith(prefix) || !relative.endsWith(".yaml")) return null;
  const id = relative.slice(prefix.length, -".yaml".length);
  return isRecordId(id) ? id : null;
}

export async function openRecordStore(options: RecordStoreOptions): Promise<RecordStore> {
  const { dataDir, now, log } = options;
  const sessionsDir = join(dataDir, SESSIONS_FOLDER);
  const fileOf = (id: string): string => `${id}.yaml`;

  const held = new Map<string, HeldRecord>();
  /** The text each held record was read from or written as: an event for the same text is no change. */
  const texts = new Map<string, string>();
  let settings: Parsed<AppSettings> = { ok: true, value: { adoptedAt: null } };
  let settingsText: string | null = null;
  const listeners = new Set<(id: string | null) => void>();
  const emit = (id: string | null): void => {
    for (const listener of listeners) listener(id);
  };

  /** Tasks on one file run one after another. */
  const chains = new Map<string, Promise<unknown>>();
  const queue = <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const run = (chains.get(key) ?? Promise.resolve()).then(task);
    const settled = run.catch(() => undefined);
    chains.set(key, settled);
    void settled.then(() => {
      if (chains.get(key) === settled) chains.delete(key);
    });
    return run;
  };
  const SETTINGS_KEY = "\0settings";

  // ── Reading ──────────────────────────────────────────────────────────────

  const rechecks = new Map<string, NodeJS.Timeout>();
  let stopped = false;
  /** Read `key`'s file (a record id, or the settings) again in a moment. */
  const recheckLater = (key: string): void => {
    if (stopped) return;
    clearTimeout(rechecks.get(key));
    rechecks.set(
      key,
      setTimeout(() => {
        rechecks.delete(key);
        reread(key).catch((err: unknown) => log(`records: could not read ${dataDir}: ${message(err)}`));
      }, RECHECK_MS),
    );
  };

  /** Take the file's text as the record; says whether anything changed. */
  const take = (id: string, text: string | null): boolean => {
    if (text === null) {
      texts.delete(id);
      if (!held.delete(id)) return false;
      recheckLater(id);
      return true;
    }
    if (texts.get(id) === text) return false;
    texts.set(id, text);
    recheckLater(id);
    const parsed = parseRecord(id, text);
    held.set(id, parsed.ok ? { record: parsed.value, problem: null } : { record: null, problem: parsed.problem });
    if (!parsed.ok) log(`records: ${join(sessionsDir, fileOf(id))} cannot be used: ${parsed.problem}`);
    return true;
  };

  const load = async (id: string): Promise<void> => {
    if (take(id, await readText(join(sessionsDir, fileOf(id))))) emit(id);
  };

  const reload = (id: string): Promise<void> => queue(id, () => load(id));

  const reloadSettings = (): Promise<void> =>
    queue(SETTINGS_KEY, async () => {
      const text = await readText(join(dataDir, SETTINGS_FILE));
      if (text === settingsText) return;
      settingsText = text;
      recheckLater(SETTINGS_KEY);
      settings = text === null ? { ok: true, value: { adoptedAt: null } } : parseSettings(text);
      if (!settings.ok) log(`records: ${join(dataDir, SETTINGS_FILE)} cannot be used: ${settings.problem}`);
      emit(null);
    });

  const reread = (key: string): Promise<void> => (key === SETTINGS_KEY ? reloadSettings() : reload(key));

  const reloadAll = async (): Promise<void> => {
    let names: string[] = [];
    try {
      names = await readdir(sessionsDir);
    } catch (err) {
      if (code(err) !== "ENOENT") throw err;
    }
    const ids = new Set(held.keys());
    for (const name of names) {
      const id = recordIdAt(SESSIONS_FOLDER + sep + name);
      if (id !== null) ids.add(id);
    }
    const all = [...ids];
    for (let i = 0; i < all.length; i += READ_BATCH) await Promise.all(all.slice(i, i + READ_BATCH).map(reload));
    await reloadSettings();
  };

  // ── Watching ─────────────────────────────────────────────────────────────

  let watcher: FSWatcher | null = null;
  let rewatchTimer: NodeJS.Timeout | null = null;
  let settleTimer: NodeJS.Timeout | null = null;
  const pending = new Set<string>();
  let pendingAll = false;
  let pendingSettings = false;

  const settle = (): void => {
    settleTimer ??= setTimeout(() => {
      settleTimer = null;
      const work: Promise<void>[] = [];
      if (pendingAll) work.push(reloadAll());
      else {
        for (const id of pending) work.push(reload(id));
        if (pendingSettings) work.push(reloadSettings());
      }
      pending.clear();
      pendingAll = false;
      pendingSettings = false;
      void Promise.all(work).catch((err: unknown) => log(`records: could not read ${dataDir}: ${message(err)}`));
    }, SETTLE_MS);
  };

  const onEvent = (filename: string | null): void => {
    if (filename === null || filename === "" || filename === SESSIONS_FOLDER) pendingAll = true;
    else if (filename === SETTINGS_FILE) pendingSettings = true;
    else {
      const id = recordIdAt(filename);
      if (id === null) return;
      pending.add(id);
    }
    settle();
  };

  const startWatching = async (): Promise<void> => {
    await mkdir(sessionsDir, { recursive: true });
    if (stopped) return;
    const next = watch(dataDir, { recursive: true }, (_event, filename) => onEvent(filename));
    next.on("error", (err) => {
      log(`records: watching ${dataDir} failed (${err.message}); watching again in ${REWATCH_MS} ms`);
      next.close();
      if (watcher === next) watcher = null;
      scheduleRewatch();
    });
    watcher = next;
  };

  const scheduleRewatch = (): void => {
    if (stopped) return;
    rewatchTimer ??= setTimeout(() => {
      rewatchTimer = null;
      startWatching()
        .then(reloadAll)
        .catch((err: unknown) => {
          log(`records: cannot watch ${dataDir}: ${message(err)}`);
          scheduleRewatch();
        });
    }, REWATCH_MS);
  };

  try {
    await startWatching();
  } catch (err) {
    log(`records: cannot watch ${dataDir}: ${message(err)}; trying again in ${REWATCH_MS} ms`);
    scheduleRewatch();
  }
  await reloadAll();

  // ── Writing ──────────────────────────────────────────────────────────────

  return {
    get: (id) => held.get(id),
    settings: () => settings,

    create(record) {
      const { id } = record;
      return queue(id, async () => {
        const text = renderRecord({ ...record, updated: now().toISOString() });
        if (!(await writeNew(sessionsDir, fileOf(id), text))) {
          await load(id);
          return;
        }
        if (take(id, text)) emit(id);
      });
    },

    update(id, change) {
      return queue(id, async () => {
        const path = join(sessionsDir, fileOf(id));
        const text = await readText(path);
        if (text === null) {
          if (take(id, null)) emit(id);
          throw new RecordError("missing", `Session ${id} has no record file (${path})`);
        }
        const parsed = parseRecord(id, text);
        if (!parsed.ok) {
          if (take(id, text)) emit(id);
          throw new RecordError("unreadable", `The record ${path} cannot be used: ${parsed.problem}. Fix or delete the file.`);
        }
        const next = change(parsed.value);
        if (sameRecord(next, parsed.value)) {
          if (take(id, text)) emit(id);
          return parsed.value;
        }
        const written: SessionRecord = { ...next, updated: now().toISOString() };
        const nextText = rewriteRecord(text, written);
        await replace(sessionsDir, fileOf(id), nextText);
        if (take(id, nextText)) emit(id);
        return written;
      });
    },

    adopt(adoptedAt) {
      return queue(SETTINGS_KEY, async () => {
        const text = await readText(join(dataDir, SETTINGS_FILE));
        if (text === null) {
          await writeNew(dataDir, SETTINGS_FILE, settingsWithAdoptedAt(null, adoptedAt));
          return;
        }
        const parsed = parseSettings(text);
        if (!parsed.ok) throw new Error(`${join(dataDir, SETTINGS_FILE)} cannot be used: ${parsed.problem}`);
        if (parsed.value.adoptedAt === null) await replace(dataDir, SETTINGS_FILE, settingsWithAdoptedAt(text, adoptedAt));
      }).then(reloadSettings);
    },

    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async stop() {
      stopped = true;
      for (const timer of [rewatchTimer, settleTimer, ...rechecks.values()]) if (timer) clearTimeout(timer);
      watcher?.close();
      watcher = null;
      await Promise.all(chains.values());
    },
  };
}
