// The API the backend serves through Pomade's broker (HOST-API §4 `apps`): one handler per method
// in the manifest's `api`. The UI reaches it with `apps.call`, as other apps and Pomade do.
// Params are checked here; a malformed one is `invalid-params`.

import {
  SESSIONS_FOR_REPO_METHOD,
  SESSIONS_LIVE_IN_METHOD,
  type JsonValue,
  type SessionsForRepoParams,
  type SessionsForRepoResult,
  type SessionsLiveInParams,
  type SessionsLiveInResult,
} from "pomade-kit/protocol";
import { HostError, type ApiHandler } from "pomade-kit/sdk";

import { APP_INFO_METHOD, type AppInfo } from "../../shared/api.ts";
import {
  SESSIONS_LIST_METHOD,
  SESSIONS_MOVE_METHOD,
  SESSION_NAME_MAX,
  SESSIONS_RENAME_METHOD,
  SESSIONS_SET_STATUS_METHOD,
  SESSION_NOTE_MAX,
  isSessionStatus,
  type SessionsSince,
  type SessionsUpdated,
} from "../../shared/sessions.ts";
import type { RealPath } from "../core/real-paths.ts";
import { liveSessions, repoSessions } from "../sessions/for-git.ts";
import type { LiveState } from "../sessions/live-state.ts";
import type { SessionData } from "../sessions/session-data.ts";

export interface ApiSources {
  info: AppInfo;
  sessions: Pick<SessionData, "answer" | "list" | "changeStatus" | "rename" | "moveToProject">;
  live: Pick<LiveState, "entries">;
  realPath: RealPath;
}

type Params = Record<string, unknown>;

function paramsOf(params: unknown): Params {
  if (typeof params !== "object" || params === null || Array.isArray(params)) throw new HostError("invalid-params", "params must be an object");
  return params as Params;
}

/** `since` from `sessions.list` params; anything malformed reads as none (a full answer). */
function sinceOf(params: unknown): SessionsSince | undefined {
  if (typeof params !== "object" || params === null) return undefined;
  const since = (params as Params).since;
  if (typeof since !== "object" || since === null) return undefined;
  const { epoch, revision } = since as Params;
  return typeof epoch === "string" && typeof revision === "number" && Number.isInteger(revision) && revision >= 0
    ? { epoch, revision }
    : undefined;
}

function idOf(value: unknown, key: string): string {
  if (typeof value !== "string" || value === "") throw new HostError("invalid-params", `"${key}" must be a session id`);
  return value;
}

/** A one-line text of at most `max` characters (trimmed), or `null`. */
function textOf(params: Params, key: string, max: number): string | null {
  const value = params[key];
  if (value === null) return null;
  if (typeof value !== "string" || /[\r\n]/.test(value) || value.trim().length > max) {
    throw new HostError("invalid-params", `"${key}" must be one line of at most ${max} characters, or null`);
  }
  return value;
}

/** `{ folder }` of the sessions contract: an absolute folder. */
function folderOf(params: Params): string {
  const { folder } = params;
  if (typeof folder !== "string" || !folder.startsWith("/") || /[\r\n\0]/.test(folder)) throw new HostError("invalid-params", '"folder" must be an absolute folder');
  return folder;
}

function forRepoParams(raw: unknown): SessionsForRepoParams {
  const params = paramsOf(raw);
  const { branch } = params;
  if (branch !== undefined && (typeof branch !== "string" || branch.trim() === "")) throw new HostError("invalid-params", '"branch" must be a branch name');
  return branch === undefined ? { folder: folderOf(params) } : { folder: folderOf(params), branch };
}

function liveInParams(raw: unknown): SessionsLiveInParams {
  return { folder: folderOf(paramsOf(raw)) };
}

/** The kit's contract shapes are interfaces, which TypeScript does not take for JSON values; they hold only JSON. */
const json = (value: SessionsForRepoResult | SessionsLiveInResult): JsonValue => value as unknown as JsonValue;

export function createApi({ info, sessions, live, realPath }: ApiSources): Record<string, ApiHandler> {
  const updated = async (changed: Promise<SessionsUpdated["sessions"]>): Promise<SessionsUpdated> => ({ sessions: await changed });
  return {
    [APP_INFO_METHOD]: () => ({ ...info }),
    [SESSIONS_LIST_METHOD]: (params) => sessions.answer(sinceOf(params)),
    [SESSIONS_SET_STATUS_METHOD]: (raw) => {
      const params = paramsOf(raw);
      const { ids, status } = params;
      if (!Array.isArray(ids) || ids.length === 0) throw new HostError("invalid-params", '"ids" must be a non-empty list of session ids');
      const unique = [...new Set(ids.map((id) => idOf(id, "ids")))];
      if (!isSessionStatus(status)) throw new HostError("invalid-params", '"status" must be one of active, on-hold, done, done-skip');
      const note = params.note === undefined ? undefined : textOf(params, "note", SESSION_NOTE_MAX);
      return updated(sessions.changeStatus(unique, status, note));
    },
    [SESSIONS_RENAME_METHOD]: (raw) => {
      const params = paramsOf(raw);
      return updated(sessions.rename(idOf(params.id, "id"), textOf(params, "name", SESSION_NAME_MAX)).then((s) => [s]));
    },
    [SESSIONS_MOVE_METHOD]: (raw) => {
      const params = paramsOf(raw);
      const { project } = params;
      if (project !== null && (typeof project !== "string" || project === "")) {
        throw new HostError("invalid-params", '"project" must be a project id, "__workspace__", or null');
      }
      return updated(sessions.moveToProject(idOf(params.id, "id"), project).then((s) => [s]));
    },
    [SESSIONS_FOR_REPO_METHOD]: async (raw) => json({ sessions: await repoSessions(sessions.list(), forRepoParams(raw), realPath) }),
    [SESSIONS_LIVE_IN_METHOD]: async (raw) => json(await liveSessions(live.entries(), liveInParams(raw), realPath)),
  };
}
