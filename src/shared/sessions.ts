// Sessions as the UI and the backend both know them (docs/CONTRACTS.md "Sessions"): what the
// backend learns from the providers' transcript stores (the summary, ARCHITECTURE §2.2–2.3), the session
// record the app keeps for each one (ARCHITECTURE §4), the project(s) it shows in (ARCHITECTURE §2.6), its live
// state (ARCHITECTURE §2.4), the methods that answer and change them and the event that says they changed.
//
// The shapes are type aliases, so they are JSON values to the broker as they are.

import { AGENT_TAB_TITLE_MAX, SESSION_LIVE_STATES, SESSION_STATUSES, type SessionLiveState, type SessionStatus } from "pomade-kit/protocol";

/** Answers `SessionsAnswer`: every session, or the changes since a revision. */
export const SESSIONS_LIST_METHOD = "sessions.list";

/** Sets the status (and the note) of one or more sessions; answers `SessionsUpdated`. */
export const SESSIONS_SET_STATUS_METHOD = "sessions.setStatus";

/** Names a session, or makes it unnamed; answers `SessionsUpdated`. */
export const SESSIONS_RENAME_METHOD = "sessions.rename";

/** Moves a session to a project, to the Workspace, or back to its automatic project; answers `SessionsUpdated`. */
export const SESSIONS_MOVE_METHOD = "sessions.moveToProject";

/** One session by id; answers `SessionsGetResult`. */
export const SESSIONS_GET_METHOD = "sessions.get";

/** A session's last agent answer; answers `SessionsLastMessageResult`. */
export const SESSIONS_LAST_MESSAGE_METHOD = "sessions.lastMessage";

/** The sessions started in a folder within a time window; answers `SessionsFindResult`. */
export const SESSIONS_FIND_METHOD = "sessions.find";

/** Brings the user back into a session: focuses its agent tab, opens its Runner run's terminal, or
 *  resumes it in a new agent tab; answers `SessionsOpenResult`. */
export const SESSIONS_OPEN_METHOD = "sessions.open";

/** The session bound to an agent tab, by the tab's id (`POMADE_TAB_ID`); answers `SessionsOfTabResult`. */
export const SESSIONS_OF_TAB_METHOD = "sessions.ofTab";

/** Published by the backend, unqualified, whenever sessions change; payload `SessionsChanged`. */
export const SESSIONS_CHANGED_EVENT = "sessions.changed";

/** A session name's longest length: it is also the tab's title. */
export const SESSION_NAME_MAX = AGENT_TAB_TITLE_MAX;

/** A note's longest length. */
export const SESSION_NOTE_MAX = 500;

export type SessionProvider = "claude-code" | "codex";

/** A text from the transcript and when it was written (ISO 8601; `null` when the record has no time). */
export type TimedText = {
  text: string;
  at: string | null;
};

/** Tokens summed over every turn. `input` is the uncached input only. */
export type TokenTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

/** What the transcript says about a session. */
export type SessionSummary = {
  /** The provider's session id. */
  id: string;
  provider: SessionProvider;
  /** Roster id: `claude`, `codex`, or the folder agent's name. */
  agent: string;
  /** The transcript file, absolute: unique per summary. */
  transcript: string;
  /** The start folder: the first recorded working folder. */
  cwd: string | null;
  /** The git branch recorded at the start; `null` when the provider records none. */
  branch: string | null;
  /** First and last record times, ISO 8601. */
  startedAt: string | null;
  lastActiveAt: string | null;
  /** The model and reasoning effort of the latest turn. */
  model: string | null;
  effort: string | null;
  tokens: TokenTotals;
  /** The latest turn's input-side tokens and the model's context window; `null` when either is unknown. */
  context: { used: number; window: number } | null;
  /** Estimated cost in USD; `null` when any turn ran on a model the price table lacks. */
  costUsd: number | null;
  /** The user's first and last real messages, injected content skipped. */
  firstMessage: TimedText | null;
  lastMessage: TimedText | null;
  /** The agent's last text answer. */
  lastAnswer: TimedText | null;
  /** Lines that were not JSON, skipped. */
  malformedLines: number;
};

/** The session record, `<workspace>/Apps/pomade-agents/sessions/<id>.yaml` (ARCHITECTURE §4): the keys
 *  the file holds, an absent key absent here too. */
export type SessionRecord = {
  id: string;
  provider: SessionProvider;
  /** Roster id. */
  agent: string;
  /** Absent: unnamed. */
  name?: string;
  status: SessionStatus;
  /** One line. */
  note?: string;
  /** The effective project's stable id — the first, when several share the start folder; absent: the Workspace. */
  project?: string;
  /** The effective project's folder, workspace-relative, as Pomade names it now. */
  projectRoot?: string;
  /** The user chose the project (Move to project): `project` is their choice. */
  projectOverride?: true;
  /** The project of the Pomade tab the session was first seen bound to; `"__workspace__"`: a tab in the Workspace scope (the session belongs to no project). */
  launchedFrom?: string;
  forkedFrom?: string;
  /** Absent: started by the user. */
  startedByRunner?: { job: string };
  /** Created after the app's first run and never bound to a Pomade tab. */
  outsidePomade?: true;
  /** The transcript file, absolute. */
  transcript?: string;
  /** The start folder, absolute. */
  cwd?: string;
  /** When the app last wrote the record, ISO 8601. */
  updated?: string;
};

/** Which rule placed a session (ARCHITECTURE §2.6): Move to project; the project of the tab that first ran
 *  it; the deepest project root holding its start folder; the project it was placed in before, when
 *  no project root holds the folder any more (the project was renamed or moved); the Workspace. */
export type AttributionRule = "override" | "launched" | "folder" | "remembered" | "workspace";

/** Where a session shows. */
export type Attribution = {
  /** Stable project ids, in sidebar order; `[]`: the Workspace bucket. */
  projects: string[];
  by: AttributionRule;
  /** Several projects share the start folder's root: the session shows in each, with a "shared folder" marker. */
  sharedFolder: boolean;
};

/** The Pomade agent tab a session is bound to. */
export type SessionTab = {
  /** The tab's lasting id (`AgentTabInfo.tabId`). */
  tabId: string;
  /** The tab's project; `"__workspace__"` for the Workspace project. */
  projectId: string;
};

/** Why the Sessions tab leaves a session out (ARCHITECTURE §2.7): `empty` — its transcript holds no
 *  message of the user's and no answer, as a file that holds only a `/clear`. */
export type HiddenReason = "empty";

/** One session: what its transcript says, its record, where it shows, what it is doing now, the
 *  agent tab bound to it, why the Sessions tab hides it, and whether it counts. */
export type Session = {
  id: string;
  /** The session's latest transcript. */
  summary: SessionSummary;
  /** `null` while there is none: no workspace is open, the first run is still indexing, or the record file cannot be read. */
  record: SessionRecord | null;
  /** Why the record file cannot be read; the app leaves it alone until it reads again. */
  recordProblem: string | null;
  attribution: Attribution;
  /** The start folder relative to the folder of the first project it shows in, both with symlinks
   *  resolved: `""` at that folder; `null` when it shows in no project, or that project does not hold it. */
  folderInProject: string | null;
  /** What it is doing now, from the agent tab bound to it; `closed` when none runs it. */
  live: SessionLiveState;
  /** When the backend saw it enter `live` (ISO 8601); `null`: Closed, and not seen live since the backend started. */
  liveSince: string | null;
  /** The agent tab Pomade lists bound to it — a live one first; `null` when none is. */
  tab: SessionTab | null;
  /** Why the Sessions tab hides it; `null`: shown. Every read lists it all the same. */
  hidden: HiddenReason | null;
  /** True for a work session (ARCHITECTURE §2.9, `isWorkSession`): every count and sum is over these. */
  work: boolean;
};

/** Where a caller's copy stands: the `epoch` and `revision` of the last answer it applied. */
export type SessionsSince = {
  epoch: string;
  revision: number;
};

export type SessionsListParams = {
  /** Omitted, or from another epoch: the answer is every session (`full`). */
  since?: SessionsSince;
};

export type SessionsAnswer = {
  /** Names one backend run; revisions count within it. */
  epoch: string;
  revision: number;
  /** True: `sessions` is every session — replace the copy. False: only the changes since `since`. */
  full: boolean;
  sessions: Session[];
  /** Ids of the sessions gone since `since` (always empty when `full`). */
  removed: string[];
  /** True while the first walk of the stores is still running. */
  indexing: boolean;
  /** Why session records are not kept now (no workspace open, `settings.yaml` unreadable); `null` while they are. */
  recordsOff: string | null;
};

export type SetStatusParams = {
  ids: string[];
  status: SessionStatus;
  /** A one-line note to set; `null` or empty removes it; omitted keeps it. */
  note?: string | null;
};

export type RenameParams = {
  id: string;
  /** The new name; `null` or empty: unnamed. */
  name: string | null;
};

export type MoveToProjectParams = {
  id: string;
  /** A project's stable id, or `"__workspace__"` for the Workspace bucket; `null`: back to the automatic project. */
  project: string | null;
};

/** What a change method answers: the changed sessions as they are now. */
export type SessionsUpdated = {
  sessions: Session[];
};

/** `sessions.changed` payload: a caller behind this revision asks `sessions.list` again. */
export type SessionsChanged = {
  epoch: string;
  revision: number;
};

export type SessionsOpenParams = {
  id: string;
};

export type SessionsOpenResult = {
  /** What was done: its bound tab focused (`tab`), its Runner run's terminal opened (`run`), or
   *  it resumed in a new agent tab (`resumed`). */
  opened: "tab" | "run" | "resumed";
  /** The agent tab in front now; `null` for a run's terminal. */
  tabId: string | null;
  /** The session as it is now: a resumed one Active. */
  session: Session;
};

export type SessionsGetParams = {
  id: string;
};

export type SessionsGetResult = {
  session: Session;
};

export type SessionsOfTabParams = {
  /** A tab's lasting id: what Pomade gives its terminal as `POMADE_TAB_ID`. */
  tabId: string;
};

export type SessionsOfTabResult = {
  /** True when Pomade lists an agent tab with this id; false for a plain terminal's tab, or a tab
   *  that is gone. */
  agentTab: boolean;
  /** The session the agent tab is bound to; `null` when there is no agent tab, or its agent has no
   *  session yet (not prompted, or its transcript not read yet). */
  session: Session | null;
};

export type SessionsLastMessageParams = {
  id: string;
};

export type SessionsLastMessageResult = {
  /** The agent's last text answer as it wrote it (Markdown), trimmed and capped at 4000 characters; `null` while it has not answered. */
  message: TimedText | null;
};

export type SessionsFindParams = {
  /** The start folder: absolute; compared with symlinks resolved, exactly. */
  cwd: string;
  /** ISO 8601; both ends included. */
  startedFrom: string;
  startedTo: string;
  /** Only this agent's sessions (roster id). */
  agent?: string;
};

/** A session `sessions.find` matched. */
export type FoundSession = {
  id: string;
  provider: SessionProvider;
  agent: string;
  /** The start folder, absolute, symlinks resolved. */
  cwd: string;
  startedAt: string;
  lastActiveAt: string;
};

export type SessionsFindResult = {
  /** Earliest start first. */
  sessions: FoundSession[];
};

/** Context fill in percent, one decimal. */
export function contextPercent(context: { used: number; window: number }): number {
  return Math.round((context.used / context.window) * 1000) / 10;
}

// ── Checks for values that crossed the broker or came from disk ────────────

type Shape = Record<string, unknown>;

const isObject = (v: unknown): v is Shape => typeof v === "object" && v !== null && !Array.isArray(v);
const isStringOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const isOptionalText = (v: unknown): boolean => v === undefined || isText(v);

export function isSessionStatus(v: unknown): v is SessionStatus {
  return (SESSION_STATUSES as readonly unknown[]).includes(v);
}

export function isSessionProvider(v: unknown): v is SessionProvider {
  return v === "claude-code" || v === "codex";
}

function isTimedTextOrNull(v: unknown): boolean {
  return v === null || (isObject(v) && typeof v.text === "string" && isStringOrNull(v.at));
}

function isTokenTotals(v: unknown): boolean {
  return isObject(v) && isCount(v.input) && isCount(v.output) && isCount(v.cacheRead) && isCount(v.cacheWrite);
}

export function isSessionSummary(value: unknown): value is SessionSummary {
  if (!isObject(value)) return false;
  const v = value;
  return (
    typeof v.id === "string" &&
    isSessionProvider(v.provider) &&
    typeof v.agent === "string" &&
    typeof v.transcript === "string" &&
    isStringOrNull(v.cwd) &&
    isStringOrNull(v.branch) &&
    isStringOrNull(v.startedAt) &&
    isStringOrNull(v.lastActiveAt) &&
    isStringOrNull(v.model) &&
    isStringOrNull(v.effort) &&
    isTokenTotals(v.tokens) &&
    (v.context === null || (isObject(v.context) && isCount(v.context.used) && isCount(v.context.window) && v.context.window > 0)) &&
    (v.costUsd === null || isCount(v.costUsd)) &&
    isTimedTextOrNull(v.firstMessage) &&
    isTimedTextOrNull(v.lastMessage) &&
    isTimedTextOrNull(v.lastAnswer) &&
    isCount(v.malformedLines)
  );
}

/** The record keys, in the order a new record file lists them (ARCHITECTURE §4). */
export const SESSION_RECORD_KEYS = [
  "id",
  "provider",
  "agent",
  "name",
  "status",
  "note",
  "project",
  "projectRoot",
  "projectOverride",
  "launchedFrom",
  "forkedFrom",
  "startedByRunner",
  "outsidePomade",
  "transcript",
  "cwd",
  "updated",
] as const satisfies readonly (keyof SessionRecord)[];

/** True for a record with only `SessionRecord`'s keys, each well-formed: names and notes one line. */
export function isSessionRecord(value: unknown): value is SessionRecord {
  if (!isObject(value)) return false;
  const v = value;
  const oneLine = (x: unknown): boolean => x === undefined || (isText(x) && !/[\r\n]/.test(x));
  const runner = v.startedByRunner;
  return (
    Object.keys(v).every((key) => (SESSION_RECORD_KEYS as readonly string[]).includes(key)) &&
    isText(v.id) &&
    isSessionProvider(v.provider) &&
    isText(v.agent) &&
    oneLine(v.name) &&
    isSessionStatus(v.status) &&
    oneLine(v.note) &&
    isOptionalText(v.project) &&
    (v.projectRoot === undefined || typeof v.projectRoot === "string") &&
    (v.projectOverride === undefined || v.projectOverride === true) &&
    isOptionalText(v.launchedFrom) &&
    isOptionalText(v.forkedFrom) &&
    (runner === undefined || (isObject(runner) && Object.keys(runner).length === 1 && isText(runner.job))) &&
    (v.outsidePomade === undefined || v.outsidePomade === true) &&
    isOptionalText(v.transcript) &&
    isOptionalText(v.cwd) &&
    isOptionalText(v.updated)
  );
}

const ATTRIBUTION_RULES: readonly unknown[] = ["override", "launched", "folder", "remembered", "workspace"] satisfies AttributionRule[];

function isAttribution(v: unknown): v is Attribution {
  return (
    isObject(v) &&
    Array.isArray(v.projects) &&
    v.projects.every(isText) &&
    ATTRIBUTION_RULES.includes(v.by) &&
    typeof v.sharedFolder === "boolean"
  );
}

export function isSession(value: unknown): value is Session {
  if (!isObject(value)) return false;
  const v = value;
  return (
    typeof v.id === "string" &&
    isSessionSummary(v.summary) &&
    (v.record === null || isSessionRecord(v.record)) &&
    isStringOrNull(v.recordProblem) &&
    isAttribution(v.attribution) &&
    isStringOrNull(v.folderInProject) &&
    (SESSION_LIVE_STATES as readonly unknown[]).includes(v.live) &&
    isStringOrNull(v.liveSince) &&
    (v.tab === null || (isObject(v.tab) && isText(v.tab.tabId) && isText(v.tab.projectId))) &&
    (v.hidden === null || v.hidden === "empty") &&
    typeof v.work === "boolean"
  );
}

/** True for a well-formed `sessions.list` answer. */
export function isSessionsAnswer(value: unknown): value is SessionsAnswer {
  if (!isObject(value)) return false;
  const v = value;
  return (
    typeof v.epoch === "string" &&
    isCount(v.revision) &&
    typeof v.full === "boolean" &&
    typeof v.indexing === "boolean" &&
    isStringOrNull(v.recordsOff) &&
    Array.isArray(v.sessions) &&
    v.sessions.every(isSession) &&
    Array.isArray(v.removed) &&
    v.removed.every((r) => typeof r === "string")
  );
}

/** True for a well-formed `sessions.changed` payload. */
export function isSessionsChanged(value: unknown): value is SessionsChanged {
  return isObject(value) && typeof value.epoch === "string" && isCount(value.revision);
}

const OPENED: readonly unknown[] = ["tab", "run", "resumed"] satisfies SessionsOpenResult["opened"][];

/** True for a well-formed `sessions.open` answer. */
export function isSessionsOpenResult(value: unknown): value is SessionsOpenResult {
  return isObject(value) && OPENED.includes(value.opened) && isStringOrNull(value.tabId) && isSession(value.session);
}

/** True for a well-formed `sessions.ofTab` answer: no agent tab never carries a session. */
export function isSessionsOfTabResult(value: unknown): value is SessionsOfTabResult {
  return isObject(value) && typeof value.agentTab === "boolean" && (value.session === null || (value.agentTab && isSession(value.session)));
}

/** True for a well-formed `sessions.get` answer. */
export function isSessionsGetResult(value: unknown): value is SessionsGetResult {
  return isObject(value) && isSession(value.session);
}

/** True for a well-formed answer of a change method (`SessionsUpdated`). */
export function isSessionsUpdated(value: unknown): value is SessionsUpdated {
  return isObject(value) && Array.isArray(value.sessions) && value.sessions.every(isSession);
}
