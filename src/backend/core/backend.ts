// The backend process's life: record the run, index the agents' session stores, keep the session
// records and the roster, stay connected to Pomade over its socket — following its projects, its agent tabs
// (what runs now, which session each is bound to, and their titles, which are the sessions' names) and Runner's agent runs — serve the app's API on every connection and publish its session events
// (HOST-API §2 "Backends"). Pomade starts it with the app and stops it with SIGTERM; a requested
// stop publishes the status changes still inside their window first.

import { realpath } from "node:fs/promises";
import { join, relative } from "node:path";

import type { HostClient } from "pomade-kit/sdk";
import { stayConnected } from "pomade-kit/node";

import type { AppInfo } from "../../shared/api.ts";
import { STATUS_WINDOW_MS } from "../../shared/session-events.ts";
import { ROSTER_CHANGED_EVENT, ROSTER_CREATING_EVENT, type RosterCreating } from "../../shared/roster.ts";
import { SESSIONS_CHANGED_EVENT } from "../../shared/sessions.ts";
import { LIVE_NOW_CHANGED_EVENT, LIVE_NOW_ICON } from "../../shared/live-now.ts";
import { createApi, type AgentCreationSource } from "../interfaces/api.ts";
import { followPomade } from "../interfaces/platform.ts";
import { SETTINGS_FILE, openRecordStore, type RecordStore } from "../records/record-store.ts";
import type { ProjectReads } from "../roster/connections.ts";
import { createAgentCreation } from "../roster/create-agent.ts";
import { rcFileOf, zshOf } from "../roster/shell.ts";
import { resolveConfigDir, startRoster } from "../roster/roster.ts";
import { keepBadge, startLiveNow } from "../sessions/live-now.ts";
import { createBoundTabs } from "../sessions/bound-tabs.ts";
import { createLiveState, followTabs } from "../sessions/live-state.ts";
import { openSession } from "../sessions/open.ts";
import { startRunnerRuns } from "../sessions/runner-runs.ts";
import { startSessionData } from "../sessions/session-data.ts";
import { startSessionEvents } from "../sessions/session-events.ts";
import { startTabTitles } from "../sessions/tab-titles.ts";
import { startSessionStore } from "../stores/session-store.ts";
import { resolveHome, resolveLocations, type Env } from "./locations.ts";
import { createRealPaths } from "./real-paths.ts";
import { removeRunRecord, writeRunRecord } from "./run-record.ts";
import { startSkillFolderSettings } from "../settings/settings.ts";
import { startSkillsCatalog } from "../roster/skills-catalog.ts";
import { SKILLS_CHANGED_EVENT } from "../../shared/skills.ts";

export interface BackendOptions {
  appId: string;
  version: string;
  /** The environment Pomade started the process with. */
  env: Env;
  pid: number;
  now: () => Date;
  log: (line: string) => void;
}

export interface Backend {
  /** Close the connection, stop watching the stores and the records, and remove the run record. */
  stop(): Promise<void>;
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The project ↔ agent connection as the connected Pomade stores it. */
const projectReads = (host: HostClient): ProjectReads => ({
  projects: async () => (await host.project.list()).projects.map((p) => p.id),
  visibleAgents: async (projectId) => (await host.project.getAgents({ projectId })).visibleAgents,
});

export async function startBackend(options: BackendOptions): Promise<Backend> {
  const { appId, version, env, pid, log } = options;
  const locations = resolveLocations(env, appId);
  const startedAt = options.now().toISOString();
  const workspaceReal = locations.workspace === null ? null : await realpath(locations.workspace).catch(() => locations.workspace);
  const info: AppInfo = { version, startedAt, ...locations, workspaceReal };
  await writeRunRecord(locations.stateDir, { pid, version, startedAt });
  log(`${appId} ${version} started (pid ${pid}); workspace ${locations.workspace ?? "none"}; state ${locations.stateDir}`);

  const home = resolveHome(env);
  let records: RecordStore | null = null;
  let noRecords = "No workspace is open in Pomade, so session records are not kept.";
  let noProfiles = "No workspace is open in Pomade, so agent profiles are not kept.";
  let noFolders = "No workspace is open in Pomade, so the skill folders cannot be changed.";
  if (locations.dataDir !== null) {
    try {
      records = await openRecordStore({ dataDir: locations.dataDir, now: options.now, log });
    } catch (err) {
      noRecords = `The session records in ${locations.dataDir} cannot be read (${message(err)}), so they are not kept.`;
      noProfiles = `The agent profiles in ${locations.dataDir} cannot be read (${message(err)}), so they are not kept.`;
      noFolders = `The app data in ${locations.dataDir} cannot be read (${message(err)}), so the skill folders cannot be changed.`;
      log(noRecords);
    }
  }
  const roster = startRoster({ home, workspace: locations.workspace, profiles: records?.profiles ?? null, noProfiles, log });
  // Pomade asks for the roster the moment the backend serves: it answers whole from the start.
  await roster.refresh();
  // A session's agent is the agent whose profile holds its store: the roster says which, and when that changes.
  const store = await startSessionStore({
    home,
    workspace: locations.workspace,
    stateDir: locations.stateDir,
    agents: { agentOf: (root) => roster.storeAgent(root), onChange: (listener) => roster.onChange(() => listener()) },
    log,
  });
  const live = createLiveState(options.now);
  const tabs = followTabs(live);
  const bound = createBoundTabs();
  const realPath = createRealPaths();
  const sessions = startSessionData({ summaries: store, records, noRecords, live, tabs: bound, realPath, now: options.now, log });
  const liveNow = startLiveNow({ live, sessions, roster });
  const badge = keepBadge(liveNow, log);

  // The UI frames subscribe to the app's own `sessions.changed`; the backend publishes it to them
  // through whichever Pomade connection is up.
  let host: HostClient | null = null;
  sessions.onChange((changed) => {
    host?.events.publish(SESSIONS_CHANGED_EVENT, changed).catch((err: unknown) => log(`could not publish ${SESSIONS_CHANGED_EVENT}: ${message(err)}`));
  });
  roster.onChange((changed) => {
    host?.events.publish(ROSTER_CHANGED_EVENT, changed).catch((err: unknown) => log(`could not publish ${ROSTER_CHANGED_EVENT}: ${message(err)}`));
  });
  liveNow.onChange((changed) => {
    host?.events.publish(LIVE_NOW_CHANGED_EVENT, changed).catch((err: unknown) => log(`could not publish ${LIVE_NOW_CHANGED_EVENT}: ${message(err)}`));
  });
  // Events B and C go to other apps through the connection that is up when they are due.
  const events = startSessionEvents({
    sessions,
    live,
    publish: async (name, payload) => {
      if (host === null) throw new Error("Pomade is not connected");
      await host.events.publish(name, payload);
    },
    realPath,
    windowMs: STATUS_WINDOW_MS,
    now: options.now,
    log,
  });
  const runs = startRunnerRuns({ live, sessions, events, realPath, log });
  const titles = startTabTitles({ sessions, log });
  const skillFolders = startSkillFolderSettings({
    store: records,
    off: noFolders,
    workspace: locations.workspace,
    workspaceReal,
    settingsPath: locations.dataDir === null || locations.workspace === null ? null : relative(locations.workspace, join(locations.dataDir, SETTINGS_FILE)),
  });
  const skills = startSkillsCatalog({ workspace: locations.workspace, workspaceReal, home, settings: skillFolders, roster });
  skills.onChange((changed) => {
    host?.events.publish(SKILLS_CHANGED_EVENT, changed).catch((err: unknown) => log(`could not publish ${SKILLS_CHANGED_EVENT}: ${message(err)}`));
  });
  const creation = agentCreation();

  const connection = stayConnected(
    { env, role: "backend" },
    {
      onConnect(connected) {
        host = connected;
        log(`connected to Pomade ${connected.welcome.pomadeVersion}`);
        titles.connect((tabId, title) => connected.agentTabs.setTitle(tabId, title));
        const open = (id: string) =>
          openSession(
            id,
            {
              focus: (tabId) => connected.agentTabs.focus(tabId),
              resume: (params) => connected.agentTabs.resume(params),
              openAttached: (params) => connected.tabs.openAttached(params),
            },
            { sessions, live, roster, workspace: info.workspace, workspaceReal: info.workspaceReal, realPath, log },
          );
        connected.api.serve(createApi({ info, sessions, live, tabs: bound, liveNow, realPath, roster, projects: projectReads(connected), open, skills, creation })).then(
          ({ methods }) => log(`serving ${methods.join(", ")}`),
          (err: unknown) => log(`could not serve the API: ${message(err)}`),
        );
        badge.connected((count) => connected.strip.setBadge({ icon: LIVE_NOW_ICON, count, urgent: true }));
        followPomade(
          connected,
          {
            setProjects: (projects) => sessions.setProjects(projects),
            bind: (sessionId, projectId) => sessions.bind(sessionId, projectId),
            listTabs: (list) => {
              tabs.list(list);
              bound.list(list);
              titles.list(list);
            },
            tabChanged: (tab, changes) => {
              tabs.changed(tab, changes.includes("closed"));
              bound.changed(tab, changes.includes("closed"));
              titles.changed(tab, changes);
            },
            tabExited: (exited) => events.tabExited(exited),
            runStarted: (payload) => runs.started(payload),
            runFinished: (payload) => runs.finished(payload),
            ready: () => badge.ready(),
          },
          { workspace: locations.workspace, log },
        );
      },
      onDisconnect() {
        host = null;
        badge.disconnected();
        // Pomade's agents end with it; a Pomade that comes back lists its tabs again. Runner's run
        // finished is not heard while the connection is down, so no run is held across it.
        tabs.list([]);
        bound.list([]);
        titles.connect(null);
        runs.drop();
        log("Pomade went away; reconnecting");
      },
      onRejected(reason) {
        log(`Pomade refused the connection: ${reason}`);
      },
    },
  );

  /** Creating agents needs the workspace and its profiles; the rc file and the shell come from the
   *  environment Pomade started the backend with. Projects are connected and progress published
   *  through whichever Pomade connection is up. */
  function agentCreation(): AgentCreationSource | null {
    if (locations.workspace === null || locations.dataDir === null || records === null) return null;
    const created = createAgentCreation({
      workspace: locations.workspace,
      dataDir: locations.dataDir,
      profiles: records.profiles,
      rosterIds: () => roster.answer().agents.map((a) => a.id),
      refreshRoster: () => roster.refresh(),
      connect: async (projectId, agent) => {
        if (host === null) throw new Error("Pomade is not connected");
        const { visibleAgents } = await host.project.getAgents({ projectId });
        if (visibleAgents.includes("*")) return "offers-all";
        if (!visibleAgents.includes(agent)) await host.project.setAgents({ projectId, visibleAgents: [...visibleAgents, agent] });
        return "connected";
      },
      cloneSource: (id) => {
        const facts = roster.agent(id);
        if (facts === undefined) return `${id} is not in the roster`;
        const { profile, orphan } = facts;
        if (profile.kind !== "folder" || profile.provider !== "claude") return `${id} is not a Claude Code folder agent: only those are cloned`;
        const folder = orphan ? null : resolveConfigDir(profile.configDir, home, locations.workspace);
        return folder === null ? `${id}’s config folder is gone` : { profile, folder };
      },
      launch: async (agent, projectId) => {
        if (host === null) throw new Error("Pomade is not connected");
        return (await host.agentTabs.launch({ agentId: agent, projectId })).tabId;
      },
      rcFile: rcFileOf(env),
      zsh: zshOf(env),
      log,
    });
    return {
      checkName: (name) => created.checkName(name),
      checkAlias: (agent, folder) => created.checkAlias(agent, folder),
      create: (params) =>
        created.create(params, (steps) => {
          const payload: RosterCreating = { createId: params.createId, steps };
          host?.events.publish(ROSTER_CREATING_EVENT, payload).catch((err: unknown) => log(`could not publish ${ROSTER_CREATING_EVENT}: ${message(err)}`));
        }),
    };
  }

  return {
    async stop() {
      runs.stop();
      titles.stop();
      skills.stop();
      skillFolders.stop();
      badge.stop();
      liveNow.stop();
      await events.stop();
      connection.stop();
      sessions.stop();
      roster.stop();
      await records?.stop();
      await store.stop();
      await removeRunRecord(locations.stateDir, pid);
      log("stopped");
    },
  };
}
