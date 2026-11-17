// The backend process's life: record the run, stay connected to Pomade over its socket, and serve
// the app's API on every connection (HOST-API §2 "Backends"). Pomade starts it with the app and
// stops it with SIGTERM.

import { stayConnected } from "pomade-kit/node";

import type { AppInfo } from "../../shared/api.ts";
import { createApi } from "../interfaces/api.ts";
import { resolveLocations, type Env } from "./locations.ts";
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
  /** Close the connection and remove the run record. */
  stop(): Promise<void>;
}

export async function startBackend(options: BackendOptions): Promise<Backend> {
  const { appId, version, env, pid, log } = options;
  const locations = resolveLocations(env, appId);
  const startedAt = options.now().toISOString();
  const info: AppInfo = { version, startedAt, ...locations };
  await writeRunRecord(locations.stateDir, { pid, version, startedAt });
  log(`${appId} ${version} started (pid ${pid}); workspace ${locations.workspace ?? "none"}; state ${locations.stateDir}`);

  const connection = stayConnected(
    { env, role: "backend" },
    {
      onConnect(host) {
        log(`connected to Pomade ${host.welcome.pomadeVersion}`);
        host.api.serve(createApi(info)).then(
          ({ methods }) => log(`serving ${methods.join(", ")}`),
          (err: unknown) => log(`could not serve the API: ${err instanceof Error ? err.message : String(err)}`),
        );
      },
      onDisconnect() {
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
      await removeRunRecord(locations.stateDir, pid);
      log("stopped");
    },
  };
}
