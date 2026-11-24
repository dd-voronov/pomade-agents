// Where the backend keeps things, from the environment Pomade starts it with (HOST-API §2
// "Backends"): the workspace from `POMADE_WORKSPACE`, the machine-local state folder from
// `POMADE_APP_STATE`.

import { isAbsolute, join } from "node:path";

import { POMADE_ENV } from "pomade-kit/protocol";

export type Env = Readonly<Record<string, string | undefined>>;

export interface Locations {
  /** The open workspace's root; `null` when Pomade has no workspace open. */
  workspace: string | null;
  /** App data, synced with the workspace: `<workspace>/Apps/<appId>`; `null` without a workspace. */
  dataDir: string | null;
  /** Machine-local state: `POMADE_APP_STATE` (`<userData>/app-state/<appId>`). */
  stateDir: string;
}

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
  const stateDir = absolute(env, POMADE_ENV.appState);
  if (stateDir === null) throw new Error(`${POMADE_ENV.appState} is not set: the backend is started by Pomade`);
  const workspace = absolute(env, POMADE_ENV.workspace);
  return {
    workspace,
    dataDir: workspace === null ? null : join(workspace, DATA_FOLDER, appId),
    stateDir,
  };
}
