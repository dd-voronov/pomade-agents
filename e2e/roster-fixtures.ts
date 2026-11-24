// A roster to look at: agent folders and profiles in the sandbox's workspace, work sessions of
// each in its store, and projects with long names, each offering some agents. `seedRoster` writes
// the files before the backend starts; `ROSTER_PROJECTS` is what the fake Pomade starts with.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { FakeProject } from "pomade-kit/fake-host";

import type { Sandbox } from "../harness/sandbox.ts";
import { answer, prompt } from "./transcripts.ts";

/** The folder agents the roster holds, besides the fixture's `claude-libra`. */
export const LONG_ID = "claude-translation-quality-evaluation-harness-agent";
const LONG_ROLE =
  "Reads every translated segment of a delivery against its source and the client's glossary, scores it with the MQM rubric, and writes a short report that says what to fix first and why it matters to the reviewer.";

type Profile = { id: string; provider?: "claude" | "codex"; kind?: "builtin" | "folder"; configDir: string; role?: string; tags?: string[]; hidden?: boolean };

function profileYaml(p: Profile): string {
  const lines = [`id: ${p.id}`, `provider: ${p.provider ?? "claude"}`, `kind: ${p.kind ?? "folder"}`, `configDir: ${p.configDir}`, `command: ${p.id}`];
  if (p.role !== undefined) lines.push(`role: ${p.role}`);
  lines.push(`tags: [${(p.tags ?? []).join(", ")}]`, `hidden: ${p.hidden === true}`, "modes:", "  normal:", "    enabled: true", "  full-autonomy:", "    enabled: true", "");
  return lines.join("\n");
}

const profileFile = (sandbox: Sandbox, id: string): string => join(sandbox.workspace, "Apps", "pomade-agents", "agents", id, "agent.yaml");

async function put(path: string, text: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, text);
}

/** Projects with long names, in sidebar order, and the agents each offers (`["*"]`: every agent). */
export const ROSTER_PROJECTS: FakeProject[] = [
  { id: "pomade", name: "Pomade", root: "Projects/Pomade", visibleAgents: ["claude", "claude-coder", "claude-pm", "codex"] },
  { id: "agents", name: "pomade-agents", root: "Projects/pomade-agents", visibleAgents: ["claude", "claude-coder", "claude-pm"] },
  { id: "kit", name: "pomade-kit", root: "Projects/pomade-kit", visibleAgents: ["claude", "claude-coder", "claude-pm"] },
  { id: "runner", name: "Pomade Runner", root: "Projects/pomade-runner", visibleAgents: ["claude", "claude-coder"] },
  { id: "knowledge", name: "Knowledge", root: "Knowledge", visibleAgents: ["*"] },
  { id: "wiki", name: "Wiki gardening", root: "Knowledge/04-Wiki", visibleAgents: ["claude", "claude-libra"] },
  { id: "ske", name: "Meeting-notes-summarizer-with-a-very-long-name", root: "Projects/Meeting-notes-summarizer", visibleAgents: ["claude", "claude-libra", "claude-coder"] },
  { id: "eval", name: "Translation-quality-evaluation-harness", root: "Projects/translation-quality-evaluation-harness", visibleAgents: ["claude", "claude-coder", LONG_ID] },
  { id: "fabric", name: "Atlas Platform", root: "Projects/atlas-platform", visibleAgents: ["claude", "claude-coder", "claude-pm"] },
  { id: "tax", name: "Tax 2026", root: "Projects/tax-2026", visibleAgents: ["claude", "claude-personal"] },
  { id: "budget", name: "Home budget", root: "Projects/home-budget", visibleAgents: ["claude", "claude-personal"] },
  { id: "photos", name: "Family photo archive", root: "Projects/family-photo-archive", visibleAgents: ["claude", "claude-personal"] },
];

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const hours = (n: number) => (i: number) => (n + i * 3) * 60 * MINUTE;
const days = (n: number) => (i: number) => (n + i * 2) * DAY;

/** The work sessions the roster is seeded with: `n` of `agent` in `project`, the i-th last active `ago(i)` ms before the seed. */
export const SESSION_PLAN: readonly { agent: string; project: string; n: number; ago: (i: number) => number }[] = [
  { agent: "claude-coder", project: "agents", n: 6, ago: hours(0) },
  { agent: "claude-coder", project: "pomade", n: 3, ago: hours(1) },
  { agent: "claude-coder", project: "kit", n: 2, ago: days(4) },
  { agent: "claude-pm", project: "pomade", n: 4, ago: hours(2) },
  { agent: "claude-pm", project: "agents", n: 1, ago: days(9) },
  { agent: "claude-libra", project: "knowledge", n: 5, ago: hours(3) },
  { agent: "claude-personal", project: "tax", n: 2, ago: days(2) },
  { agent: "claude", project: "pomade", n: 2, ago: hours(5) },
  { agent: "claude", project: "agents", n: 1, ago: days(20) },
];

let sessionCounter = 0;

/** One work session of `agent` in `project`, last active `agoMs` before now. */
export async function agentSession(sandbox: Sandbox, agent: string, project: string, agoMs: number, title: string): Promise<void> {
  const root = ROSTER_PROJECTS.find((p) => p.id === project)?.root ?? `Projects/${project}`;
  const cwd = join(sandbox.workspaceReal, root);
  const store = agent === "claude" ? join(sandbox.home, ".claude", "projects", "-e2e") : join(sandbox.workspaceReal, "Agents", agent, "projects", "-e2e");
  const at = new Date(Date.now() - agoMs).toISOString();
  const id = `${(++sessionCounter).toString(16).padStart(8, "0")}-0000-4000-8000-000000000001`;
  await put(join(store, `${id}.jsonl`), prompt(title, at, cwd) + answer({ model: "claude-sonnet-5-5", input: 20_000, at, cwd }));
}

/** When `seedRoster` last ran in this worker: the instant the plan's `ago` counts back from. */
let seededAt = Date.now();

/** What the plan gives `agent`: its work sessions from `weekFrom` on, and per project from `projectsFrom` on. */
export function planned(agent: string, windows: { weekFrom: string; projectsFrom: string }): { week: number; projects: Record<string, number> } {
  const week = Date.parse(windows.weekFrom);
  const since = Date.parse(windows.projectsFrom);
  let inWeek = 0;
  const projects: Record<string, number> = {};
  for (const row of SESSION_PLAN.filter((r) => r.agent === agent)) {
    for (let i = 0; i < row.n; i++) {
      const at = seededAt - row.ago(i);
      if (at >= week) inWeek += 1;
      if (at >= since) projects[row.project] = (projects[row.project] ?? 0) + 1;
    }
  }
  return { week: inWeek, projects };
}

export interface RosterSeedOptions {
  /** Work sessions to write (a quick roster for the specs that count them). Default: a full one. */
  sessions?: boolean;
}

/** Folder agents (one with a long name, one orphan, one whose `agent.yaml` cannot be read), a hidden
 *  built-in, many tags, and work sessions over the projects of `ROSTER_PROJECTS`. */
export async function seedRoster(sandbox: Sandbox, options: RosterSeedOptions = {}): Promise<void> {
  seededAt = Date.now();
  const role = (text: string): string => `# agent\n\n## Role\n\n${text}\n`;
  const folders: [string, string][] = [
    ["claude-coder", "Builds and tests the Pomade family's code to the Owner's engineering bar."],
    ["claude-pm", "Product manager: grills, tickets and the backlog of the Pomade family."],
    ["claude-personal", "Personal admin: taxes, the home budget and family logistics."],
    [LONG_ID, LONG_ROLE],
  ];
  for (const [id, text] of folders) await put(join(sandbox.workspaceReal, "Agents", id, "CLAUDE.md"), role(text));
  await put(join(sandbox.workspaceReal, "Agents", "claude-broken", "CLAUDE.md"), role("Its profile cannot be read."));

  await put(profileFile(sandbox, "claude-coder"), profileYaml({ id: "claude-coder", configDir: "Agents/claude-coder", role: "Builds and tests the Pomade family's code to the Owner's engineering bar.", tags: ["code", "pomade", "typescript", "e2e", "playwright", "review", "refactoring", "release"] }));
  await put(profileFile(sandbox, "codex"), profileYaml({ id: "codex", provider: "codex", kind: "builtin", configDir: "~/.codex", role: "OpenAI Codex for second opinions and long refactors.", tags: ["code", "review"], hidden: true }));
  await put(profileFile(sandbox, "claude-writer"), profileYaml({ id: "claude-writer", configDir: "Agents/claude-writer", role: "Drafts essays and posts in the Owner's voice.", tags: ["writing"] }));
  await put(profileFile(sandbox, "claude-broken"), "id: claude-broken\nprovider: [unclosed\n");

  if (options.sessions === false) return;
  for (const { agent, project, n, ago } of SESSION_PLAN) {
    for (let i = 0; i < n; i++) await agentSession(sandbox, agent, project, ago(i), `${project} ${i + 1}`);
  }
}
