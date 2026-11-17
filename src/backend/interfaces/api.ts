// The API the backend serves through Pomade's broker (HOST-API §4 `apps`): one handler per method
// in the manifest's `api`. The UI reaches it with `apps.call`, as other apps and Pomade do.
// Params are checked here; a malformed one is `invalid-params`.

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
import type { SessionData } from "../sessions/session-data.ts";

export interface ApiSources {
  info: AppInfo;
  sessions: Pick<SessionData, "answer" | "changeStatus" | "rename" | "moveToProject">;
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

export function createApi({ info, sessions }: ApiSources): Record<string, ApiHandler> {
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
  };
}
