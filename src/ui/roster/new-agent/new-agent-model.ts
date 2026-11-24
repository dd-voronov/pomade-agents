// What the New agent page shows (DESIGN §3.6), as plain data: the name's verdict as it is typed,
// the "Create will" list, the labels of the steps as they tick, where a Create leaves the page, and
// what a clone takes from its source.
// Text runs are `Part`s — plain text, or a name/path shown as code — so the page renders them
// without markup in strings.

import { AGENT_NAME_MAX, nameRuleProblem } from "../../../shared/agent-name.ts";
import type { CreateAgentResult, CreateStep, CreateStepId, NameVerdict, RosterEntry } from "../../../shared/roster.ts";

/** A run of text: plain, or a name or path shown as code. */
export type Part = string | { code: string };

export const NAME_RULE = "Lowercase letters, digits and “-”, starting with a letter or digit.";
export const NAME_HINT = `${NAME_RULE} It is the folder, the alias and the name in the “+” menu.`;
export const TEMPLATE_PATH = "Agents/Claude Agent Template";
export const SHARED_SKILLS_PATH = "Agents/_shared/skills";
export const RC_FILE_LABEL = "~/.zshrc";
export const WORKSPACE_LABEL = "the Workspace";
/** How long typing pauses before the folder and the shell are asked about a name. */
export const NAME_CHECK_DELAY_MS = 300;

/** Where the name stands as the user types:
 *  - `empty` — nothing typed
 *  - `checking` — its rules pass; the backend is asked about the folder and zsh
 *  - `ok` — free
 *  - `bad` — refused (`problem`) */
export type NameState =
  | { status: "empty" }
  | { status: "checking"; name: string }
  | { status: "ok"; name: string }
  | { status: "bad"; name: string; verdict: NameVerdict };

/** The state the name is in the moment it is typed: its own rules decide at once, else it is checked. */
export function typedName(name: string): NameState {
  if (name === "") return { status: "empty" };
  const problem = nameRuleProblem(name);
  if (problem !== null) return { status: "bad", name, verdict: { name, problem, detail: null } };
  return { status: "checking", name };
}

/** The state after the backend's verdict on `verdict.name`; a verdict on a name no longer typed changes nothing. */
export function answeredName(current: NameState, verdict: NameVerdict): NameState {
  if (current.status !== "checking" || current.name !== verdict.name) return current;
  return verdict.problem === null ? { status: "ok", name: verdict.name } : { status: "bad", name: verdict.name, verdict };
}

/** The line under the name field: why it is refused, that it is being checked, or that it is free. */
export function nameMessage(state: NameState, tried: boolean): { tone: "hint" | "error"; parts: Part[] } {
  switch (state.status) {
    case "empty":
      return tried ? { tone: "error", parts: [`Name it. ${NAME_RULE}`] } : { tone: "hint", parts: [NAME_HINT] };
    case "checking":
      return { tone: "hint", parts: ["Checking the folder and zsh…"] };
    case "ok":
      return { tone: "hint", parts: ["Free: folder ", { code: `Agents/${state.name}` }, ", alias ", { code: state.name }, "."] };
    case "bad":
      return { tone: "error", parts: problemParts(state.verdict) };
  }
}

function problemParts({ name, problem, detail }: NameVerdict): Part[] {
  switch (problem) {
    case "empty":
      return [`Name it. ${NAME_RULE}`];
    case "leading-dash":
      return ["Start with a letter or digit: a leading “-” breaks the alias."];
    case "characters":
      return ["Only lowercase letters, digits and “-”."];
    case "too-long":
      return [`At most ${AGENT_NAME_MAX} characters.`];
    case "reserved":
      return name.includes("template") ? ["A name with “template” in it is skipped by the agent scan."] : [{ code: name }, " is the New agent page’s own address."];
    case "folder":
      return [{ code: `Agents/${name}` }, " already exists."];
    case "agent":
      return ["The roster already has an agent ", { code: name }, "."];
    case "shell":
      return [{ code: name }, ` already runs something in zsh: ${detail ?? "it resolves"}.`];
    case "shell-error":
      return [`zsh could not be asked (${detail ?? "no answer"}). Try again.`];
    case null:
      return [];
  }
}

/** Where a new agent starts: the blank template, or a clone of a folder agent — `source` `null`
 *  until one is picked. */
export type StartFrom = { kind: "template" } | { kind: "clone"; source: string | null };

/** The agents a clone can start from: Claude Code folder agents with a readable profile, not orphans. */
export function cloneable(agents: readonly RosterEntry[]): RosterEntry[] {
  return agents.filter((a) => a.profile !== null && a.profile.provider === "claude" && a.profile.kind === "folder" && !a.orphan);
}

/** What a clone pre-fills from its source: the role line, the tags, and the projects (of those the
 *  form lists) that list the source among their agents. */
export function clonePrefill(source: RosterEntry, projects: readonly { id: string; agents: readonly string[] }[]): { role: string; tags: string[]; projects: string[] } {
  return { role: source.profile?.role ?? "", tags: [...(source.profile?.tags ?? [])], projects: projects.filter((p) => p.agents.includes(source.id)).map((p) => p.id) };
}

/** Where the first tab opens: the first project checked, in the form's order, else the Workspace. */
export const openInLabel = (projectNames: readonly string[]): string => projectNames[0] ?? WORKSPACE_LABEL;

/** What Create will do for the current choices, one item per step. `name` may be empty. */
export function createWill(name: string, projectNames: readonly string[], from: StartFrom = { kind: "template" }): { parts: Part[]; faint?: true }[] {
  const shown = name === "" ? "<name>" : name;
  const copy: Part[] =
    from.kind === "template"
      ? ["Copy ", { code: TEMPLATE_PATH }, " to ", { code: `Agents/${shown}/` }]
      : from.source === null
        ? ["Copy the picked agent’s ", { code: "CLAUDE.md" }, ", ", { code: "settings.json" }, ", skill links and ", { code: "plugins" }, " link"]
        : ["Copy from ", { code: from.source }, ": ", { code: "CLAUDE.md" }, ", ", { code: "settings.json" }, ", its skill links, the ", { code: "plugins" }, " link"];
  return [
    { parts: copy },
    { parts: ["Link every missing shared skill from ", { code: SHARED_SKILLS_PATH }] },
    { parts: ["Write ", { code: `Apps/pomade-agents/agents/${shown}/agent.yaml` }] },
    projectNames.length === 0 ? { parts: ["Connect to no project (the Workspace offers every agent)"], faint: true } : { parts: [`Connect to ${projectNames.join(", ")}`] },
    { parts: ["Append ", { code: `alias ${shown}=…` }, " to ", { code: RC_FILE_LABEL }, " and check it resolves"] },
    { parts: ["Open a ", { code: shown }, ` tab in ${openInLabel(projectNames)}`] },
  ];
}

/** Under "Create will" for a clone: what is never copied. */
export const NEVER_CLONED: Part[] = ["Never copied: ", { code: "projects/" }, ", sessions, memory, history, caches, ", { code: ".claude.json" }, "."];

/** A step's label while it runs and after. `clone` is the source agent, `null` for the template;
 *  `openIn` names where the tab opens. */
export function stepLabel(id: CreateStepId, name: string, projectNames: readonly string[], clone: string | null = null, openIn: string = openInLabel(projectNames)): string {
  switch (id) {
    case "folder":
      return clone === null ? `Copy ${TEMPLATE_PATH}` : `Copy ${clone}’s CLAUDE.md, settings.json, skill links and plugins link`;
    case "skills":
      return "Link the missing shared skills";
    case "profile":
      return "Write agent.yaml";
    case "projects":
      return projectNames.length === 0 ? "No projects to connect" : `Connect to ${projectNames.join(", ")}`;
    case "alias":
      return `Append the alias to ${RC_FILE_LABEL}`;
    case "verify":
      return `Check that ${name} resolves in a fresh zsh`;
    case "open":
      return `Open a ${name} tab in ${openIn}`;
  }
}

/** Add the tags typed into `raw` (comma-separated), trimmed and lowercased, each once. */
export function addTags(tags: readonly string[], raw: string): string[] {
  const next = [...tags];
  for (const tag of raw.split(",").map((t) => t.trim().toLowerCase())) if (tag !== "" && !next.includes(tag)) next.push(tag);
  return next;
}

/** Where the page is:
 *  - `edit` — the form
 *  - `creating` — the steps tick
 *  - `done` — every step done or skipped
 *  - `incomplete` — the agent exists; a connection or the alias failed
 *  - `failed` — copying, linking or writing agent.yaml failed; nothing was kept */
export type Phase = "edit" | "creating" | "done" | "incomplete" | "failed";

/** The phase a Create's answer leaves the page in; `edit` when the name was refused. */
export function phaseOf(result: CreateAgentResult): Phase {
  switch (result.outcome) {
    case "created":
      return "done";
    case "incomplete":
      return "incomplete";
    case "failed":
      return "failed";
    case "refused":
      return "edit";
  }
}

/** True when the alias or its check failed: the page shows the line to add and Check again. */
export const aliasFailed = (steps: readonly CreateStep[]): boolean => steps.some((s) => (s.id === "alias" || s.id === "verify") && s.state === "fail");

/** The steps with the `open` step set — run, done or failed (`detail` why). */
export function withOpen(steps: readonly CreateStep[], state: CreateStep["state"], detail: string | null = null): CreateStep[] {
  return steps.map((s) => (s.id === "open" ? { ...s, state, detail } : s));
}

/** The phase of a Create whose answer came: `done` with every step done or skipped, else `incomplete`. */
export const settledPhase = (steps: readonly CreateStep[]): "done" | "incomplete" => (steps.every((s) => s.state === "done" || s.state === "skip") ? "done" : "incomplete");

/** The steps once Check again found the alias resolving: both alias steps done. */
export function aliasChecked(steps: readonly CreateStep[]): CreateStep[] {
  return steps.map((s) => (s.id === "verify" ? { ...s, state: "done", detail: "Resolves in a fresh zsh" } : s.id === "alias" && s.state === "fail" ? { ...s, state: "done", detail: "Added by hand" } : s));
}

/** The page's title for its phase; a clone's form names its source. */
export function pageTitle(phase: Phase, name: string, clone: string | null = null): string {
  switch (phase) {
    case "edit":
      return clone === null ? "New agent" : `New agent — clone of ${clone}`;
    case "creating":
      return `Creating ${name}`;
    case "done":
    case "incomplete":
      return `${name} created`;
    case "failed":
      return `${name} not created`;
  }
}
