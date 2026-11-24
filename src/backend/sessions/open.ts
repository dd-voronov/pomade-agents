// Open / Resume (DESIGN §2.1; `sessions.open`): the user is back in a session in one action.
//
// - A session bound to an agent tab Pomade lists (`Session.tab`) → that tab is focused
//   (`agentTabs.focus`); a tab that left the list meanwhile is resumed past.
// - A session running unattended in a Runner agent run, with no tab → the run's attached terminal
//   opens (`tabs.openAttached`); a second agent on the transcript would interleave it.
// - Otherwise → it resumes in a new agent tab (`agentTabs.resume`) with its agent, in the first
//   project it shows in (the Workspace project when none) and its start folder, workspace-relative
//   — the folder its agent's store keys it by. A status other than Active then becomes Active
//   through `SessionData.changeStatus`.
//
// A refusal changes nothing: an unknown session, a session with no messages (hidden as empty; its
// bound tab is still focused), an agent the roster does not answer for, a start
// folder outside the workspace and Pomade's own refusals (the transcript is not where the agent
// looks) are errors with a message in plain words; Pomade's own words follow " — ".

import { relative, sep } from "node:path";

import { WORKSPACE_PROJECT_ID, type AgentTabsResumeParams, type OpenAttachedParams } from "pomade-kit/protocol";
import { HostError } from "pomade-kit/sdk";

import { RUNNER_APP_ID } from "../../shared/runner-events.ts";
import type { Session, SessionsOpenResult } from "../../shared/sessions.ts";
import type { RealPath } from "../core/real-paths.ts";
import type { Roster } from "../roster/roster.ts";
import type { LiveState } from "./live-state.ts";
import type { SessionData } from "./session-data.ts";

/** What the open needs of the connected Pomade. */
export interface OpenHost {
  focus(tabId: string): Promise<void>;
  resume(params: AgentTabsResumeParams): Promise<{ tabId: string }>;
  openAttached(params: OpenAttachedParams): Promise<void>;
}

export interface OpenSources {
  sessions: Pick<SessionData, "get" | "changeStatus">;
  live: Pick<LiveState, "entries">;
  roster: Pick<Roster, "agent">;
  /** The workspace's root as Pomade names it and with symlinks resolved; `null` without one. */
  workspace: string | null;
  workspaceReal: string | null;
  realPath: RealPath;
  log: (line: string) => void;
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** `folder` relative to `root` when it is `root` or inside it; `null` otherwise. */
function inside(folder: string, root: string): string | null {
  const rel = relative(root, folder);
  if (rel === "") return "";
  return rel.startsWith("..") || rel.startsWith(sep) ? null : rel.split(sep).join("/");
}

/** The start folder workspace-relative, as `agentTabs.resume` takes it; `undefined` with none recorded. */
async function folderOf(session: Session, { workspace, workspaceReal, realPath }: OpenSources): Promise<string | undefined> {
  const cwd = session.summary.cwd;
  if (cwd === null) return undefined;
  const roots = [...new Set([workspace, workspaceReal].filter((root) => root !== null))];
  if (roots.length === 0) throw new HostError("not-ready", "No workspace is open in Pomade.");
  for (const root of roots) {
    const rel = inside(cwd, root);
    if (rel !== null) return rel;
  }
  const real = await realPath(cwd);
  for (const root of roots) {
    const rel = inside(real, await realPath(root));
    if (rel !== null) return rel;
  }
  throw new HostError("outside-workspace", `It started outside the workspace, in ${cwd}; Pomade resumes sessions only inside it.`);
}

export async function openSession(id: string, host: OpenHost, sources: OpenSources): Promise<SessionsOpenResult> {
  const { sessions, live, roster, log } = sources;
  const now = (): Session => {
    const session = sessions.get(id);
    if (session === undefined) throw new HostError("not-found", "Its transcript is gone.");
    return session;
  };
  const session = now();

  if (session.tab !== null) {
    try {
      await host.focus(session.tab.tabId);
      return { opened: "tab", tabId: session.tab.tabId, session: now() };
    } catch (err) {
      // The tab closed since Pomade last said so: the session resumes instead.
      if (!(err instanceof HostError && err.code === "not-found")) throw err;
    }
  }

  const run = live.entries().find((entry) => entry.source === "run" && entry.sessionId === id);
  if (run !== undefined) {
    if (run.terminal === null) throw new HostError("not-ready", `It runs unattended in Runner job “${run.job ?? run.agent}”, and Runner did not say which terminal it runs in.`);
    await host.openAttached({ session: { app: RUNNER_APP_ID, session: run.terminal }, ...(run.job === null ? {} : { title: run.job }), projectId: run.projectId });
    return { opened: "run", tabId: null, session: now() };
  }

  // A session holding no message (`hidden: "empty"`, a file only a `/clear` wrote) has nothing to resume.
  if (session.hidden === "empty") throw new HostError("not-found", "It holds no messages, so there is nothing to resume.");
  const agent = roster.agent(session.summary.agent);
  if (agent === undefined || agent.orphan) throw new HostError("not-found", `Its agent “${session.summary.agent}” is not in the roster.`);
  const cwd = await folderOf(session, sources);
  const params: AgentTabsResumeParams = {
    agentId: session.summary.agent,
    sessionId: id,
    projectId: session.attribution.projects[0] ?? WORKSPACE_PROJECT_ID,
    ...(cwd === undefined ? {} : { cwd }),
  };
  let tabId: string;
  try {
    ({ tabId } = await host.resume(params));
  } catch (err) {
    if (err instanceof HostError) {
      const plain = err.code === "not-found" ? "Pomade did not find it in its agent's store" : "Pomade could not resume it";
      throw new HostError(err.code, `${plain} — ${err.message}`);
    }
    throw err;
  }

  const status = session.record?.status;
  if (status !== undefined && status !== "active") {
    try {
      await sessions.changeStatus([id], "active");
    } catch (err) {
      log(`sessions: resumed ${id} but could not set it Active: ${message(err)}`);
    }
  }
  return { opened: "resumed", tabId, session: now() };
}
