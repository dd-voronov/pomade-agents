// Every agent session on this Mac, kept current: the stores' transcripts parsed into summaries
// (DESIGN §2.2–2.3), each new or grown transcript re-parsed from where it stopped.
//
// Watching: one recursive `fs.watch` per store root. On macOS that is one FSEvents stream per root
// — no descriptor per file or folder, so hundreds of transcripts carry no EMFILE risk, and events
// arrive within milliseconds. An event names a path; the path is stat'ed and read from its parsed
// offset, so a coalesced, repeated or missed-detail event only costs a stat. FSEvents may swallow a
// second change to a path that changed moments before, so a transcript that changed is read once
// more `RECHECK_MS` later, until a read finds nothing new. A root that does not
// exist yet (an agent that never ran, no Codex) cannot be watched: a 2 s tick checks for it, and
// for roots that went away or roster changes (a folder agent added or removed). The Codex date tree
// is walked once when its root is first watched, then followed by its events.
//
// Reads run a few at a time, each opening and closing its file. Summaries carry a revision; the
// API answers the changes since a caller's revision, and a change notice goes out at most every
// `NOTIFY_MS`. The parse index is saved at most every `SAVE_MS` while things change, and on stop.

import { randomUUID } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { stat } from "node:fs/promises";
import { join, sep } from "node:path";

import type { SessionSummary, SessionsChanged, SessionsSince } from "../../shared/sessions.ts";
import { readIndex, writeIndex, type FileMark, type IndexedFile } from "./index-file.ts";
import {
  builtinRoots,
  folderAgentRoots,
  listSessionFiles,
  mayHoldSessions,
  sessionFileAt,
  type SessionFile,
  type StoreRoot,
} from "./roots.ts";
import { summarize, type SessionState } from "./session-state.ts";
import { readTranscript } from "./transcript-file.ts";

/** Reads in flight at once. */
const CONCURRENCY = 4;
/** How long events gather before their paths are read. */
const SETTLE_MS = 40;
const NOTIFY_MS = 150;
const SAVE_MS = 5000;
const TICK_MS = 2000;
/** How long after a transcript changed it is read once more (FSEvents may swallow the next change). */
const RECHECK_MS = 500;

export interface SessionStoreOptions {
  /** The user's home: the built-in stores are under it. `null`: no built-in stores. */
  home: string | null;
  /** The open workspace: folder agents' stores are under its `Agents/`. `null`: none. */
  workspace: string | null;
  /** Machine-local state: the parse index. */
  stateDir: string;
  log: (line: string) => void;
}

/** The summaries, whole or as the changes since a revision. */
export interface SummariesAnswer {
  /** Names one store run; revisions count within it. */
  epoch: string;
  revision: number;
  /** True: `summaries` is every session's — replace the copy. False: only the changes since `since`. */
  full: boolean;
  summaries: SessionSummary[];
  /** Transcripts whose summary is gone since `since` (always empty when `full`). */
  removed: string[];
  /** True while the first walk of the stores is still running. */
  indexing: boolean;
}

export interface SessionStore {
  /** Summaries since `since`, or all of them. */
  answer(since?: SessionsSince): SummariesAnswer;
  /** Called (coalesced) after summaries changed; returns an unsubscribe function. */
  onChange(listener: (changed: SessionsChanged) => void): () => void;
  /** Resolves once the first walk of every store is parsed. */
  readonly indexed: Promise<void>;
  /** Stop watching and save the index. */
  stop(): Promise<void>;
}

interface Entry {
  file: SessionFile;
  mark: FileMark;
  state: SessionState;
  /** `null` for a transcript that is not a session (`state.excluded`). */
  summary: SessionSummary | null;
  revision: number;
}

interface WatchedRoot {
  root: StoreRoot;
  watcher: FSWatcher | null;
}

const isInside = (folder: string, path: string): boolean => path === folder || path.startsWith(folder + sep);

async function exists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function startSessionStore(options: SessionStoreOptions): Promise<SessionStore> {
  const { home, workspace, stateDir, log } = options;
  const epoch = randomUUID();
  let revision = 0;
  let stopped = false;
  /** Read after an await: `stop()` may have run meanwhile. */
  const isStopped = (): boolean => stopped;
  /** True until the first walk of every root is parsed. */
  let indexing = true;
  /** False until the first reconcile queued every root's walk. */
  let walking = false;
  let reconciling = false;

  const entries = new Map<string, Entry>();
  const removed = new Map<string, number>();
  /** Parsed marks from the last run, taken over by each file's first read. */
  const carried = await readIndex(stateDir);
  const roots = new Map<string, WatchedRoot>();

  const pendingFiles = new Map<string, SessionFile>();
  const pendingFolders = new Map<string, { root: StoreRoot; folder: string }>();
  const inFlight = new Set<string>();
  let settleTimer: NodeJS.Timeout | null = null;
  const rechecks = new Map<string, NodeJS.Timeout>();

  const listeners = new Set<(changed: SessionsChanged) => void>();
  let notifyTimer: NodeJS.Timeout | null = null;
  let saveTimer: NodeJS.Timeout | null = null;
  let resolveIndexed = (): void => {};
  const indexed = new Promise<void>((resolve) => {
    resolveIndexed = resolve;
  });

  // ── Changes out ──────────────────────────────────────────────────────────

  const changed = (): void => {
    revision += 1;
    notifyTimer ??= setTimeout(() => {
      notifyTimer = null;
      const payload = { epoch, revision };
      for (const listener of listeners) listener(payload);
    }, NOTIFY_MS);
    saveTimer ??= setTimeout(() => void save(), SAVE_MS);
  };

  /** Saves run one after another, each writing the entries as they are when it starts. */
  let saving = Promise.resolve();
  const save = (): Promise<void> => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    saving = saving.then(async () => {
      const files = new Map<string, IndexedFile>();
      for (const [path, entry] of entries) files.set(path, { mark: entry.mark, state: entry.state });
      try {
        await writeIndex(stateDir, files);
      } catch (err) {
        log(`sessions: could not save the parse index: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
    return saving;
  };

  const drop = (path: string): void => {
    if (!entries.delete(path)) return;
    changed();
    removed.set(path, revision);
  };

  // ── Reading ──────────────────────────────────────────────────────────────

  const recheckLater = (file: SessionFile): void => {
    clearTimeout(rechecks.get(file.path));
    rechecks.set(
      file.path,
      setTimeout(() => {
        rechecks.delete(file.path);
        pendingFiles.set(file.path, file);
        settle();
      }, RECHECK_MS),
    );
  };

  const read = async (file: SessionFile): Promise<void> => {
    const known = entries.get(file.path);
    const previous = known ?? carried.get(file.path) ?? null;
    carried.delete(file.path);
    const result = await readTranscript(file.root.provider, file.path, previous);
    if (isStopped()) return;
    if (result.kind === "gone") {
      drop(file.path);
      return;
    }
    if (result.kind === "unchanged" && known) return;
    const { mark, state } = result.kind === "parsed" ? result : (previous as IndexedFile);
    if (result.kind === "parsed") recheckLater(file);
    changed();
    removed.delete(file.path);
    entries.set(file.path, {
      file,
      mark,
      state,
      summary: state.excluded
        ? null
        : summarize(state, { fileId: file.fileId, provider: file.root.provider, agent: file.root.agent, transcript: file.path }),
      revision,
    });
  };

  const rescan = async (root: StoreRoot, folder: string): Promise<void> => {
    for (const file of await listSessionFiles(root, folder)) pendingFiles.set(file.path, file);
    // Known transcripts under a folder that changed may be gone with it.
    for (const entry of entries.values()) {
      if (entry.file.root === root && isInside(folder, entry.file.path)) pendingFiles.set(entry.file.path, entry.file);
    }
  };

  const pump = (): void => {
    if (stopped) return;
    for (const [key, { root, folder }] of pendingFolders) {
      pendingFolders.delete(key);
      inFlight.add(key);
      void rescan(root, folder).finally(() => {
        inFlight.delete(key);
        pump();
      });
    }
    for (const [path, file] of pendingFiles) {
      if (inFlight.size >= CONCURRENCY) break;
      if (inFlight.has(path)) continue;
      pendingFiles.delete(path);
      inFlight.add(path);
      read(file)
        .catch((err: unknown) => log(`sessions: could not read ${path}: ${err instanceof Error ? err.message : String(err)}`))
        .finally(() => {
          inFlight.delete(path);
          pump();
        });
    }
    if (indexing && walking && inFlight.size === 0 && pendingFiles.size === 0 && pendingFolders.size === 0) {
      indexing = false;
      carried.clear();
      changed();
      void save();
      resolveIndexed();
    }
  };

  const settle = (): void => {
    settleTimer ??= setTimeout(() => {
      settleTimer = null;
      pump();
    }, SETTLE_MS);
  };

  const queueFolder = (root: StoreRoot, folder: string): void => {
    pendingFolders.set(`${root.path}\0${folder}`, { root, folder });
  };

  // ── Watching ─────────────────────────────────────────────────────────────

  const onEvent = (root: StoreRoot, filename: string | null): void => {
    if (filename === null) {
      queueFolder(root, root.path);
    } else {
      const path = join(root.path, filename);
      const file = sessionFileAt(root, path);
      if (file) pendingFiles.set(path, file);
      else if (mayHoldSessions(root, path)) queueFolder(root, path);
    }
    settle();
  };

  const unwatch = (watched: WatchedRoot): void => {
    watched.watcher?.close();
    watched.watcher = null;
  };

  /** Start watching a root that exists, then walk it. */
  const watchRoot = (watched: WatchedRoot): void => {
    const { root } = watched;
    try {
      watched.watcher = watch(root.path, { recursive: true }, (_event, filename) => onEvent(root, filename));
    } catch (err) {
      log(`sessions: cannot watch ${root.path}: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    watched.watcher.on("error", (err) => {
      log(`sessions: watching ${root.path} failed (${err.message}); retrying`);
      unwatch(watched);
    });
    queueFolder(root, root.path);
  };

  /** Bring the roots in line with the roster and with what exists on disk. */
  const reconcile = async (): Promise<void> => {
    if (reconciling) return;
    reconciling = true;
    try {
      await reconcileRoots();
    } finally {
      reconciling = false;
    }
    walking = true;
    pump();
  };

  const reconcileRoots = async (): Promise<void> => {
    const wanted = [...(home === null ? [] : builtinRoots(home)), ...(workspace === null ? [] : await folderAgentRoots(workspace))];
    if (isStopped()) return;
    const wantedPaths = new Set(wanted.map((r) => r.path));
    for (const [path, watched] of roots) {
      if (wantedPaths.has(path)) continue;
      unwatch(watched);
      roots.delete(path);
      for (const [file, entry] of entries) if (entry.file.root === watched.root) drop(file);
    }
    for (const root of wanted) if (!roots.has(root.path)) roots.set(root.path, { root, watcher: null });
    for (const watched of roots.values()) {
      const present = await exists(watched.root.path);
      if (isStopped()) return;
      if (present && watched.watcher === null) watchRoot(watched);
      else if (!present && watched.watcher !== null) {
        unwatch(watched);
        queueFolder(watched.root, watched.root.path);
      }
    }
  };

  const started = Date.now();
  await reconcile();
  const tick = setInterval(() => void reconcile(), TICK_MS);
  void indexed.then(() => {
    let sessions = 0;
    let malformed = 0;
    for (const entry of entries.values()) {
      if (entry.summary === null) continue;
      sessions += 1;
      malformed += entry.summary.malformedLines;
    }
    log(`sessions: ${sessions} sessions from ${entries.size} transcripts indexed in ${Date.now() - started} ms; ${malformed} malformed lines`);
  });

  return {
    answer(since) {
      const after = since !== undefined && since.epoch === epoch && since.revision <= revision ? since.revision : null;
      const summaries: SessionSummary[] = [];
      for (const entry of entries.values()) {
        if (entry.summary !== null && (after === null || entry.revision > after)) summaries.push(entry.summary);
      }
      const gone = after === null ? [] : [...removed].filter(([, at]) => at > after).map(([path]) => path);
      return { epoch, revision, full: after === null, summaries, removed: gone, indexing };
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    indexed,
    async stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(tick);
      for (const timer of [settleTimer, notifyTimer, ...rechecks.values()]) if (timer) clearTimeout(timer);
      for (const watched of roots.values()) unwatch(watched);
      await save();
    },
  };
}
