// The backend process's life: record the run, index the agents' session stores, stay connected to
// Pomade over its socket, and serve the app's API on every connection (HOST-API §2 "Backends").
// Pomade starts it with the app and stops it with SIGTERM.

import type { HostClient } from "pomade-kit/sdk";
import { stayConnected } from "pomade-kit/node";

import type { AppInfo } from "../../shared/api.ts";
import { SESSIONS_CHANGED_EVENT } from "../../shared/sessions.ts";
import { createApi } from "../interfaces/api.ts";
import { startSessionStore } from "../stores/session-store.ts";
import { resolveHome, resolveLocations, type Env } from "./locations.ts";
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
  /** Close the connection, stop watching the stores and remove the run record. */
  stop(): Promise<void>;
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export async function startBackend(options: BackendOptions): Promise<Backend> {
  const { appId, version, env, pid, log } = options;
  const locations = resolveLocations(env, appId);
  const startedAt = options.now().toISOString();
  const info: AppInfo = { version, startedAt, ...locations };
  await writeRunRecord(locations.stateDir, { pid, version, startedAt });
  log(`${appId} ${version} started (pid ${pid}); workspace ${locations.workspace ?? "none"}; state ${locations.stateDir}`);

  const sessions = await startSessionStore({
    home: resolveHome(env),
    workspace: locations.workspace,
    stateDir: locations.stateDir,
    log,
  });

  // The UI frames subscribe to the app's own `sessions.changed`; the backend publishes it to them
  // through whichever Pomade connection is up.
  let host: HostClient | null = null;
  sessions.onChange((changed) => {
    host?.events.publish(SESSIONS_CHANGED_EVENT, changed).catch((err: unknown) => log(`could not publish ${SESSIONS_CHANGED_EVENT}: ${message(err)}`));
  });

  const connection = stayConnected(
    { env, role: "backend" },
    {
      onConnect(connected) {
        host = connected;
        log(`connected to Pomade ${connected.welcome.pomadeVersion}`);
        connected.api.serve(createApi({ info, sessions })).then(
          ({ methods }) => log(`serving ${methods.join(", ")}`),
          (err: unknown) => log(`could not serve the API: ${message(err)}`),
        );
      },
      onDisconnect() {
        host = null;
        log("Pomade went away; reconnecting");
      },
      onRejected(reason) {
        log(`Pomade refused the connection: ${reason}`);
      },
    },
  );

  return {
    async stop() {
      connection.stop();
      await sessions.stop();
      await removeRunRecord(locations.stateDir, pid);
      log("stopped");
    },
  };
}
