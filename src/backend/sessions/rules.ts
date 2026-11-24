// What a session record holds, decided from what the app knows (DESIGN §2.4, §2.6, §4): the record
// a session gets when the app first sees it, and the fields the app keeps current in it afterwards.
//
// First sight: on the first run (the adoption) every session is Done; later, a session started
// before the adoption is Done too (its record went missing, or it ran on another Mac), and any other
// is Active and "outside Pomade" until a Pomade tab is seen bound to it. A session a Runner agent
// run started carries the job's name (`startedByRunner`) from the moment the app hears of the run.


import type { SessionRecord, SessionSummary } from "../../shared/sessions.ts";
import { attribute, type ProjectPlace } from "./attribution.ts";

/** What the app knows about a session besides its record. */
export interface RecordContext {
  /** The session's latest transcript. */
  summary: SessionSummary;
  /** The summary's start folder with symlinks resolved; `null` when it records none. */
  realCwd: string | null;
  /** The project of the first Pomade tab seen bound to the session (`"__workspace__"` for the Workspace scope); `null`: never seen bound. */
  boundIn: string | null;
  /** Pomade's projects in sidebar order; `null` while not known. */
  projects: readonly ProjectPlace[] | null;
  /** The name of the Runner job whose agent run started the session; `null`: none known this backend run. */
  runnerJob: string | null;
}

/** A session id that can name its record file: no path separators, no leading dot. */
export function isRecordId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id);
}

/** The latest of a session's transcripts (one id may have several): the last active, then the last path. */
export function latestSummary(summaries: Iterable<SessionSummary>): SessionSummary | null {
  let latest: SessionSummary | null = null;
  const time = (s: SessionSummary): number => (s.lastActiveAt === null ? -Infinity : Date.parse(s.lastActiveAt));
  for (const s of summaries) {
    if (latest === null || time(s) > time(latest) || (time(s) === time(latest) && s.transcript > latest.transcript)) latest = s;
  }
  return latest;
}

/** The record for a session the app sees for the first time. `adoptedAt` is the first run's time;
 *  `null` while the first run adopts the sessions that exist. */
export function newRecord(context: RecordContext, adoptedAt: string | null): SessionRecord {
  const { summary } = context;
  const existed =
    adoptedAt === null || (summary.startedAt !== null && Date.parse(summary.startedAt) < Date.parse(adoptedAt));
  const record: SessionRecord = { id: summary.id, provider: summary.provider, agent: summary.agent, status: existed ? "done" : "active" };
  if (!existed) record.outsidePomade = true;
  return refreshRecord(record, context);
}

/** The record with the fields the app keeps current: the agent its store belongs to, the transcript
 *  and start folder, the first binding to a tab, the Runner job that started it, and the effective
 *  project with its root as Pomade names it now. Everything else — name, status, note, a Move to
 *  project — stays as it is. */
export function refreshRecord(record: SessionRecord, { summary, realCwd, boundIn, projects, runnerJob }: RecordContext): SessionRecord {
  const next: SessionRecord = { ...record, agent: summary.agent, transcript: summary.transcript };
  if (summary.cwd !== null) next.cwd = summary.cwd;
  if (runnerJob !== null) next.startedByRunner = { job: runnerJob };
  if (boundIn !== null) {
    delete next.outsidePomade;
    if (next.launchedFrom === undefined) next.launchedFrom = boundIn;
  }
  if (projects === null) return next;
  // A Move to a project that no longer exists is void: the session goes back to its automatic project.
  if (next.projectOverride && next.project !== undefined && !projects.some((p) => p.id === next.project)) delete next.projectOverride;
  const [first] = attribute({ cwd: realCwd ?? next.cwd ?? null, record: next, projects }).projects;
  const place = projects.find((p) => p.id === first);
  if (place) {
    next.project = place.id;
    next.projectRoot = place.root;
  } else {
    delete next.project;
    delete next.projectRoot;
  }
  return next;
}

/** True when two records hold the same values (`updated` aside). */
export function sameRecord(a: SessionRecord, b: SessionRecord): boolean {
  const { updated: _a, ...restA } = a;
  const { updated: _b, ...restB } = b;
  return canonical(restA) === canonical(restB);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
