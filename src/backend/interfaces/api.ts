// The API the backend serves through Pomade's broker (HOST-API §4 `apps`): one handler per method
// in the manifest's `api`. The UI reaches it with `apps.call`, as other apps and Pomade do.

import type { ApiHandler } from "pomade-kit/sdk";

import { APP_INFO_METHOD, type AppInfo } from "../../shared/api.ts";
import { SESSIONS_SUMMARIES_METHOD, type SessionsAnswer, type SessionsSince } from "../../shared/sessions.ts";

export interface ApiSources {
  info: AppInfo;
  sessions: { answer(since?: SessionsSince): SessionsAnswer };
}

/** `since` from `sessions.summaries` params; anything malformed reads as none (a full answer). */
function sinceOf(params: unknown): SessionsSince | undefined {
  if (typeof params !== "object" || params === null) return undefined;
  const since = (params as Record<string, unknown>).since;
  if (typeof since !== "object" || since === null) return undefined;
  const { epoch, revision } = since as Record<string, unknown>;
  return typeof epoch === "string" && typeof revision === "number" && Number.isInteger(revision) && revision >= 0
    ? { epoch, revision }
    : undefined;
}

export function createApi({ info, sessions }: ApiSources): Record<string, ApiHandler> {
  return {
    [APP_INFO_METHOD]: () => ({ ...info }),
    [SESSIONS_SUMMARIES_METHOD]: (params) => sessions.answer(sinceOf(params)),
  };
}
