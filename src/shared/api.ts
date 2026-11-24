// The app's own API as the UI and the backend both know it: the methods the backend serves through
// Pomade's broker (the manifest's `api`) and the shapes they answer. docs/CONTRACTS.md describes it.

import { SESSIONS_FOR_REPO_METHOD, SESSIONS_LIVE_IN_METHOD } from "pomade-kit/protocol";

import {
  SESSIONS_FIND_METHOD,
  SESSIONS_GET_METHOD,
  SESSIONS_LAST_MESSAGE_METHOD,
  SESSIONS_LIST_METHOD,
  SESSIONS_MOVE_METHOD,
  SESSIONS_RENAME_METHOD,
  SESSIONS_SET_STATUS_METHOD,
} from "./sessions.ts";
import { LIVE_NOW_LIST_METHOD } from "./live-now.ts";
import { ROSTER_AGENTS_FOR_METHOD, ROSTER_AGENTS_METHOD, ROSTER_LAUNCH_SPEC_METHOD, ROSTER_LIST_METHOD, ROSTER_PROJECTS_FOR_METHOD } from "./roster.ts";

/** Answers `AppInfo`: which backend is running and where it keeps the app's data. */
export const APP_INFO_METHOD = "app.info";

/** Every method the backend serves, in the manifest's `api` order. */
export const API_METHODS = [
  APP_INFO_METHOD,
  SESSIONS_LIST_METHOD,
  SESSIONS_SET_STATUS_METHOD,
  SESSIONS_RENAME_METHOD,
  SESSIONS_MOVE_METHOD,
  SESSIONS_FOR_REPO_METHOD,
  SESSIONS_LIVE_IN_METHOD,
  SESSIONS_GET_METHOD,
  SESSIONS_LAST_MESSAGE_METHOD,
  SESSIONS_FIND_METHOD,
  LIVE_NOW_LIST_METHOD,
  ROSTER_LIST_METHOD,
  ROSTER_LAUNCH_SPEC_METHOD,
  ROSTER_PROJECTS_FOR_METHOD,
  ROSTER_AGENTS_FOR_METHOD,
  ROSTER_AGENTS_METHOD,
] as const;

export interface AppInfo {
  /** The app's version (the manifest's). */
  version: string;
  /** When this backend process started, ISO 8601. */
  startedAt: string;
  /** The open workspace's root, absolute, as Pomade names it; `null` when Pomade has no workspace open. */
  workspace: string | null;
  /** The workspace's root with symlinks resolved — how transcripts record start folders inside it;
   *  `workspace` when it cannot be resolved, `null` without a workspace. */
  workspaceReal: string | null;
  /** `<workspace>/Apps/pomade-agents`, absolute; `null` without a workspace. */
  dataDir: string | null;
  /** `<userData>/app-state/pomade-agents`, absolute: the app's machine-local state. */
  stateDir: string;
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/** True for a well-formed `app.info` answer. */
export function isAppInfo(value: unknown): value is AppInfo {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.version === "string" &&
    typeof v.startedAt === "string" &&
    isStringOrNull(v.workspace) &&
    isStringOrNull(v.workspaceReal) &&
    isStringOrNull(v.dataDir) &&
    typeof v.stateDir === "string"
  );
}
