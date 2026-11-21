// Transcripts the e2e writes into the sandbox's stores: Claude Code prompt and answer lines as the
// built-in store records them, sessions placed in the sandbox's projects, and the seeded
// transcripts moved into a project's folder.

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { SEEDED_TRANSCRIPTS, type Sandbox } from "../harness/sandbox.ts";

/** One prompt of the user's, as a Claude Code transcript line; `branch` is the git branch it records. */
export const prompt = (text: string, at: string, cwd = "/fixture/workspace/Projects/alpha", branch?: string): string =>
  `${JSON.stringify({ type: "user", message: { role: "user", content: text }, origin: { kind: "human" }, promptSource: "typed", timestamp: at, cwd, ...(branch === undefined ? {} : { gitBranch: branch }) })}\n`;

export interface Turn {
  model: string;
  effort?: string;
  /** Input-side tokens of the turn: uncached input plus cache reads. */
  input: number;
  output?: number;
  at: string;
  cwd: string;
  /** The answer's text; default "Done.". */
  text?: string;
}

let turns = 0;

/** One answer of the agent's, as a Claude Code transcript line with its usage. */
export const answer = (turn: Turn): string =>
  `${JSON.stringify({
    type: "assistant",
    timestamp: turn.at,
    cwd: turn.cwd,
    effort: turn.effort ?? "high",
    message: {
      model: turn.model,
      id: `msg_e2e_${++turns}`,
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: turn.text ?? "Done." }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, cache_read_input_tokens: turn.input - 10, cache_creation_input_tokens: 0, output_tokens: turn.output ?? 100 },
    },
  })}\n`;

/** Start (or grow) a session in the sandbox's built-in Claude Code store; resolves to its transcript. */
export async function claudeSession(sandbox: Sandbox, id: string, line: string): Promise<string> {
  const path = join(sandbox.home, ".claude", "projects", "-e2e", `${id}.jsonl`);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, line);
  return path;
}

/** A fixture project's folder in the sandbox's workspace. */
export const projectFolder = (sandbox: Sandbox, projectId: string): string => join(sandbox.workspace, "Projects", projectId);

/** Move the seeded Claude, folder-agent and Codex transcripts into `projectId`'s folder before a
 *  backend reads them: their start folders become that project's. */
export async function seedIntoProject(sandbox: Sandbox, projectId: string): Promise<void> {
  const folder = projectFolder(sandbox, projectId);
  for (const path of Object.keys(SEEDED_TRANSCRIPTS)) {
    const file = join(sandbox.root, path);
    await writeFile(file, (await readFile(file, "utf8")).replace(/\/work\/(alpha|beta)/g, folder));
  }
}
