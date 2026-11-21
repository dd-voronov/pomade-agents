// The sessions the app answers for (DESIGN §2.4, §2.6, §4): each session the stores know joined
// with its record, the project(s) it shows in and its live state, kept current as the transcripts,
// the records on disk, Pomade's projects and tabs and what runs now change.
//
// - **First sight.** A session without a record gets one (`rules.ts`). The first run waits for the
//   first walk of the stores, records every session found then as Done, and only then writes
//   `settings.yaml` with `adoptedAt` — a first run cut short starts over and keeps the records it
//   wrote.
// - **Records follow.** The fields the app keeps current in a record (transcript, start folder,
//   first binding, project and its root) are written when they change; a record that cannot be
//   read is left alone and its session shows without one.
// - **Changes in.** Status, note, name and Move to project go to the record file and nowhere else;
//   every status change goes through `changeStatus`.
// - **Changes out.** Each session carries a revision; the API answers the changes since a
//   caller's revision, and a change notice goes out at most every `NOTIFY_MS`.
//
// A session whose transcripts are gone leaves the answer; its record stays on disk, and joins
// again if a transcript of it comes back.

import { randomUUID } from "node:crypto";

import { WORKSPACE_PROJECT_ID, type SessionStatus } from "pomade-kit/protocol";
import { HostError } from "pomade-kit/sdk";

import type {
  Session,
  SessionRecord,
  SessionSummary,
  SessionsAnswer,
  SessionsChanged,
  SessionsSince,
} from "../../shared/sessions.ts";
import { RecordError, type RecordStore } from "../records/record-store.ts";
import type { SummariesAnswer } from "../stores/session-store.ts";
import { attribute, type ProjectPlace } from "./attribution.ts";
import type { LiveState } from "./live-state.ts";
import { isRecordId, latestSummary, newRecord, refreshRecord, sameRecord, type RecordContext } from "./rules.ts";

const NOTIFY_MS = 150;
/** Records written at once while the first run adopts the sessions. */
const ADOPT_BATCH = 16;

/** Where the summaries come from: the session store. */
export interface SummarySource {
  answer(since?: SessionsSince): SummariesAnswer;
  onChange(listener: (changed: SessionsChanged) => void): () => void;
}

export interface SessionDataOptions {
  summaries: SummarySource;
  /** The record files; `null` when they cannot be kept, `noRecords` says why. */
  records: RecordStore | null;
  noRecords: string;
  /** What runs now: each session's live state. */
  live: Pick<LiveState, "ofSession" | "onChange">;
  now: () => Date;
  log: (line: string) => void;
}

export interface SessionData {
  /** Sessions since `since`, or all of them. */
  answer(since?: SessionsSince): SessionsAnswer;
  /** Every session as it is now. */
  list(): Session[];
  /** Called (coalesced) after sessions changed; returns an unsubscribe function. */
  onChange(listener: (changed: SessionsChanged) => void): () => void;
  /** Pomade's projects, in sidebar order. */
  setProjects(projects: ProjectPlace[]): void;
  /** A Pomade tab in project `projectId` is bound to session `sessionId`. */
  bind(sessionId: string, projectId: string): void;
  /** Set the status of sessions — the one way a status changes. `note`: a string sets it, `null` removes it, omitted keeps it. */
  changeStatus(ids: readonly string[], status: SessionStatus, note?: string | null): Promise<Session[]>;
  /** Name a session; `null`: unnamed. */
  rename(id: string, name: string | null): Promise<Session>;
  /** Move a session to a project, to the Workspace (`"__workspace__"`), or back to its automatic project (`null`). */
  moveToProject(id: string, project: string | null): Promise<Session>;
  stop(): void;
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

interface Entry {
  session: Session;
  /** The session as JSON: an unchanged session keeps its revision. */
  json: string;
  revision: number;
}

export function startSessionData(options: SessionDataOptions): SessionData {
  const { summaries: source, records, noRecords, live, now, log } = options;
  const epoch = randomUUID();
  let revision = 0;
  let stopped = false;

  const byTranscript = new Map<string, SessionSummary>();
  const transcriptsOf = new Map<string, Set<string>>();
  let sourceSince: SessionsSince | undefined;
  let indexing = true;
  let projects: ProjectPlace[] | null = null;
  /** The project of the first tab seen bound to each session. */
  const boundIn = new Map<string, string>();
  let adopting = false;

  const entries = new Map<string, Entry>();
  const removed = new Map<string, number>();
  const dirty = new Set<string>();
  let flushTimer: NodeJS.Timeout | null = null;
  const listeners = new Set<(changed: SessionsChanged) => void>();
  let notifyTimer: NodeJS.Timeout | null = null;

  // ── Changes out ──────────────────────────────────────────────────────────

  const changed = (): void => {
    revision += 1;
    notifyTimer ??= setTimeout(() => {
      notifyTimer = null;
      const payload = { epoch, revision };
      for (const listener of listeners) listener(payload);
    }, NOTIFY_MS);
  };

  const recordsOff = (): string | null => {
    if (records === null) return noRecords;
    const settings = records.settings();
    return settings.ok ? null : `The app's settings.yaml cannot be used (${settings.problem}), so new sessions get no record until it is fixed or deleted.`;
  };

  /** The first run's time; `null` before it or while the settings cannot be read. */
  const adoptedAt = (): string | null => {
    const settings = records?.settings();
    return settings?.ok ? settings.value.adoptedAt : null;
  };

  // ── Joining ──────────────────────────────────────────────────────────────

  const latest = (id: string): SessionSummary | null =>
    latestSummary([...(transcriptsOf.get(id) ?? [])].flatMap((path) => byTranscript.get(path) ?? []));

  const contextOf = (summary: SessionSummary): RecordContext => ({ summary, boundIn: boundIn.get(summary.id) ?? null, projects });

  /** Sessions with a write of the app's own in flight; `true`: asked again meanwhile. */
  const writing = new Map<string, boolean>();
  /** One write of the app's own per session at a time; one asked for meanwhile is reconsidered once it is done. */
  const writeOnce = (id: string, task: () => Promise<unknown>): void => {
    if (writing.has(id)) {
      writing.set(id, true);
      return;
    }
    writing.set(id, false);
    void task().finally(() => {
      const again = writing.get(id) === true;
      writing.delete(id);
      if (again) mark(id);
    });
  };

  /** Write the fields the app keeps current, starting from the record on disk. */
  const refresh = (id: string): void => {
    if (records === null) return;
    writeOnce(id, () =>
      records
        .update(id, (record) => {
          const summary = latest(id);
          return summary === null ? record : refreshRecord(record, contextOf(summary));
        })
        .catch((err: unknown) => {
          if (!(err instanceof RecordError)) log(`sessions: could not update the record of ${id}: ${message(err)}`);
        }),
    );
  };

  const create = (record: SessionRecord): Promise<void> =>
    records === null
      ? Promise.resolve()
      : records.create(record).catch((err: unknown) => log(`sessions: could not write the record of ${record.id}: ${message(err)}`));

  const put = (id: string, session: Session): void => {
    const json = JSON.stringify(session);
    if (entries.get(id)?.json === json) return;
    changed();
    entries.set(id, { session, json, revision });
    removed.delete(id);
  };

  const reconcile = (id: string): void => {
    const summary = latest(id);
    if (summary === null) {
      if (entries.delete(id)) {
        changed();
        removed.set(id, revision);
      }
      return;
    }
    const held = records?.get(id);
    const record = held?.record ?? null;
    let problem = held?.problem ?? null;
    if (records !== null && held === undefined) {
      const firstRun = adoptedAt();
      if (!isRecordId(id)) problem = "its session id cannot name a file";
      else if (firstRun !== null && !adopting) writeOnce(id, () => create(newRecord(contextOf(summary), firstRun)));
    } else if (record !== null && !sameRecord(refreshRecord(record, contextOf(summary)), record)) {
      refresh(id);
    }
    put(id, { id, summary, record, recordProblem: problem, attribution: attribute({ cwd: summary.cwd, record, projects }), ...live.ofSession(id) });
  };

  const flush = (): void => {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    const ids = [...dirty];
    dirty.clear();
    for (const id of ids) reconcile(id);
  };

  const mark = (id: string): void => {
    dirty.add(id);
    if (!stopped) flushTimer ??= setTimeout(flush, 0);
  };

  const markAll = (): void => {
    for (const id of transcriptsOf.keys()) mark(id);
    for (const id of entries.keys()) mark(id);
  };

  // ── Summaries in ─────────────────────────────────────────────────────────

  const forget = (path: string): void => {
    const summary = byTranscript.get(path);
    if (summary === undefined) return;
    byTranscript.delete(path);
    const paths = transcriptsOf.get(summary.id);
    paths?.delete(path);
    if (paths?.size === 0) transcriptsOf.delete(summary.id);
    mark(summary.id);
  };

  const pull = (): void => {
    const answer = source.answer(sourceSince);
    if (answer.full) for (const path of [...byTranscript.keys()]) forget(path);
    for (const path of answer.removed) forget(path);
    for (const summary of answer.summaries) {
      forget(summary.transcript);
      byTranscript.set(summary.transcript, summary);
      const paths = transcriptsOf.get(summary.id) ?? new Set<string>();
      paths.add(summary.transcript);
      transcriptsOf.set(summary.id, paths);
      mark(summary.id);
    }
    sourceSince = { epoch: answer.epoch, revision: answer.revision };
    if (indexing !== answer.indexing) {
      indexing = answer.indexing;
      changed();
    }
    if (!indexing) void adoptOnFirstRun();
  };

  // ── The first run ────────────────────────────────────────────────────────

  const adoptOnFirstRun = async (): Promise<void> => {
    if (records === null || adopting || indexing) return;
    const settings = records.settings();
    if (!settings.ok || settings.value.adoptedAt !== null) return;
    adopting = true;
    const at = now().toISOString();
    try {
      const found = [...transcriptsOf.keys()].flatMap((id) => {
        const summary = latest(id);
        return summary !== null && isRecordId(id) && records.get(id) === undefined ? [summary] : [];
      });
      for (let i = 0; i < found.length; i += ADOPT_BATCH) {
        await Promise.all(found.slice(i, i + ADOPT_BATCH).map((summary) => create(newRecord(contextOf(summary), null))));
      }
      await records.adopt(at);
      log(`sessions: first run — ${found.length} existing sessions recorded as Done`);
    } catch (err) {
      log(`sessions: the first run could not finish: ${message(err)}`);
    } finally {
      adopting = false;
      markAll();
    }
  };

  // ── Changes in ───────────────────────────────────────────────────────────

  /** The session `id` with a usable record, else the error the caller gets. */
  const requireRecord = (id: string): void => {
    if (records === null) throw new HostError("not-ready", noRecords);
    if (latest(id) === null) throw new HostError("not-found", `No session ${JSON.stringify(id)}`);
    const held = records.get(id);
    if (held === undefined) throw new HostError("not-ready", `Session ${JSON.stringify(id)} has no record yet`);
    if (held.problem !== null) throw new HostError("io-error", `The record of session ${JSON.stringify(id)} cannot be used: ${held.problem}. Fix or delete the file.`);
  };

  /** Apply a change to the record on disk, then answer the session as it is now. */
  const change = async (id: string, apply: (record: SessionRecord) => SessionRecord): Promise<Session> => {
    if (records === null) throw new HostError("not-ready", noRecords);
    try {
      await records.update(id, apply);
    } catch (err) {
      if (err instanceof RecordError) throw new HostError(err.kind === "missing" ? "not-found" : "io-error", err.message);
      throw new HostError("io-error", message(err));
    }
    reconcile(id);
    const entry = entries.get(id);
    if (entry === undefined) throw new HostError("not-found", `No session ${JSON.stringify(id)}`);
    return entry.session;
  };

  const withText = (record: SessionRecord, key: "name" | "note", text: string | null | undefined): SessionRecord => {
    if (text === undefined) return record;
    const next = { ...record };
    const trimmed = text?.trim() ?? "";
    if (trimmed === "") delete next[key];
    else next[key] = trimmed;
    return next;
  };

  /** Re-attribute after a change that can move the session. */
  const refreshed = (record: SessionRecord): SessionRecord => {
    const summary = latest(record.id);
    return summary === null ? record : refreshRecord(record, contextOf(summary));
  };

  const unsubscribeSource = source.onChange(() => pull());
  const unsubscribeLive = live.onChange((ids) => {
    for (const id of ids) mark(id);
  });
  const unsubscribeRecords = records?.onChange((id) => {
    if (id !== null) {
      mark(id);
      return;
    }
    changed();
    markAll();
    void adoptOnFirstRun();
  });
  pull();

  return {
    answer(since) {
      flush();
      const after = since !== undefined && since.epoch === epoch && since.revision <= revision ? since.revision : null;
      const sessions: Session[] = [];
      for (const entry of entries.values()) if (after === null || entry.revision > after) sessions.push(entry.session);
      const gone = after === null ? [] : [...removed].filter(([, at]) => at > after).map(([id]) => id);
      return { epoch, revision, full: after === null, sessions, removed: gone, indexing, recordsOff: recordsOff() };
    },

    list() {
      flush();
      return [...entries.values()].map((entry) => entry.session);
    },

    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    setProjects(next) {
      projects = next;
      markAll();
    },

    bind(sessionId, projectId) {
      if (boundIn.has(sessionId)) return;
      boundIn.set(sessionId, projectId);
      mark(sessionId);
    },

    async changeStatus(ids, status, note) {
      for (const id of ids) requireRecord(id);
      const out: Session[] = [];
      for (const id of ids) out.push(await change(id, (record) => withText({ ...record, status }, "note", note)));
      return out;
    },

    async rename(id, name) {
      requireRecord(id);
      return change(id, (record) => withText(record, "name", name));
    },

    async moveToProject(id, project) {
      requireRecord(id);
      if (project !== null && project !== WORKSPACE_PROJECT_ID) {
        if (projects === null) throw new HostError("not-ready", "Pomade's projects are not known yet");
        if (!projects.some((p) => p.id === project)) throw new HostError("not-found", `No project ${JSON.stringify(project)}`);
      }
      return change(id, (record) => {
        const next: SessionRecord = { ...record };
        delete next.project;
        delete next.projectRoot;
        delete next.projectOverride;
        if (project !== null) next.projectOverride = true;
        if (project !== null && project !== WORKSPACE_PROJECT_ID) next.project = project;
        return refreshed(next);
      });
    },

    stop() {
      stopped = true;
      unsubscribeSource();
      unsubscribeLive();
      unsubscribeRecords?.();
      for (const timer of [flushTimer, notifyTimer]) if (timer) clearTimeout(timer);
    },
  };
}
