// Runs the app's built command the way Pomade's shim does (HOST-API §2 "Commands"): the entry on
// Node with the app's identity — `POMADE_HOME`, `POMADE_APP_ID`, `POMADE_APP_KEY_FILE`,
// `POMADE_CLIENT=command`, `POMADE_APP_STATE` — and what a Pomade terminal adds: `POMADE_WORKSPACE`,
// `POMADE_TAB_ID`, `POMADE_PROJECT_ID`. Like the real shim it gives no `POMADE_SOCKET`: the command
// finds the socket in `<POMADE_HOME>/host.json`, which `shimHome` writes for the sandbox.

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { HOME_FILES, POMADE_ENV } from "pomade-kit/protocol";

import type { Sandbox } from "./sandbox.ts";

export interface CommandRun {
  /** The exit status; `null` when a signal ended it. */
  code: number | null;
  stdout: string;
  stderr: string;
}

/** The Pomade home a shim names: `<root>/pomade-home` holding `host.json` (the sandbox's socket)
 *  and the workspace pointer. */
export async function shimHome(sandbox: Sandbox): Promise<string> {
  const home = join(sandbox.root, "pomade-home");
  await mkdir(join(home, HOME_FILES.bin), { recursive: true });
  await writeFile(join(home, HOME_FILES.host), JSON.stringify({ socket: sandbox.socketPath, launch: { argv: ["/usr/bin/false"], env: {} } }));
  await writeFile(join(home, HOME_FILES.workspace), `${sandbox.workspace}\n`);
  return home;
}

/** The environment a shim gives `appId`'s command run in the terminal of tab `tabId` (none: outside Pomade's terminals). */
export function shimEnv(sandbox: Sandbox, appId: string, pomadeHome: string, terminal: { tabId: string; projectId: string } | null): Record<string, string> {
  return {
    HOME: sandbox.home,
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    LANG: "en_US.UTF-8",
    TMPDIR: join(sandbox.root, "tmp"),
    [POMADE_ENV.home]: pomadeHome,
    [POMADE_ENV.appId]: appId,
    [POMADE_ENV.keyFile]: join(sandbox.userData, "app-keys", appId),
    [POMADE_ENV.role]: "command",
    [POMADE_ENV.appState]: join(sandbox.userData, "app-state", appId),
    ...(terminal === null ? {} : { [POMADE_ENV.workspace]: sandbox.workspace, POMADE_TAB_ID: terminal.tabId, POMADE_PROJECT_ID: terminal.projectId }),
  };
}

/** Run the built command `entry` with `args` in `env`; resolves when it exits (killed after 20 s). */
export function runCommand(entry: string, args: readonly string[], env: Readonly<Record<string, string | undefined>>): Promise<CommandRun> {
  return new Promise((resolve) => {
    execFile(process.execPath, [entry, ...args], { env: env as NodeJS.ProcessEnv, timeout: 20_000, encoding: "utf8" }, (err, stdout, stderr) => {
      const code = err === null ? 0 : typeof err.code === "number" ? err.code : null;
      resolve({ code, stdout, stderr });
    });
  });
}
