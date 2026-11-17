// Runs the `pomade` command with the given arguments from the repo root: `npm run install-app`
// is `pomade apps install dist`. Which Pomade it reaches is the command's own rule (the dev
// Pomade unless told otherwise, HOST-API §2 "Which Pomade").

import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { findPomadeCommand } from "./pomade-command.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Run `pomade <args>`; returns its exit status. */
export function runPomade(args: string[]): number {
  const command = findPomadeCommand(process.env, ROOT, isFile);
  if (command === null) {
    console.error("pomade: command not found — run this in a Pomade terminal, or set POMADE_BIN to Pomade's bin/pomade");
    return 1;
  }
  const result = spawnSync(command, args, { cwd: ROOT, stdio: "inherit" });
  if (result.error) {
    console.error(`pomade: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = runPomade(process.argv.slice(2));
