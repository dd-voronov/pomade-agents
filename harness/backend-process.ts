// Runs the app's backend the way Pomade does: a Node program started in its build folder with a
// backend's environment, stopped with SIGTERM and killed after Pomade's 3 s grace
// (HOST-API §2 "Backends").

import { spawn } from "node:child_process";
import { dirname } from "node:path";

import type { Sandbox } from "./sandbox.ts";

/** How long Pomade waits after SIGTERM before SIGKILL. */
const STOP_GRACE_MS = 3000;

export interface BackendExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** True when the backend ignored SIGTERM for the whole grace period and had to be killed. */
  killed: boolean;
}

export interface BackendProcess {
  readonly pid: number;
  /** Everything it printed so far (stdout and stderr). */
  output(): string;
  /** True until the process has exited. */
  running(): boolean;
  /** SIGTERM, then SIGKILL after the grace period; resolves once it has exited. */
  stop(): Promise<BackendExit>;
}

export interface SpawnBackendOptions {
  /** The backend's entry file; its parent's parent is the build folder it runs in. */
  entry: string;
  /** Extra Node arguments before the entry (`--watch`). */
  nodeArgs?: string[];
  /** Also print its output, prefixed (the dev script). */
  echo?: boolean;
}

export function spawnBackend(sandbox: Sandbox, options: SpawnBackendOptions): BackendProcess {
  const child = spawn(process.execPath, [...(options.nodeArgs ?? []), options.entry], {
    cwd: dirname(dirname(options.entry)),
    env: sandbox.backendEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const { pid } = child;
  if (pid === undefined) throw new Error(`backend: could not start ${options.entry}`);
  let output = "";
  const collect = (chunk: Buffer): void => {
    output += chunk.toString("utf8");
    if (options.echo) process.stdout.write(`[backend] ${chunk.toString("utf8")}`);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  let running = true;
  void exited.then(() => {
    running = false;
  });

  return {
    pid,
    output: () => output,
    running: () => running,
    async stop() {
      let killed = false;
      const kill = setTimeout(() => {
        killed = true;
        child.kill("SIGKILL");
      }, STOP_GRACE_MS);
      if (running) child.kill("SIGTERM");
      const exit = await exited;
      clearTimeout(kill);
      return { ...exit, killed };
    },
  };
}
