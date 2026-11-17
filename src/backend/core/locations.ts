// Where the backend keeps things, resolved from the environment Pomade starts it with
// (HOST-API §2 "Backends"): the workspace from `POMADE_WORKSPACE`, Pomade's user-data folder from
// the socket Pomade gave it (`<userData>/run/pomade.sock`, HOST-API §3 "Socket").

import { basename, dirname, isAbsolute, join } from "node:path";

import { POMADE_ENV } from "pomade-kit/protocol";

export type Env = Readonly<Record<string, string | undefined>>;

export interface Locations {
  /** The open workspace's root; `null` when Pomade has no workspace open. */
  workspace: string | null;
  /** App data, synced with the workspace: `<workspace>/Apps/<appId>`; `null` without a workspace. */
  dataDir: string | null;
  /** Machine-local state: `<userData>/app-state/<appId>`. */
  stateDir: string;
}

const SOCKET_FOLDER = "run";
const STATE_FOLDER = "app-state";
const DATA_FOLDER = "Apps";

function absolute(env: Env, name: string): string | null {
  const value = env[name];
  if (value === undefined || value === "") return null;
  if (!isAbsolute(value)) throw new Error(`${name} must be an absolute path (got ${JSON.stringify(value)})`);
  return value;
}

/** The user's home folder (`HOME`), where the built-in agents' stores are; `null` when unset. */
export function resolveHome(env: Env): string | null {
  return absolute(env, "HOME");
}

/** Throws with a readable message when the environment is not a backend's. */
export function resolveLocations(env: Env, appId: string): Locations {
  const socket = absolute(env, POMADE_ENV.socket);
  if (socket === null) throw new Error(`${POMADE_ENV.socket} is not set: the backend is started by Pomade`);
  const socketFolder = dirname(socket);
  if (basename(socketFolder) !== SOCKET_FOLDER) {
    throw new Error(`${POMADE_ENV.socket} is not in Pomade's "${SOCKET_FOLDER}" folder (got ${JSON.stringify(socket)})`);
  }
  const workspace = absolute(env, POMADE_ENV.workspace);
  return {
    workspace,
    dataDir: workspace === null ? null : join(workspace, DATA_FOLDER, appId),
    stateDir: join(dirname(socketFolder), STATE_FOLDER, appId),
  };
}
