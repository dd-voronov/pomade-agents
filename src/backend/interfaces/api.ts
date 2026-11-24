// The API the backend serves through Pomade's broker (HOST-API §4 `apps`): one handler per method
// in the manifest's `api`. The UI reaches it with `apps.call`, as other apps and Pomade do.
// Params are checked here; a malformed one is `invalid-params`.

import {
  AGENT_PROMPT_MAX,
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
import { LIVE_NOW_LIST_METHOD } from "../../shared/live-now.ts";
import {
  ROSTER_AGENTS_FOR_METHOD,
  ROSTER_AGENTS_METHOD,
  ROSTER_CHECK_ALIAS_METHOD,
  ROSTER_CHECK_NAME_METHOD,
  ROSTER_CREATE_METHOD,
  ROSTER_LAUNCH_SPEC_METHOD,
  ROSTER_LIST_METHOD,
  ROSTER_MEMORY_METHOD,
  ROSTER_PERMISSIONS_METHOD,
  ROSTER_PROJECTS_FOR_METHOD,
  type AliasCheck,
  type CreateAgentParams,
  type CreateAgentResult,
  ROSTER_UPDATE_PROFILE_METHOD,
  type LaunchSpec,
  type LaunchSpecParams,
  type NameVerdict,
  type RosterAgentsForResult,
  type RosterProjectsForResult,
} from "../../shared/roster.ts";
import {
  SESSIONS_FIND_METHOD,
  SESSIONS_GET_METHOD,
  SESSIONS_LAST_MESSAGE_METHOD,
  SESSIONS_LIST_METHOD,
  SESSIONS_MOVE_METHOD,
  SESSIONS_OF_TAB_METHOD,
  SESSIONS_OPEN_METHOD,
  SESSION_NAME_MAX,
  SESSIONS_RENAME_METHOD,
  SESSIONS_SET_STATUS_METHOD,
  SESSION_NOTE_MAX,
  isSessionStatus,
  type Session,
  type SessionsFindParams,
  type SessionsFindResult,
  type SessionsGetResult,
  type SessionsLastMessageResult,
  type SessionsOfTabResult,
  type SessionsOpenResult,
  type SessionsSince,
  type SessionsUpdated,
} from "../../shared/sessions.ts";
import { SESSIONS_AGENT_COUNTS_METHOD, agentCounts, type AgentCountsAnswer } from "../../shared/work-sessions.ts";
import type { RealPath } from "../core/real-paths.ts";
import type { BoundTabs } from "../sessions/bound-tabs.ts";
import { agentsFor, projectsFor, type ProjectReads } from "../roster/connections.ts";
import { launchSpec } from "../roster/launch-spec.ts";
import { checkProfileEdit } from "../roster/profile-edit.ts";
import { enabledModes, resolveConfigDir, type Roster } from "../roster/roster.ts";
import { liveSessions, repoSessions } from "../sessions/for-git.ts";
import { foundSessions } from "../sessions/for-runner.ts";
import type { LiveNow } from "../sessions/live-now.ts";
import type { LiveState } from "../sessions/live-state.ts";
import type { SessionData } from "../sessions/session-data.ts";
import { SETTINGS_SET_SKILL_FOLDERS_METHOD, SKILLS_CATALOG_METHOD } from "../../shared/skills.ts";
import type { SkillsCatalogService } from "../roster/skills-catalog.ts";

export interface ApiSources {
  info: AppInfo;
  sessions: Pick<SessionData, "answer" | "list" | "get" | "changeStatus" | "rename" | "moveToProject">;
  live: Pick<LiveState, "entries">;
  /** The agent tabs Pomade lists and the session each names (`bound-tabs.ts`). */
  tabs: Pick<BoundTabs, "ofTab">;
  liveNow: Pick<LiveNow, "answer">;
  realPath: RealPath;
  roster: Pick<Roster, "answer" | "list" | "agent" | "updateProfile" | "permissions" | "memory">;
  /** Pomade's projects, through the connection the API is served on. */
  projects: ProjectReads;
  /** Open / Resume the session, through the connection the API is served on (`open.ts`). */
  open: (id: string) => Promise<SessionsOpenResult>;
  /** The skill folders and the skills catalog (`skills-catalog.ts`). */
  skills: Pick<SkillsCatalogService, "read" | "setFolders">;
  /** Creating agents (`create-agent.ts`), its progress published as `roster.creating`; absent or
   *  `null` when no profiles are kept (no workspace open). */
  creation?: AgentCreationSource | null;
}

/** What the creation methods are answered from. */
export interface AgentCreationSource {
  checkName(name: string): Promise<NameVerdict>;
  create(params: CreateAgentParams): Promise<CreateAgentResult>;
  checkAlias(agent: string, folder: string): Promise<AliasCheck>;
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

/** An ISO 8601 date and time. */
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function timeOf(params: Params, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || !ISO_TIME.test(value) || Number.isNaN(Date.parse(value))) throw new HostError("invalid-params", `"${key}" must be an ISO 8601 time`);
  return value;
}

function findParams(raw: unknown): SessionsFindParams {
  const params = paramsOf(raw);
  const { cwd, agent } = params;
  if (typeof cwd !== "string" || !cwd.startsWith("/") || /[\r\n\0]/.test(cwd)) throw new HostError("invalid-params", '"cwd" must be an absolute folder');
  const startedFrom = timeOf(params, "startedFrom");
  const startedTo = timeOf(params, "startedTo");
  if (Date.parse(startedFrom) > Date.parse(startedTo)) throw new HostError("invalid-params", '"startedFrom" must not be after "startedTo"');
  if (agent !== undefined && (typeof agent !== "string" || agent === "")) throw new HostError("invalid-params", '"agent" must be a roster id');
  return agent === undefined ? { cwd, startedFrom, startedTo } : { cwd, startedFrom, startedTo, agent };
}

/** A provider's session id: what `--resume` and `codex resume` take. */
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function nameOf(params: Params, key: string, what: string): string {
  const value = params[key];
  if (typeof value !== "string" || value === "") throw new HostError("invalid-params", `"${key}" must be ${what}`);
  return value;
}

function launchSpecParams(raw: unknown): LaunchSpecParams {
  const params = paramsOf(raw);
  const out: LaunchSpecParams = { agent: nameOf(params, "agent", "a roster id"), mode: nameOf(params, "mode", "a mode id") };
  const { resume, sessionId, prompt } = params;
  if (resume !== undefined) {
    if (typeof resume !== "string" || !SESSION_ID.test(resume)) throw new HostError("invalid-params", '"resume" must be a session id');
    out.resume = resume;
  }
  if (sessionId !== undefined) {
    if (typeof sessionId !== "string" || !UUID.test(sessionId)) throw new HostError("invalid-params", '"sessionId" must be a UUID');
    if (out.resume !== undefined) throw new HostError("invalid-params", '"resume" and "sessionId" cannot go together');
    out.sessionId = sessionId;
  }
  if (prompt !== undefined) {
    if (typeof prompt !== "string" || prompt.trim() === "" || prompt.length > AGENT_PROMPT_MAX || prompt.includes("\0")) {
      throw new HostError("invalid-params", `"prompt" must be a non-empty text of at most ${AGENT_PROMPT_MAX} characters`);
    }
    out.prompt = prompt;
  }
  return out;
}

/** The longest text `roster.checkName` looks at: anything longer is refused by its rules anyway. */
const NAME_PARAM_MAX = 256;
const ROLE_MAX = 200;
const TAG_MAX = 40;
const TAGS_MAX = 20;
const PROJECTS_MAX = 200;

const isOneLine = (v: unknown, max: number): v is string => typeof v === "string" && v.trim() !== "" && v.length <= max && !/[\r\n\0]/.test(v);

function checkNameParams(raw: unknown): string {
  const { name } = paramsOf(raw);
  if (typeof name !== "string" || name.length > NAME_PARAM_MAX) throw new HostError("invalid-params", `"name" must be a text of at most ${NAME_PARAM_MAX} characters`);
  return name;
}

function createParams(raw: unknown): CreateAgentParams {
  const params = paramsOf(raw);
  const { name, role, tags, projects, createId } = params;
  if (typeof name !== "string" || name.length > NAME_PARAM_MAX) throw new HostError("invalid-params", `"name" must be a text of at most ${NAME_PARAM_MAX} characters`);
  if (!isOneLine(role, ROLE_MAX)) throw new HostError("invalid-params", `"role" must be one line of at most ${ROLE_MAX} characters`);
  if (!Array.isArray(tags) || tags.length > TAGS_MAX || !tags.every((t) => isOneLine(t, TAG_MAX))) {
    throw new HostError("invalid-params", `"tags" must be at most ${TAGS_MAX} one-line tags of at most ${TAG_MAX} characters`);
  }
  if (!Array.isArray(projects) || projects.length > PROJECTS_MAX || !projects.every((p) => typeof p === "string" && p !== "")) {
    throw new HostError("invalid-params", '"projects" must be a list of project ids');
  }
  if (typeof createId !== "string" || createId === "" || createId.length > 128) throw new HostError("invalid-params", '"createId" must be an id');
  return { name, role: role.trim(), tags: [...new Set(tags.map((t) => t.trim()))], projects: projects as string[], createId };
}

/** The kit's contract shapes are interfaces, which TypeScript does not take for JSON values; they hold only JSON. */
const json = (value: SessionsForRepoResult | SessionsLiveInResult): JsonValue => value as unknown as JsonValue;

export function createApi({ info, sessions, live, tabs, liveNow, realPath, roster, projects, open, skills, creation }: ApiSources): Record<string, ApiHandler> {
  const updated = async (changed: Promise<SessionsUpdated["sessions"]>): Promise<SessionsUpdated> => ({ sessions: await changed });
  /** The session `{ id }` names; `not-found` when no transcript of it is known. */
  const sessionOf = (raw: unknown): Session => {
    const id = idOf(paramsOf(raw).id, "id");
    const session = sessions.get(id);
    if (session === undefined) throw new HostError("not-found", `No session ${JSON.stringify(id)}`);
    return session;
  };
  /** The agent `{ agent }` names, when the roster answers for it and it is not an orphan. */
  const agentOf = (id: string): NonNullable<ReturnType<Roster["agent"]>> => {
    const agent = roster.agent(id);
    if (agent === undefined || agent.orphan) throw new HostError("not-found", `No agent ${JSON.stringify(id)} in the roster`);
    return agent;
  };
  const listedIds = (): string[] => roster.list().map((a) => a.id);
  const creating = (): AgentCreationSource => {
    if (creation === undefined || creation === null) throw new HostError("not-ready", "No agent profiles are kept (no workspace is open), so agents cannot be created");
    return creation;
  };
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
    [SESSIONS_GET_METHOD]: (raw): SessionsGetResult => ({ session: sessionOf(raw) }),
    [SESSIONS_LAST_MESSAGE_METHOD]: (raw): SessionsLastMessageResult => ({ message: sessionOf(raw).summary.lastAnswer }),
    [SESSIONS_FIND_METHOD]: async (raw): Promise<SessionsFindResult> => ({ sessions: await foundSessions(sessions.list(), findParams(raw), realPath) }),
    [SESSIONS_OPEN_METHOD]: (raw) => open(idOf(paramsOf(raw).id, "id")),
    [LIVE_NOW_LIST_METHOD]: () => liveNow.answer(),
    [ROSTER_LIST_METHOD]: () => ({ agents: roster.list() }) as unknown as JsonValue,
    [ROSTER_LAUNCH_SPEC_METHOD]: (raw): LaunchSpec => {
      const params = launchSpecParams(raw);
      const { profile } = agentOf(params.agent);
      const built = launchSpec({ command: profile.command, provider: profile.provider, modes: enabledModes(profile) }, params);
      if (!built.ok) throw new HostError("invalid-params", built.problem);
      return built.spec;
    },
    [ROSTER_PROJECTS_FOR_METHOD]: async (raw): Promise<RosterProjectsForResult> => {
      const agent = nameOf(paramsOf(raw), "agent", "a roster id");
      if (roster.agent(agent) === undefined) throw new HostError("not-found", `No agent ${JSON.stringify(agent)} in the roster`);
      return { projects: await projectsFor(agent, listedIds(), projects) };
    },
    [ROSTER_AGENTS_FOR_METHOD]: async (raw): Promise<RosterAgentsForResult> => ({
      agents: await agentsFor(nameOf(paramsOf(raw), "project", "a project id"), listedIds(), projects),
    }),
    [ROSTER_AGENTS_METHOD]: () => roster.answer(),
    [SESSIONS_OF_TAB_METHOD]: (raw): SessionsOfTabResult => {
      const tabId = paramsOf(raw).tabId;
      if (typeof tabId !== "string" || tabId === "") throw new HostError("invalid-params", '"tabId" must be a tab id');
      const tab = tabs.ofTab(tabId);
      if (tab === null) return { agentTab: false, session: null };
      return { agentTab: true, session: tab.sessionId === null ? null : (sessions.get(tab.sessionId) ?? null) };
    },
    [SESSIONS_AGENT_COUNTS_METHOD]: (raw): AgentCountsAnswer => {
      const params = paramsOf(raw);
      const windows = { weekFrom: timeOf(params, "weekFrom"), projectsFrom: timeOf(params, "projectsFrom") };
      const { epoch, revision, indexing, sessions: all } = sessions.answer();
      return { epoch, revision, indexing, agents: agentCounts(all, windows) };
    },
    [SKILLS_CATALOG_METHOD]: () => skills.read(),
    [SETTINGS_SET_SKILL_FOLDERS_METHOD]: (raw) => {
      const { folders } = paramsOf(raw);
      if (!Array.isArray(folders) || !folders.every((f) => typeof f === "string")) throw new HostError("invalid-params", '"folders" must be a list of workspace-relative folders');
      return skills.setFolders(folders as string[]);
    },
    [ROSTER_CHECK_NAME_METHOD]: (raw) => creating().checkName(checkNameParams(raw)),
    [ROSTER_CREATE_METHOD]: (raw) => creating().create(createParams(raw)),
    [ROSTER_CHECK_ALIAS_METHOD]: (raw) => {
      const agent = nameOf(paramsOf(raw), "agent", "a roster id");
      const facts = roster.agent(agent);
      const folder = facts === undefined || facts.orphan || facts.profile.kind !== "folder" ? null : resolveConfigDir(facts.profile.configDir, null, info.workspace);
      if (folder === null) throw new HostError("not-found", `No folder agent ${JSON.stringify(agent)} in the roster`);
      return creating().checkAlias(agent, folder);
    },
    [ROSTER_UPDATE_PROFILE_METHOD]: async (raw) => {
      const params = paramsOf(raw);
      const checked = checkProfileEdit(params.role, params.tags);
      if (!checked.ok) throw new HostError("invalid-params", checked.problem);
      return { profile: await roster.updateProfile(nameOf(params, "agent", "a roster id"), checked.edit) } as unknown as JsonValue;
    },
    [ROSTER_PERMISSIONS_METHOD]: async (raw) => (await roster.permissions(nameOf(paramsOf(raw), "agent", "a roster id"))) as unknown as JsonValue,
    [ROSTER_MEMORY_METHOD]: async (raw) => (await roster.memory(nameOf(paramsOf(raw), "agent", "a roster id"))) as unknown as JsonValue,
  };
}
