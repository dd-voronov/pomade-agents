// The backend process's life: record the run, index the agents' session stores, keep the session
// records and the roster, stay connected to Pomade over its socket — following its projects and agent tabs, which
// are what runs now — serve the app's API on every connection and publish its session events
// (HOST-API §2 "Backends"). Pomade starts it with the app and stops it with SIGTERM; a requested
// stop publishes the status changes still inside their window first.

import type { HostClient } from "pomade-kit/sdk";
import { stayConnected } from "pomade-kit/node";

import type { AppInfo } from "../../shared/api.ts";
import { STATUS_WINDOW_MS } from "../../shared/session-events.ts";
import { ROSTER_CHANGED_EVENT } from "../../shared/roster.ts";
import { SESSIONS_CHANGED_EVENT } from "../../shared/sessions.ts";
import { createApi } from "../interfaces/api.ts";
import { followPomade } from "../interfaces/platform.ts";
import { openRecordStore, type RecordStore } from "../records/record-store.ts";
import type { ProjectReads } from "../roster/connections.ts";
import { startRoster } from "../roster/roster.ts";
import { createLiveState, followTabs } from "../sessions/live-state.ts";
import { startSessionData } from "../sessions/session-data.ts";
import { startSessionEvents } from "../sessions/session-events.ts";
import { startSessionStore } from "../stores/session-store.ts";
import { resolveHome, resolveLocations, type Env } from "./locations.ts";
import { createRealPaths } from "./real-paths.ts";
import { removeRunRecord, writeRunRecord } from "./run-record.ts";

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
  const info: AppInfo = { version, startedAt, ...locations };
  await writeRunRecord(locations.stateDir, { pid, version, startedAt });
  log(`${appId} ${version} started (pid ${pid}); workspace ${locations.workspace ?? "none"}; state ${locations.stateDir}`);

  const home = resolveHome(env);
  const store = await startSessionStore({
    home,
    workspace: locations.workspace,
    stateDir: locations.stateDir,
    log,
  });

  let records: RecordStore | null = null;
  let noRecords = "No workspace is open in Pomade, so session records are not kept.";
  let noProfiles = "No workspace is open in Pomade, so agent profiles are not kept.";
  if (locations.dataDir !== null) {
    try {
      records = await openRecordStore({ dataDir: locations.dataDir, now: options.now, log });
    } catch (err) {
      noRecords = `The session records in ${locations.dataDir} cannot be read (${message(err)}), so they are not kept.`;
      noProfiles = `The agent profiles in ${locations.dataDir} cannot be read (${message(err)}), so they are not kept.`;
      log(noRecords);
    }
  }
  const roster = startRoster({ home, workspace: locations.workspace, profiles: records?.profiles ?? null, noProfiles, log });
  // Pomade asks for the roster the moment the backend serves: it answers whole from the start.
  await roster.refresh();
  const live = createLiveState(options.now);
  const tabs = followTabs(live);
  const sessions = startSessionData({ summaries: store, records, noRecords, live, now: options.now, log });
  const realPath = createRealPaths();

  // The UI frames subscribe to the app's own `sessions.changed`; the backend publishes it to them
  // through whichever Pomade connection is up.
  let host: HostClient | null = null;
  sessions.onChange((changed) => {
    host?.events.publish(SESSIONS_CHANGED_EVENT, changed).catch((err: unknown) => log(`could not publish ${SESSIONS_CHANGED_EVENT}: ${message(err)}`));
  });
  roster.onChange((changed) => {
    host?.events.publish(ROSTER_CHANGED_EVENT, changed).catch((err: unknown) => log(`could not publish ${ROSTER_CHANGED_EVENT}: ${message(err)}`));
  });
  // Events B and C go to other apps through the connection that is up when they are due.
  const events = startSessionEvents({
    sessions,
    publish: async (name, payload) => {
      if (host === null) throw new Error("Pomade is not connected");
      await host.events.publish(name, payload);
    },
    realPath,
    windowMs: STATUS_WINDOW_MS,
    now: options.now,
    log,
  });

  const connection = stayConnected(
    { env, role: "backend" },
    {
      onConnect(connected) {
        host = connected;
        log(`connected to Pomade ${connected.welcome.pomadeVersion}`);
        connected.api.serve(createApi({ info, sessions, live, realPath, roster, projects: projectReads(connected) })).then(
          ({ methods }) => log(`serving ${methods.join(", ")}`),
          (err: unknown) => log(`could not serve the API: ${message(err)}`),
        );
        followPomade(
          connected,
          {
            setProjects: (projects) => sessions.setProjects(projects),
            bind: (sessionId, projectId) => sessions.bind(sessionId, projectId),
            listTabs: (list) => tabs.list(list),
            tabChanged: (tab, closed) => tabs.changed(tab, closed),
            tabExited: (exited) => events.tabExited(exited),
          },
          { workspace: locations.workspace, log },
        );
      },
      onDisconnect() {
        host = null;
        // Pomade's agents end with it; a Pomade that comes back lists its tabs again.
        tabs.list([]);
        log("Pomade went away; reconnecting");
      },
      onRejected(reason) {
        log(`Pomade refused the connection: ${reason}`);
      },
    },
  );

  return {
    async stop() {
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
