// The app's files on disk, `<workspace>/Apps/pomade-agents/` (DESIGN §3.2, §4) — the session
// records, the agent profiles and the app settings — mirrored in memory and kept in step with the
// disk (PLATFORM rule 8: the file is the truth). Records and profiles are two sets of files kept by
// one machinery: every guarantee below holds for both.
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
// - **Never over an unreadable file.** A record or profile that is not valid YAML or not of its
//   kind is held as a problem and refused for writes until someone fixes or deletes it.
// - **Re-read on change.** One recursive watch on the app's data folder re-reads a record, a
//   profile or the settings when they change on disk — a hand edit, a git pull — and says so. FSEvents may swallow
//   a second change to a file that changed moments before, so a file that changed is read once
//   more `RECHECK_MS` later, until a read finds it as it was.

import { watch, type FSWatcher } from "node:fs";
import { link, mkdir, readFile, readdir, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, sep } from "node:path";

import type { AgentProfile } from "../../shared/roster.ts";
import type { SessionRecord } from "../../shared/sessions.ts";
import { isRecordId, sameRecord } from "../sessions/rules.ts";
import {
  parseProfile,
  parseRecord,
  parseSettings,
  renderProfile,
  renderRecord,
  rewriteProfile,
  rewriteRecord,
  settingsWithAdoptedAt,
  type AppSettings,
  type Parsed,
} from "./record-file.ts";

export const SESSIONS_FOLDER = "sessions";
export const AGENTS_FOLDER = "agents";
export const PROFILE_FILE = "agent.yaml";
export const SETTINGS_FILE = "settings.yaml";

/** How long watch events gather before the files they name are read. */
const SETTLE_MS = 40;
/** How long after the watch fails it is set up again. */
const REWATCH_MS = 2000;
/** How long after a file changed it is read once more (FSEvents may swallow the next change). */
const RECHECK_MS = 500;
/** Files read at once at the start. */
const READ_BATCH = 32;

/** A file as the disk holds it: usable, or why it is not. */
export type Held<T> = { value: T; problem: null } | { value: null; problem: string };
export type HeldRecord = Held<SessionRecord>;
export type HeldProfile = Held<AgentProfile>;

/** Why a change could not be written. */
export class RecordError extends Error {
  /** `missing`: no file; `unreadable`: a file the app cannot use. */
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

/** One set of files of a kind, each named by an id. */
export interface FileSet<T> {
  /** The file of `id`; `undefined` when there is none. */
  get(id: string): Held<T> | undefined;
  /** Every id with a file, usable or not. */
  ids(): string[];
  /** The id's file as last read or written; `null` when there is none. */
  text(id: string): string | null;
  /** Write a new file, unless one for the id is there already (then that file is read). */
  create(value: T): Promise<void>;
  /** Apply `change` to the file's value as the disk holds it now and write the result (when it
   *  differs). Rejects with `RecordError` when the file is missing or unreadable. */
  update(id: string, change: (value: T) => T): Promise<T>;
  /** Delete the id's file, and the folder of its own that held it when nothing else is left there;
   *  resolves the text it held (`null`: it was gone already, which is no error). */
  remove(id: string): Promise<string | null>;
  /** Put back the text `remove` answered: written new, or over the file that is there when that holds
   *  other text. Rejects with `RecordError` (`unreadable`) for a text that is not a usable file of the id. */
  restore(id: string, text: string): Promise<void>;
  /** Called after a file changed in memory; returns an unsubscribe function. */
  onChange(listener: (id: string) => void): () => void;
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
  /** The agent profiles, `agents/<id>/agent.yaml`. */
  readonly profiles: FileSet<AgentProfile>;
  /** Stop watching; resolves once the writes in flight are done. */
  stop(): Promise<void>;
  /** `settings.yaml`'s text as last read; `null` when there is no file. */
  settingsText(): string | null;
  /** Write `rewrite(text)` as `settings.yaml` — `text` being the file as the disk holds it now,
   *  `null` when absent — one write at a time with the other settings writes; resolves once the
   *  settings are read again. Rejects with `RecordError` (`unreadable`) when the file cannot be
   *  used, and with what `rewrite` throws (nothing is written then). */
  rewriteSettings(rewrite: (text: string | null) => string): Promise<void>;
}

/** How one kind of file is named, read and written. */
interface FileKind<T extends { id: string }> {
  /** Its folder under the data folder. */
  folder: string;
  /** What one file is, and whose it is, for messages. */
  what: string;
  owner: string;
  /** The file of `id`, relative to the kind's folder. */
  fileOf(id: string): string;
  /** The id a path relative to the kind's folder names, if it is one of its files. */
  idAt(relative: string): string | null;
  /** The ids whose files are in the kind's folder (absolute); throws `ENOENT` when it is missing. */
  scan(folder: string): Promise<string[]>;
  parse(id: string, text: string): Parsed<T>;
  render(value: T): string;
  rewrite(text: string, next: T): string;
  same(a: T, b: T): boolean;
  /** The value as written at `at`. */
  stamp(value: T, at: string): T;
}

const RECORDS: FileKind<SessionRecord> = {
  folder: SESSIONS_FOLDER,
  what: "record",
  owner: "Session",
  fileOf: (id) => `${id}.yaml`,
  idAt: (relative) => {
    if (relative.includes(sep) || !relative.endsWith(".yaml")) return null;
    const id = relative.slice(0, -".yaml".length);
    return isRecordId(id) ? id : null;
  },
  scan: async (folder) => (await readdir(folder)).flatMap((name) => RECORDS.idAt(name) ?? []),
  parse: parseRecord,
  render: renderRecord,
  rewrite: rewriteRecord,
  same: sameRecord,
  stamp: (record, at) => ({ ...record, updated: at }),
};

const PROFILES: FileKind<AgentProfile> = {
  folder: AGENTS_FOLDER,
  what: "profile",
  owner: "Agent",
  fileOf: (id) => join(id, PROFILE_FILE),
  idAt: (relative) => {
    const parts = relative.split(sep);
    return parts.length === 2 && parts[1] === PROFILE_FILE && isRecordId(parts[0] ?? "") ? (parts[0] ?? null) : null;
  },
  scan: async (folder) => {
    const ids: string[] = [];
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (!entry.isDirectory() || !isRecordId(entry.name)) continue;
      try {
        await readFile(join(folder, entry.name, PROFILE_FILE));
        ids.push(entry.name);
      } catch (err) {
        if (code(err) !== "ENOENT" && code(err) !== "ENOTDIR") throw err;
      }
    }
    return ids;
  },
  parse: parseProfile,
  render: renderProfile,
  rewrite: rewriteProfile,
  same: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  stamp: (profile) => profile,
};

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
const tmpPathFor = (path: string): string => join(dirname(path), `.${basename(path)}.${process.pid}.${++tmpCount}.tmp`);

/** Write `text` to `path` only if nothing is there; false when something is. */
async function writeNew(path: string, text: string): Promise<boolean> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = tmpPathFor(path);
  try {
    await writeFile(tmp, text, "utf8");
  } catch (err) {
    throw writeFailure(path, err);
  }
  try {
    await link(tmp, path);
    return true;
  } catch (err) {
    if (code(err) === "EEXIST") return false;
    throw writeFailure(path, err);
  } finally {
    await unlink(tmp);
  }
}

/** A failed write as the caller reads it: the file it was for, never the temporary one, and the
 *  system's reason without the path it names (`EACCES: permission denied`). */
export function writeFailure(path: string, err: unknown): Error {
  const reason = message(err).split(", ")[0] ?? "";
  return new Error(`${path} could not be written (${reason})`);
}

async function replace(path: string, text: string): Promise<void> {
  const tmp = tmpPathFor(path);
  try {
    await writeFile(tmp, text, "utf8");
  } catch (err) {
    throw writeFailure(path, err);
  }
  try {
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw writeFailure(path, err);
  }
}

/** Tasks on one file run one after another. */
type Queue = <T>(key: string, task: () => Promise<T>) => Promise<T>;

function createQueue(chains: Map<string, Promise<unknown>>): Queue {
  return (key, task) => {
    const run = (chains.get(key) ?? Promise.resolve()).then(task);
    const settled = run.catch(() => undefined);
    chains.set(key, settled);
    void settled.then(() => {
      if (chains.get(key) === settled) chains.delete(key);
    });
    return run;
  };
}

interface Shared {
  dataDir: string;
  now: () => Date;
  log: (line: string) => void;
  queue: Queue;
  /** Read the file `key` names once more in a moment. */
  recheckLater: (key: string, reread: () => Promise<void>) => void;
}

/** A kind's files, mirrored in memory. */
interface Mirror<T> extends FileSet<T> {
  reload(id: string): Promise<void>;
  reloadAll(): Promise<void>;
}

function openFileSet<T extends { id: string }>(kind: FileKind<T>, shared: Shared, emit: (id: string) => void): Mirror<T> {
  const { dataDir, now, log, queue, recheckLater } = shared;
  const folder = join(dataDir, kind.folder);
  const pathOf = (id: string): string => join(folder, kind.fileOf(id));
  const keyOf = (id: string): string => `${kind.folder}/${id}`;
  const held = new Map<string, Held<T>>();
  /** The text each held file was read from or written as: an event for the same text is no change. */
  const texts = new Map<string, string>();
  const listeners = new Set<(id: string) => void>();
  const changed = (id: string): void => {
    emit(id);
    for (const listener of listeners) listener(id);
  };

  /** Take the file's text as the value; says whether anything changed. */
  const take = (id: string, text: string | null): boolean => {
    if (text === null) {
      texts.delete(id);
      if (!held.delete(id)) return false;
      recheckLater(keyOf(id), () => reload(id));
      return true;
    }
    if (texts.get(id) === text) return false;
    texts.set(id, text);
    recheckLater(keyOf(id), () => reload(id));
    const parsed = kind.parse(id, text);
    held.set(id, parsed.ok ? { value: parsed.value, problem: null } : { value: null, problem: parsed.problem });
    if (!parsed.ok) log(`records: ${pathOf(id)} cannot be used: ${parsed.problem}`);
    return true;
  };

  const load = async (id: string): Promise<void> => {
    if (take(id, await readText(pathOf(id)))) changed(id);
  };
  const reload = (id: string): Promise<void> => queue(keyOf(id), () => load(id));

  return {
    reload,
    async reloadAll() {
      let found: string[] = [];
      try {
        found = await kind.scan(folder);
      } catch (err) {
        if (code(err) !== "ENOENT") throw err;
      }
      const all = [...new Set([...held.keys(), ...found])];
      for (let i = 0; i < all.length; i += READ_BATCH) await Promise.all(all.slice(i, i + READ_BATCH).map(reload));
    },

    get: (id) => held.get(id),
    ids: () => [...held.keys()],
    text: (id) => texts.get(id) ?? null,

    create(value) {
      const { id } = value;
      return queue(keyOf(id), async () => {
        const text = kind.render(kind.stamp(value, now().toISOString()));
        if (!(await writeNew(pathOf(id), text))) {
          await load(id);
          return;
        }
        if (take(id, text)) changed(id);
      });
    },

    update(id, change) {
      return queue(keyOf(id), async () => {
        const path = pathOf(id);
        const text = await readText(path);
        if (text === null) {
          if (take(id, null)) changed(id);
          throw new RecordError("missing", `${kind.owner} ${id} has no ${kind.what} file (${path})`);
        }
        const parsed = kind.parse(id, text);
        if (!parsed.ok) {
          if (take(id, text)) changed(id);
          throw new RecordError("unreadable", `The ${kind.what} ${path} cannot be used: ${parsed.problem}. Fix or delete the file.`);
        }
        const next = change(parsed.value);
        if (kind.same(next, parsed.value)) {
          if (take(id, text)) changed(id);
          return parsed.value;
        }
        const written = kind.stamp(next, now().toISOString());
        const nextText = kind.rewrite(text, written);
        await replace(path, nextText);
        if (take(id, nextText)) changed(id);
        return written;
      });
    },

    remove(id) {
      return queue(keyOf(id), async () => {
        const path = pathOf(id);
        const text = await readText(path);
        try {
          await unlink(path);
        } catch (err) {
          if (code(err) !== "ENOENT") throw new Error(`${path} could not be removed (${message(err).split(", ")[0] ?? ""})`);
        }
        const own = dirname(path);
        // A folder that still holds something (another file of the id's) stays.
        if (own !== folder) await rmdir(own).catch(() => undefined);
        if (take(id, null)) changed(id);
        return text;
      });
    },

    restore(id, text) {
      return queue(keyOf(id), async () => {
        const path = pathOf(id);
        const parsed = kind.parse(id, text);
        if (!parsed.ok) throw new RecordError("unreadable", `The text to restore as ${path} cannot be used: ${parsed.problem}`);
        await mkdir(dirname(path), { recursive: true });
        if (!(await writeNew(path, text)) && (await readText(path)) !== text) await replace(path, text);
        if (take(id, text)) changed(id);
      });
    },

    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export async function openRecordStore(options: RecordStoreOptions): Promise<RecordStore> {
  const { dataDir, log } = options;
  const sessionsDir = join(dataDir, SESSIONS_FOLDER);

  const listeners = new Set<(id: string | null) => void>();
  const emit = (id: string | null): void => {
    for (const listener of listeners) listener(id);
  };

  const chains = new Map<string, Promise<unknown>>();
  const queue = createQueue(chains);
  const SETTINGS_KEY = "\0settings";

  const rechecks = new Map<string, NodeJS.Timeout>();
  let stopped = false;
  const recheckLater = (key: string, reread: () => Promise<void>): void => {
    if (stopped) return;
    clearTimeout(rechecks.get(key));
    rechecks.set(
      key,
      setTimeout(() => {
        rechecks.delete(key);
        reread().catch((err: unknown) => log(`records: could not read ${dataDir}: ${message(err)}`));
      }, RECHECK_MS),
    );
  };

  const shared: Shared = { dataDir, now: options.now, log, queue, recheckLater };
  const records = openFileSet(RECORDS, shared, emit);
  const profiles = openFileSet(PROFILES, shared, () => undefined);

  // ── Settings ─────────────────────────────────────────────────────────────

  let settings: Parsed<AppSettings> = { ok: true, value: { adoptedAt: null } };
  let settingsText: string | null = null;
  const reloadSettings = (): Promise<void> =>
    queue(SETTINGS_KEY, async () => {
      const text = await readText(join(dataDir, SETTINGS_FILE));
      if (text === settingsText) return;
      settingsText = text;
      recheckLater(SETTINGS_KEY, reloadSettings);
      settings = text === null ? { ok: true, value: { adoptedAt: null } } : parseSettings(text);
      if (!settings.ok) log(`records: ${join(dataDir, SETTINGS_FILE)} cannot be used: ${settings.problem}`);
      emit(null);
    });

  const reloadAll = async (): Promise<void> => {
    await Promise.all([records.reloadAll(), profiles.reloadAll()]);
    await reloadSettings();
  };

  // ── Watching ─────────────────────────────────────────────────────────────

  let watcher: FSWatcher | null = null;
  let rewatchTimer: NodeJS.Timeout | null = null;
  let settleTimer: NodeJS.Timeout | null = null;
  /** What the gathered events name: everything (`null`), or ids per set and the settings. */
  let pending: { records: Set<string>; profiles: Set<string>; allRecords: boolean; allProfiles: boolean; settings: boolean } | null = null;
  const nothingPending = (): NonNullable<typeof pending> => ({ records: new Set(), profiles: new Set(), allRecords: false, allProfiles: false, settings: false });
  let everything = false;

  const settle = (): void => {
    settleTimer ??= setTimeout(() => {
      settleTimer = null;
      const work: Promise<void>[] = [];
      const p = pending ?? nothingPending();
      if (everything) work.push(reloadAll());
      else {
        if (p.allRecords) work.push(records.reloadAll());
        else for (const id of p.records) work.push(records.reload(id));
        if (p.allProfiles) work.push(profiles.reloadAll());
        else for (const id of p.profiles) work.push(profiles.reload(id));
        if (p.settings) work.push(reloadSettings());
      }
      pending = null;
      everything = false;
      void Promise.all(work).catch((err: unknown) => log(`records: could not read ${dataDir}: ${message(err)}`));
    }, SETTLE_MS);
  };

  const onEvent = (filename: string | null): void => {
    const p = (pending ??= nothingPending());
    const under = (folder: string): string | null => (filename?.startsWith(folder + sep) ? filename.slice(folder.length + 1) : null);
    if (filename === null || filename === "") everything = true;
    else if (filename === SETTINGS_FILE) p.settings = true;
    else if (filename === SESSIONS_FOLDER) p.allRecords = true;
    else if (filename === AGENTS_FOLDER) p.allProfiles = true;
    else if (under(SESSIONS_FOLDER) !== null) {
      const id = RECORDS.idAt(under(SESSIONS_FOLDER) ?? "");
      if (id === null) return;
      p.records.add(id);
    } else if (under(AGENTS_FOLDER) !== null) {
      // An agent's folder appearing or going away names no file: read every profile again.
      const relative = under(AGENTS_FOLDER) ?? "";
      const id = PROFILES.idAt(relative);
      if (id !== null) p.profiles.add(id);
      else if (!relative.includes(sep)) p.allProfiles = true;
      else return;
    } else return;
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
    get: records.get,
    settings: () => settings,
    create: records.create,
    update: records.update,
    profiles,

    adopt(adoptedAt) {
      return queue(SETTINGS_KEY, async () => {
        const path = join(dataDir, SETTINGS_FILE);
        const text = await readText(path);
        if (text === null) {
          await writeNew(path, settingsWithAdoptedAt(null, adoptedAt));
          return;
        }
        const parsed = parseSettings(text);
        if (!parsed.ok) throw new Error(`${path} cannot be used: ${parsed.problem}`);
        if (parsed.value.adoptedAt === null) await replace(path, settingsWithAdoptedAt(text, adoptedAt));
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

    settingsText: () => settingsText,

    rewriteSettings(rewrite) {
      return queue(SETTINGS_KEY, async () => {
        const path = join(dataDir, SETTINGS_FILE);
        const text = await readText(path);
        if (text !== null) {
          const parsed = parseSettings(text);
          if (!parsed.ok) throw new RecordError("unreadable", `${path} cannot be used: ${parsed.problem}. Fix or delete the file.`);
        }
        const next = rewrite(text);
        if (next === text) return;
        if (text === null) {
          if (!(await writeNew(path, next))) throw new Error(`${path} appeared while it was being written; try again`);
        } else await replace(path, next);
      }).then(reloadSettings);
    },
  };
}
