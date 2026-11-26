// Creating a folder agent from the template or as a clone of one (ARCHITECTURE §3.6): the name check and
// the Create, as steps that report as they start and end (`CREATE_STEP_IDS`).
//
// - **The name** is checked in order: its own rules (`nameRuleProblem`), then the disk (the folder
//   `Agents/<name>`, an agent of that id in the roster, a Create of it running), then a fresh
//   interactive zsh (`whence -v`). Create runs the whole check again first; a refused name writes
//   nothing.
// - **The agent itself** — folder, shared skill links, `agent.yaml` — appears whole or not at all.
//   The template — or a clone source's allowed entries (`CLONED_ENTRIES`, `copyCloned`) — is copied
//   to a staging folder beside the others whose name holds "template", so the agent scan skips it
//   (ARCHITECTURE §3.1); the links go in there; `agent.yaml` is written; then
//   the staging folder is renamed into place. A failure on the way removes the staging folder and
//   the `agent.yaml` this Create wrote, and the Create ends `failed`: the roster never sees a
//   folder without its profile, nor a profile it would read as an orphan for longer than the
//   rename takes.
// - **Its attachments** — the project connections and the alias — come after. A failure there
//   marks its step and keeps the agent (`incomplete`); the alias check can be run again
//   (`checkAlias`).
// - **Its first tab** opens last, in the first project connected (the Workspace when none), and
//   only once the alias resolves: a tab running a command zsh does not know dies at once.

import { copyFile, cp, lstat, mkdir, readdir, readlink, rename, rm, stat, symlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { WORKSPACE_PROJECT_ID } from "pomade-kit/protocol";

import { nameRuleProblem } from "../../shared/agent-name.ts";
import {
  CLONED_ENTRIES,
  CREATE_STEP_IDS,
  MODE_IDS,
  type AgentProfile,
  type AliasCheck,
  type CreateAgentParams,
  type CreateAgentResult,
  type CreateStep,
  type CreateStepId,
  type CreateStepState,
  type NameVerdict,
} from "../../shared/roster.ts";
import { AGENTS_FOLDER as PROFILES_FOLDER, PROFILE_FILE, type FileSet } from "../records/record-store.ts";
import { AGENTS_FOLDER, AGENT_MARKER } from "../stores/roots.ts";
import { aliasCommand, aliasLine, appendOnce, type Zsh } from "./shell.ts";

/** The blank template a new agent is copied from, under `Agents/`. */
export const TEMPLATE_FOLDER = "Claude Agent Template";
/** The skills every agent links, under `Agents/`. */
export const SHARED_SKILLS = join("_shared", "skills");

export interface CreationOptions {
  /** The workspace, as Pomade names it: the agent's folder in its alias is under it. */
  workspace: string;
  /** `<workspace>/Apps/pomade-agents`. */
  dataDir: string;
  profiles: FileSet<AgentProfile>;
  /** The ids the roster holds now. */
  rosterIds(): string[];
  /** Read the roster again; resolves when it answers with what is on disk now. */
  refreshRoster(): Promise<void>;
  /** Have `project` offer `agent` (pomade:E-030); `offers-all` when it offers every agent already. */
  connect(project: string, agent: string): Promise<"connected" | "offers-all">;
  /** The folder agent `id` names, to clone: its profile and its config folder (absolute); a text
   *  saying why not when it is no folder agent the roster holds, or an orphan. */
  cloneSource(id: string): { profile: AgentProfile; folder: string } | string;
  /** Open an agent tab with `agent` in `project` (`agentTabs.launch`); resolves with its tab id. */
  launch(agent: string, project: string): Promise<string>;
  /** The rc file the alias goes in; `null` when it cannot be known. */
  rcFile: string | null;
  zsh: Zsh;
  log: (line: string) => void;
}

export interface AgentCreation {
  checkName(name: string): Promise<NameVerdict>;
  /** Run every step; `progress` hears each change. Never rejects: a failure is a step's. */
  create(params: CreateAgentParams, progress: (steps: CreateStep[]) => void): Promise<CreateAgentResult>;
  /** Ask a fresh zsh whether `agent` resolves to the alias of its config folder `folder` (absolute). */
  checkAlias(agent: string, folder: string): Promise<AliasCheck>;
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

/** The steps of one Create, as they are now; every change reaches `emit` as a fresh copy. */
export interface StepBoard {
  start(id: CreateStepId): void;
  end(id: CreateStepId, state: Exclude<CreateStepState, "todo" | "run">, detail: string): void;
  steps(): CreateStep[];
}

export function stepBoard(emit: (steps: CreateStep[]) => void): StepBoard {
  const steps: CreateStep[] = CREATE_STEP_IDS.map((id) => ({ id, state: "todo", detail: null }));
  const copy = (): CreateStep[] => steps.map((s) => ({ ...s }));
  const set = (id: CreateStepId, state: CreateStepState, detail: string | null): void => {
    const step = steps.find((s) => s.id === id);
    if (step === undefined) return;
    step.state = state;
    step.detail = detail;
    emit(copy());
  };
  return {
    start: (id) => set(id, "run", null),
    end: (id, state, detail) => set(id, state, detail),
    steps: copy,
  };
}

/** The staging folder a Create copies into: beside the agents, skipped by their scan ("template"). */
export const stagingName = (name: string): string => `.${name}.creating-from-template`;

/** A link to what `link` points at, made at `at` — which ends up at `final`: an absolute target as
 *  it is, a relative one rewritten so it still reaches the same place from `final`. */
async function relink(link: string, at: string, final: string): Promise<void> {
  const target = await readlink(link);
  await symlink(isAbsolute(target) ? target : relative(dirname(final), resolve(dirname(link), target)), at);
}

/** Copy into `target` (empty, made by the caller) what a clone takes of the config folder `source`
 *  (`CLONED_ENTRIES`), and nothing else: `CLAUDE.md` and `settings.json` as files (a link stays a
 *  link), every symlink directly in `skills/` (an own skill folder is not a link and stays behind),
 *  and `plugins` when it is a link. `final` is where `target` will be renamed to. Answers the
 *  entries copied, `skills/<name>` for each skill link. */
export async function copyCloned(source: string, target: string, final: string): Promise<string[]> {
  const copied: string[] = [];
  const kind = async (path: string): Promise<"file" | "dir" | "link" | null> => {
    try {
      const info = await lstat(path);
      return info.isSymbolicLink() ? "link" : info.isDirectory() ? "dir" : info.isFile() ? "file" : null;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  };
  for (const entry of CLONED_ENTRIES) {
    const from = join(source, entry);
    const what = await kind(from);
    if (what === "link") {
      await relink(from, join(target, entry), join(final, entry));
      copied.push(entry);
    } else if (what === "file" && (entry === "CLAUDE.md" || entry === "settings.json")) {
      await copyFile(from, join(target, entry));
      copied.push(entry);
    } else if (what === "dir" && entry === "skills") {
      await mkdir(join(target, entry));
      for (const skill of (await readdir(from)).sort()) {
        if ((await kind(join(from, skill))) !== "link") continue;
        await relink(join(from, skill), join(target, entry, skill), join(final, entry, skill));
        copied.push(`${entry}/${skill}`);
      }
    }
  }
  return copied;
}

const list = (names: readonly string[]): string => names.join(", ");

export function createAgentCreation(options: CreationOptions): AgentCreation {
  const { workspace, dataDir, profiles, zsh, rcFile, log } = options;
  const agentsDir = join(workspace, AGENTS_FOLDER);
  const folderOf = (name: string): string => join(agentsDir, name);
  /** Names a Create is running for. */
  const creating = new Set<string>();

  const verdict = (name: string, problem: NameVerdict["problem"], detail: string | null = null): NameVerdict => ({ name, problem, detail });

  const checkName = async (name: string): Promise<NameVerdict> => {
    const rule = nameRuleProblem(name);
    if (rule !== null) return verdict(name, rule);
    if (creating.has(name) || (await exists(folderOf(name)))) return verdict(name, "folder");
    if (options.rosterIds().includes(name) || profiles.get(name) !== undefined) return verdict(name, "agent");
    try {
      const answer = await zsh.ask(name);
      return answer.resolves ? verdict(name, "shell", answer.description) : verdict(name, null);
    } catch (err) {
      return verdict(name, "shell-error", message(err));
    }
  };

  /** Steps 1–3 into the staging folder, then into place; on a failure, undo what was written. */
  const makeAgent = async (params: CreateAgentParams, board: StepBoard): Promise<boolean> => {
    const { name } = params;
    const staging = join(agentsDir, stagingName(name));
    let wroteProfile = false;
    const undo = async (): Promise<void> => {
      await rm(staging, { recursive: true, force: true }).catch((err: unknown) => log(`create: could not remove ${staging}: ${message(err)}`));
      if (wroteProfile) {
        const profileDir = join(dataDir, PROFILES_FOLDER, name);
        await rm(profileDir, { recursive: true, force: true }).catch((err: unknown) => log(`create: could not remove ${profileDir}: ${message(err)}`));
      }
    };
    let step: CreateStepId = "folder";
    let modes: AgentProfile["modes"] = Object.fromEntries(MODE_IDS.map((id) => [id, { enabled: true }]));
    try {
      board.start("folder");
      await rm(staging, { recursive: true, force: true });
      if (params.clone === undefined) {
        const template = join(agentsDir, TEMPLATE_FOLDER);
        if (!(await stat(template).then((s) => s.isDirectory(), () => false))) throw new Error(`${AGENTS_FOLDER}/${TEMPLATE_FOLDER} is not there`);
        await cp(template, staging, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false });
        if (!(await exists(join(staging, AGENT_MARKER)))) throw new Error(`the template has no ${AGENT_MARKER}`);
        board.end("folder", "done", `Copied ${AGENTS_FOLDER}/${TEMPLATE_FOLDER} to ${AGENTS_FOLDER}/${name}`);
      } else {
        const source = options.cloneSource(params.clone);
        if (typeof source === "string") throw new Error(source);
        await mkdir(staging);
        const copied = await copyCloned(source.folder, staging, folderOf(name));
        if (!(await exists(join(staging, AGENT_MARKER)))) throw new Error(`${params.clone} has no ${AGENT_MARKER}`);
        modes = structuredClone(source.profile.modes);
        board.end("folder", "done", `Copied ${list(copied)} from ${params.clone}`);
      }

      step = "skills";
      board.start("skills");
      const linked = await linkSharedSkills(staging);
      board.end("skills", "done", linked.length === 0 ? "Every shared skill was linked already" : `Linked ${list(linked)}`);

      step = "profile";
      board.start("profile");
      const profile: AgentProfile = {
        id: name,
        provider: "claude",
        kind: "folder",
        configDir: `${AGENTS_FOLDER}/${name}`,
        command: name,
        role: params.role.trim(),
        tags: params.tags,
        hidden: false,
        modes,
      };
      if (profiles.get(name) !== undefined) throw new Error(`a profile for ${name} exists already`);
      await profiles.create(profile);
      if (profiles.get(name)?.value?.configDir !== profile.configDir) throw new Error(`a profile for ${name} exists already`);
      wroteProfile = true;
      if (await exists(folderOf(name))) throw new Error(`${AGENTS_FOLDER}/${name} appeared meanwhile`);
      await rename(staging, folderOf(name));
      board.end("profile", "done", `Wrote ${PROFILES_FOLDER}/${name}/${PROFILE_FILE} in the app's data folder`);
      return true;
    } catch (err) {
      await undo();
      board.end(step, "fail", `${message(err)}. Nothing of ${name} was kept.`);
      log(`create: ${name} failed at ${step}: ${message(err)}`);
      return false;
    }
  };

  /** Link every shared skill `<folder>/skills/` lacks, as `../../_shared/skills/<skill>`; the names linked. */
  const linkSharedSkills = async (folder: string): Promise<string[]> => {
    const shared = join(agentsDir, SHARED_SKILLS);
    let entries;
    try {
      entries = await readdir(shared, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const skills = join(folder, "skills");
    await mkdir(skills, { recursive: true });
    const linked: string[] = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".")) continue;
      if (!(await stat(join(shared, entry.name)).then((s) => s.isDirectory(), () => false))) continue;
      if (await exists(join(skills, entry.name))) continue;
      await symlink(join("..", "..", SHARED_SKILLS, entry.name), join(skills, entry.name));
      linked.push(entry.name);
    }
    return linked;
  };

  /** Connect each project; answers the ones connected, in order. */
  const connectProjects = async (params: CreateAgentParams, board: StepBoard): Promise<string[]> => {
    const projects = [...new Set(params.projects)];
    if (projects.length === 0) {
      board.end("projects", "skip", "No projects to connect");
      return [];
    }
    board.start("projects");
    const failed: string[] = [];
    const connected: string[] = [];
    for (const project of projects) {
      try {
        await options.connect(project, params.name);
        connected.push(project);
      } catch (err) {
        failed.push(`${project} (${message(err)})`);
      }
    }
    if (failed.length === 0) board.end("projects", "done", `Connected to ${projects.length === 1 ? "1 project" : `${projects.length} projects`}`);
    else board.end("projects", "fail", `Not connected: ${list(failed)}`);
    return connected;
  };

  /** The `open` step: a tab with the agent in `project`; its tab id, or `null` when it failed. */
  const openTab = async (name: string, project: string, board: StepBoard): Promise<string | null> => {
    board.start("open");
    try {
      const tabId = await options.launch(name, project);
      board.end("open", "done", project === WORKSPACE_PROJECT_ID ? "Opened in the Workspace" : `Opened in ${project}`);
      return tabId;
    } catch (err) {
      board.end("open", "fail", `The tab did not open: ${message(err)}`);
      return null;
    }
  };

  const askAlias = async (name: string, folder: string): Promise<{ ok: boolean; detail: string | null }> => {
    try {
      const answer = await zsh.ask(name);
      if (answer.alias === aliasCommand(folder)) return { ok: true, detail: null };
      if (!answer.resolves) return { ok: false, detail: `${name} does not resolve in a fresh zsh` };
      return { ok: false, detail: `${name} resolves to something else: ${answer.description}` };
    } catch (err) {
      return { ok: false, detail: message(err) };
    }
  };

  const addAlias = async (name: string, line: string | null, board: StepBoard): Promise<void> => {
    board.start("alias");
    if (line === null) board.end("alias", "fail", "The agent's folder holds a character an alias line cannot quote");
    else if (rcFile === null) board.end("alias", "fail", "Neither ZDOTDIR nor HOME is set, so the rc file is unknown");
    else {
      try {
        board.end("alias", "done", (await appendOnce(rcFile, line)) === "appended" ? `Appended to ${rcFile}` : `Already in ${rcFile}`);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        board.end("alias", "fail", `Could not write ${rcFile} (${code ?? message(err)})`);
      }
    }
    board.start("verify");
    const checked = await askAlias(name, folderOf(name));
    board.end("verify", checked.ok ? "done" : "fail", checked.detail ?? `${name} resolves in a fresh zsh`);
  };

  return {
    checkName,

    async create(params, progress) {
      const { name } = params;
      const board = stepBoard(progress);
      const folder = folderOf(name);
      const line = aliasLine(name, folder);
      let openIn: string = WORKSPACE_PROJECT_ID;
      let tabId: string | null = null;
      const result = (outcome: CreateAgentResult["outcome"], refused: NameVerdict | null = null): CreateAgentResult => ({
        createId: params.createId,
        name,
        outcome,
        steps: board.steps(),
        refused,
        folder,
        aliasLine: line ?? `alias ${name}='${aliasCommand(folder)}'`,
        rcFile,
        openIn,
        tabId,
      });

      const check = await checkName(name);
      if (check.problem !== null) return result("refused", check);
      creating.add(name);
      try {
        if (!(await makeAgent(params, board))) return result("failed");
        await options.refreshRoster();
        const connected = await connectProjects(params, board);
        openIn = connected[0] ?? WORKSPACE_PROJECT_ID;
        await addAlias(name, line, board);
        if (board.steps().find((s) => s.id === "verify")?.state === "done") tabId = await openTab(name, openIn, board);
        const whole = board.steps().every((s) => s.state === "done" || s.state === "skip");
        log(`create: ${name} created in ${folder}${params.clone === undefined ? "" : ` as a clone of ${params.clone}`}${whole ? "" : " (incomplete)"}`);
        return result(whole ? "created" : "incomplete");
      } finally {
        creating.delete(name);
      }
    },

    async checkAlias(agent, folder) {
      const line = aliasLine(agent, folder);
      const checked = await askAlias(agent, folder);
      return { ok: checked.ok, aliasLine: line ?? `alias ${agent}='${aliasCommand(folder)}'`, rcFile, detail: checked.detail };
    },
  };
}
