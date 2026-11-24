// The Live now panel's data (DESIGN §2.8, docs/CONTRACTS.md "Live now") as the UI and the backend
// both know it: what runs now — one row per live agent tab, with what the panel shows of its
// session, and one per Runner agent run while it runs; the method that answers it and the event
// that says it changed.
//
// The shapes are type aliases, so they are JSON values to the broker as they are.

import { SESSION_LIVE_STATES, type SessionLiveState } from "pomade-kit/protocol";

/** Answers `LiveNowAnswer`: every row, whole. */
export const LIVE_NOW_LIST_METHOD = "liveNow.list";

/** Published by the backend, unqualified, whenever `liveNow.list` would answer differently; payload `LiveNowChanged`. */
export const LIVE_NOW_CHANGED_EVENT = "liveNow.changed";

/** The strip icon whose panel is Live now, and whose badge counts the Needs you rows. */
export const LIVE_NOW_ICON = "agents";

/** A live row's state: what runs never shows Closed. */
export type LiveRowState = Exclude<SessionLiveState, "closed">;

/** An agent tab that runs an agent now — bound to a session or not prompted yet. */
export type LiveTabRow = {
  kind: "tab";
  /** The agent tab: what a click focuses. */
  tabId: string;
  /** The tab's project; `"__workspace__"` for the Workspace. */
  project: string;
  /** The session bound to it; `null` before its first prompt. */
  sessionId: string | null;
  /** Roster id. */
  agent: string;
  /** The agent's name in the roster; its id when the roster has none. */
  agentName: string;
  state: LiveRowState;
  /** When the backend saw it enter `state` (ISO 8601). */
  since: string;
  /** The session's name; `null`: unnamed, or no session. */
  name: string | null;
  /** The session's first message, one line; `null` while there is none. */
  firstMessage: string | null;
};

/** A Runner agent run while it runs — an unattended run: Working from its run started to its run finished. */
export type LiveRunRow = {
  kind: "run";
  /** The job's id. */
  job: string;
  /** The run's id, within its job. */
  run: string;
  /** The job's name: the row's title. */
  name: string;
  /** The job's project; `"__workspace__"` for a workspace job. */
  project: string;
  /** The session it runs; `null` while not known. */
  sessionId: string | null;
  /** Roster id. */
  agent: string;
  /** The agent's name in the roster; its id when the roster has none. */
  agentName: string;
  state: "working";
  /** When the backend heard it start (ISO 8601). */
  since: string;
  /** Its session in Runner's keeper: what a click opens as an attached terminal; `null` when
   *  Runner's run started did not name it. */
  terminal: string | null;
};

/** One row of the panel. */
export type LiveRow = LiveTabRow | LiveRunRow;

/** A row's identity among the rows: its tab, or its job and run. */
export function liveRowKey(row: LiveRow): string {
  return row.kind === "tab" ? `tab:${row.tabId}` : `run:${row.job}\0${row.run}`;
}

export type LiveNowAnswer = {
  /** Names one backend run; revisions count within it. */
  epoch: string;
  revision: number;
  rows: LiveRow[];
};

/** `liveNow.changed` payload: a caller behind this revision asks `liveNow.list` again. */
export type LiveNowChanged = {
  epoch: string;
  revision: number;
};

/** The Needs you rows: the Agents icon's badge. */
export function needsYouCount(rows: readonly LiveRow[]): number {
  return rows.filter((row) => row.state === "needs-you").length;
}

// ── Checks for values that crossed the broker ──────────────────────────────

type Shape = Record<string, unknown>;

const isObject = (v: unknown): v is Shape => typeof v === "object" && v !== null && !Array.isArray(v);
const isStringOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";
const isText = (v: unknown): v is string => typeof v === "string" && v !== "";
const isRevision = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

function isLiveRow(value: unknown): value is LiveRow {
  if (!isObject(value)) return false;
  const v = value;
  const common = isText(v.project) && isStringOrNull(v.sessionId) && isText(v.agent) && isText(v.agentName) && isText(v.since);
  if (v.kind === "run") return common && isText(v.job) && isText(v.run) && isText(v.name) && v.state === "working" && isStringOrNull(v.terminal);
  return (
    v.kind === "tab" &&
    common &&
    isText(v.tabId) &&
    v.state !== "closed" &&
    (SESSION_LIVE_STATES as readonly unknown[]).includes(v.state) &&
    isStringOrNull(v.name) &&
    isStringOrNull(v.firstMessage)
  );
}

/** True for a well-formed `liveNow.list` answer. */
export function isLiveNowAnswer(value: unknown): value is LiveNowAnswer {
  return isObject(value) && typeof value.epoch === "string" && isRevision(value.revision) && Array.isArray(value.rows) && value.rows.every(isLiveRow);
}

/** True for a well-formed `liveNow.changed` payload. */
export function isLiveNowChanged(value: unknown): value is LiveNowChanged {
  return isObject(value) && typeof value.epoch === "string" && isRevision(value.revision);
}
