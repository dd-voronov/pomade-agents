// Transcripts the e2e writes into the sandbox's stores while the backend runs: one Claude Code
// prompt line, as the built-in store records it.

import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Sandbox } from "../harness/sandbox.ts";

/** One prompt of Daniil's, as a Claude Code transcript line. */
export const prompt = (text: string, at: string, cwd = "/fixture/workspace/Projects/alpha"): string =>
  `${JSON.stringify({ type: "user", message: { role: "user", content: text }, origin: { kind: "human" }, promptSource: "typed", timestamp: at, cwd })}\n`;

/** Start (or grow) a session in the sandbox's built-in Claude Code store; resolves to its transcript. */
export async function claudeSession(sandbox: Sandbox, id: string, line: string): Promise<string> {
  const path = join(sandbox.home, ".claude", "projects", "-e2e", `${id}.jsonl`);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, line);
  return path;
}
