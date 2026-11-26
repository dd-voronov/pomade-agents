// The events the app publishes about one session (ARCHITECTURE §6, docs/CONTRACTS.md "Published
// events"): their names on the bus and their payloads. A subscriber names them
// `pomade-agents:<name>`. The shapes are type aliases, so they are JSON values as they are.

import { SESSION_STATUSES, type SessionStatus } from "pomade-kit/protocol";

import { isSessionProvider, type SessionProvider } from "./sessions.ts";

/** A: an agent answered and waits. Declared in the manifest, never published. */
export const SESSION_TURN_FINISHED_EVENT = "session.turnFinished";

/** B: the session's process ended; payload `SessionClosedEvent`. */
export const SESSION_CLOSED_EVENT = "session.closed";

/** C: the user changed the session's status; payload `StatusChangedEvent`, published `STATUS_WINDOW_MS` after the change. */
export const SESSION_STATUS_CHANGED_EVENT = "session.statusChanged";

/** How long after a status change event C waits: a change taken back inside it publishes nothing. */
export const STATUS_WINDOW_MS = 5000;

/** What every session event carries. */
export type SessionEventBase = {
  sessionId: string;
  provider: SessionProvider;
  /** Roster id. */
  agent: string;
  /** The project it shows in (the first, on a shared folder): stable id and folder, workspace-relative; `null`: the Workspace bucket. */
  project: { id: string; root: string } | null;
  /** The start folder, absolute, symlinks resolved; `null` when the transcript records none. */
  cwd: string | null;
  /** The session's latest transcript file, absolute. */
  transcript: string;
  /** `null`: unnamed. */
  name: string | null;
  status: SessionStatus;
  /** Runner started it (an unattended run); then `job` is the job's name, else `null`. */
  startedByRunner: boolean;
  job: string | null;
  /** When it happened, ISO 8601. */
  at: string;
};

/** Why a session's process ended. Subscribers treat a reason they do not know as an end too. */
export type SessionClosedReason = "exit" | "tab-closed" | "crash" | "run-finished";

export type SessionClosedEvent = SessionEventBase & {
  reason: SessionClosedReason;
};

export type StatusChangedEvent = SessionEventBase & {
  /** The status before the first change of the window; `to` (= `status`) after the last. */
  from: SessionStatus;
  to: SessionStatus;
};

// ── Checks for payloads that crossed the bus ─────────────────────────────────

type Shape = Record<string, unknown>;

const isObject = (v: unknown): v is Shape => typeof v === "object" && v !== null && !Array.isArray(v);
const isStringOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";
const isStatus = (v: unknown): v is SessionStatus => (SESSION_STATUSES as readonly unknown[]).includes(v);

function isEventBase(v: Shape): boolean {
  const { project } = v;
  return (
    typeof v.sessionId === "string" &&
    isSessionProvider(v.provider) &&
    typeof v.agent === "string" &&
    (project === null || (isObject(project) && typeof project.id === "string" && typeof project.root === "string")) &&
    isStringOrNull(v.cwd) &&
    typeof v.transcript === "string" &&
    isStringOrNull(v.name) &&
    isStatus(v.status) &&
    typeof v.startedByRunner === "boolean" &&
    (v.startedByRunner ? typeof v.job === "string" : v.job === null) &&
    typeof v.at === "string"
  );
}

export function isSessionClosedEvent(value: unknown): value is SessionClosedEvent {
  return isObject(value) && isEventBase(value) && typeof value.reason === "string";
}

export function isStatusChangedEvent(value: unknown): value is StatusChangedEvent {
  return isObject(value) && isEventBase(value) && isStatus(value.from) && isStatus(value.to) && value.to === value.status;
}
