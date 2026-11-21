// Launch specs (DESIGN §3.5): the command line that starts one agent in one mode — new, with a
// session id of the caller's, or resuming a session — optionally with its first prompt.
//
// The provider forms, as each CLI takes them (`claude --help`, `codex --help`, `codex resume
// --help`) and as Pomade builds its own launches (its `buildAgentCommand`: the command, the mode's
// arguments, then the resume arguments):
//
// | | Claude Code | Codex |
// |---|---|---|
// | new | `<command> <mode args> [prompt]` | same |
// | new with an id | `<command> <mode args> --session-id <uuid> [prompt]` | no such flag: the id is the CLI's |
// | resume | `<command> <mode args> --resume <id> [prompt]` | `<command> <mode args> resume <id> [prompt]` |
// | end | `/exit` | `/exit` |
//
// The prompt is the CLIs' positional argument; one that starts with `-` follows `--`, so it is
// never read as an option. The command is the agent's alias, typed as is into an interactive shell —
// it is never resolved or run here.

import { providerModes, type AgentProvider } from "pomade-kit/protocol";

import type { LaunchSpec, LaunchSpecParams, ModeId } from "../../shared/roster.ts";

/** What a launch needs to know of its agent. */
export interface LaunchAgent {
  command: string;
  provider: AgentProvider;
  /** The modes its profile enables. */
  modes: readonly ModeId[];
}

/** What to type to end an agent, per provider. */
export const EXIT_COMMAND: Readonly<Record<AgentProvider, string>> = { claude: "/exit", codex: "/exit" };

const PLAIN = /^[A-Za-z0-9_@%+=:,./-]+$/;
const CONTROL = /[\x00-\x1f\x7f]/;

/** One argument as a POSIX shell reads it back unchanged: as is when it is plain; single-quoted
 *  otherwise; and, when it holds a control character (a line break, a tab), ANSI-C quoted
 *  (`$'…'`) with every control character, `\`, `'` and `!` escaped — so the line stays one
 *  printable line that an interactive shell takes as typed (no line breaks, no tab completion, no
 *  history expansion). */
export function shellWord(arg: string): string {
  if (PLAIN.test(arg)) return arg;
  if (!CONTROL.test(arg)) return `'${arg.replace(/'/g, `'\\''`)}'`;
  let out = "";
  for (const ch of arg) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "\\") out += "\\\\";
    else if (ch === "'") out += "\\'";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\r") out += "\\r";
    else if (ch === "!" || code < 0x20 || code === 0x7f) out += `\\x${code.toString(16).padStart(2, "0")}`;
    else out += ch;
  }
  return `$'${out}'`;
}

/** The command, then each argument quoted for a POSIX shell. */
export function shellLine(command: string, args: readonly string[]): string {
  return [command, ...args.map(shellWord)].join(" ");
}

/** The prompt as the CLIs' positional argument. */
const promptArgs = (prompt: string | undefined): string[] => (prompt === undefined ? [] : prompt.startsWith("-") ? ["--", prompt] : [prompt]);

/** The launch spec for `agent`, or why it cannot be launched so. Params are well-formed here: ids
 *  checked, `resume` and `sessionId` never both. */
export function launchSpec(agent: LaunchAgent, params: LaunchSpecParams): { ok: true; spec: LaunchSpec } | { ok: false; problem: string } {
  const { mode, resume, sessionId, prompt } = params;
  const known = providerModes(agent.provider).find((m) => m.id === mode);
  if (known === undefined) return { ok: false, problem: `"mode" ${JSON.stringify(mode)} is not a mode of the agent` };
  if (!(agent.modes as readonly string[]).includes(mode)) return { ok: false, problem: `the agent's ${known.name} mode is not enabled` };
  const args = [...known.args];
  let id: string | null = null;
  if (agent.provider === "claude") {
    if (resume !== undefined) args.push("--resume", resume);
    else if (sessionId !== undefined) args.push("--session-id", sessionId);
    id = resume ?? sessionId ?? null;
  } else if (resume !== undefined) {
    args.push("resume", resume);
    id = resume;
  }
  args.push(...promptArgs(prompt));
  return { ok: true, spec: { command: agent.command, args, line: shellLine(agent.command, args), sessionId: id, exit: EXIT_COMMAND[agent.provider] } };
}
