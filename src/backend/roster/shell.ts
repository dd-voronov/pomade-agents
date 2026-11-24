// The user's zsh, as a new agent needs it (DESIGN §3.6): its rc file, the alias line a folder agent
// gets there, and a fresh interactive shell asked what a name resolves to.
//
// Everything is taken from the environment it is handed — the backend's, which Pomade gives it
// (and a test sandbox redirects): the rc file is `$ZDOTDIR/.zshrc`, else `$HOME/.zshrc`, as zsh
// itself reads it, and every shell runs with exactly that environment. Nothing here looks at the
// process's own home folder.

import { spawn } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import type { Env } from "../core/locations.ts";

/** How long a fresh interactive zsh may take to answer. */
export const ZSH_TIMEOUT_MS = 15_000;

/** The rc file an interactive zsh reads: `$ZDOTDIR/.zshrc`, else `$HOME/.zshrc`; `null` when
 *  neither is an absolute folder. */
export function rcFileOf(env: Env): string | null {
  for (const name of ["ZDOTDIR", "HOME"]) {
    const value = env[name];
    if (value !== undefined && isAbsolute(value)) return join(value, ".zshrc");
  }
  return null;
}

/** Characters that cannot stand inside the alias line's quotes as they are. */
const UNQUOTABLE = /['"$`\\\r\n\0]/;

/** What the alias of a folder agent runs: Claude Code with the agent's folder as its config. */
export function aliasCommand(folder: string): string {
  return `CLAUDE_CONFIG_DIR="${folder}" claude`;
}

/** `alias <name>='CLAUDE_CONFIG_DIR="<folder>" claude'`; `null` when the folder holds a character
 *  the quotes cannot carry. */
export function aliasLine(name: string, folder: string): string | null {
  if (UNQUOTABLE.test(folder)) return null;
  return `alias ${name}='${aliasCommand(folder)}'`;
}

/** Append `line` to the rc file unless a line of the file is exactly it; a missing file is created.
 *  Says which happened. */
export async function appendOnce(rcFile: string, line: string): Promise<"appended" | "present"> {
  let text = "";
  try {
    text = await readFile(rcFile, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  if (text.split(/\r?\n/).some((l) => l.trim() === line)) return "present";
  const gap = text === "" || text.endsWith("\n") ? "" : "\n";
  await appendFile(rcFile, `${gap}${line}\n`, "utf8");
  return "appended";
}

/** What a fresh interactive zsh says about a name. */
export interface ZshAnswer {
  /** The name is an alias; its value. */
  alias: string | null;
  /** The name resolves to something (alias, function, builtin, reserved word or command). */
  resolves: boolean;
  /** `whence -v`'s line: "ls is /bin/ls", "x is an alias for …"; "" when it does not resolve. */
  description: string;
}

export interface Zsh {
  /** Ask a fresh interactive zsh about `name`; rejects when zsh cannot be run or does not answer. */
  ask(name: string): Promise<ZshAnswer>;
}

const START = "\u0001pomade-agents:";
const SEP = "\u0002";
const END = "\u0003";

/** Prints, between markers, whether the name is an alias, its value, `whence -v`'s status and line —
 *  so whatever the user's rc files print around it is ignored. The name is `$1`, never spliced in. */
const SCRIPT = [
  'if (( ${+aliases[$1]} )); then a=1; v=${aliases[$1]}; else a=0; v=; fi',
  'w=$(whence -v -- "$1" 2>&1); s=$?',
  `print -rn -- $'${START}'"$a"$'${SEP}'"$v"$'${SEP}'"$s"$'${SEP}'"$w"$'${END}'`,
].join("; ");

/** The zsh to run: `$SHELL` when it is a zsh, else `/bin/zsh`. */
function zshPath(env: Env): string {
  const shell = env.SHELL;
  return shell !== undefined && isAbsolute(shell) && /\/zsh$/.test(shell) ? shell : "/bin/zsh";
}

/** Parse the marked answer out of everything the shell printed. */
export function parseZshAnswer(output: string): ZshAnswer | null {
  const start = output.lastIndexOf(START);
  if (start === -1) return null;
  const end = output.indexOf(END, start);
  if (end === -1) return null;
  const [isAlias, value = "", status, ...rest] = output.slice(start + START.length, end).split(SEP);
  const description = rest.join(SEP).trim();
  return { alias: isAlias === "1" ? value : null, resolves: status === "0", description: status === "0" ? description : "" };
}

/** A fresh `zsh -ilc` with exactly `env` for every question. */
export function zshOf(env: Env, timeoutMs = ZSH_TIMEOUT_MS): Zsh {
  const shellEnv = Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => e[1] !== undefined));
  return {
    ask: (name) =>
      new Promise((resolve, reject) => {
        const child = spawn(zshPath(env), ["-ilc", SCRIPT, "zsh", name], { env: shellEnv, stdio: ["ignore", "pipe", "pipe"], detached: true });
        let output = "";
        let errors = "";
        // Its own process group, so a shell that hangs goes with whatever its rc files started.
        const timer = setTimeout(() => {
          try {
            if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
          reject(new Error(`zsh did not answer in ${timeoutMs / 1000} s`));
        }, timeoutMs);
        child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
        child.stderr.on("data", (chunk: Buffer) => (errors += chunk.toString("utf8")));
        child.once("error", (err) => {
          clearTimeout(timer);
          reject(new Error(`zsh could not be run: ${err.message}`));
        });
        child.once("close", () => {
          clearTimeout(timer);
          const answer = parseZshAnswer(output);
          if (answer !== null) resolve(answer);
          else reject(new Error(`zsh gave no answer${errors.trim() === "" ? "" : `: ${errors.trim().split("\n").at(-1) ?? ""}`}`));
        });
      }),
  };
}
