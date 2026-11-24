// What the backend learns from Pomade on each connection (HOST-API §4): the projects — their stable
// ids and folders (`project.list`, again on `project.created`, `project.renamed`, `project.removed`
// and `pomade.ready`)
// — and the agent tabs: which session each one is bound to, where it runs and what its agent is
// doing and its title (`agentTabs.list`, again on `pomade.ready`, then every `agentTab.changed`;
// pomade:E-033) —
// and every end of an agent process in a tab, with the session bound to it then (`agentTab.exited`).
// Runner's run started / run finished (`pomade-runner:run.started`, `pomade-runner:run.finished`)
// come through the same bus, as Runner publishes them; the app never calls Runner.
// Subscriptions end with the connection; the next one sets them up again.

import { realpath } from "node:fs/promises";
import { join } from "node:path";

import type { AgentTabChange, AgentTabExitedPayload, AgentTabInfo, ProjectInfo } from "pomade-kit/protocol";
import type { HostClient } from "pomade-kit/sdk";

import { RUN_FINISHED_EVENT, RUN_STARTED_EVENT } from "../../shared/runner-events.ts";
import type { ProjectPlace } from "../sessions/attribution.ts";

/** Where the facts go: the session data and the live state. */
export interface PlatformFacts {
  setProjects(projects: ProjectPlace[]): void;
  bind(sessionId: string, projectId: string): void;
  /** Every agent tab, as Pomade lists them now. */
  listTabs(tabs: readonly AgentTabInfo[]): void;
  /** One agent tab as it is now, and what changed (`closed`: it left the list). */
  tabChanged(tab: AgentTabInfo, changes: readonly AgentTabChange[]): void;
  /** An agent process in a tab ended. */
  tabExited(exited: AgentTabExitedPayload): void;
  /** Runner's run started, its payload as it crossed the bus. */
  runStarted(payload: unknown): void;
  /** Runner's run finished, its payload as it crossed the bus. */
  runFinished(payload: unknown): void;
  /** Pomade finished starting (`pomade.ready`). */
  ready(): void;
}

export interface FollowOptions {
  /** The open workspace's root; `null` when none is open (then Pomade has no projects). */
  workspace: string | null;
  log: (line: string) => void;
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

async function resolved(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

/** Each project with its folder as transcripts record start folders: absolute, symlinks resolved. */
export async function placesOf(projects: readonly ProjectInfo[], workspace: string | null): Promise<ProjectPlace[]> {
  if (workspace === null) return [];
  const root = await resolved(workspace);
  return Promise.all(projects.map(async (p) => ({ id: p.id, root: p.root, folder: await resolved(join(root, p.root)) })));
}

export function followPomade(host: HostClient, facts: PlatformFacts, { workspace, log }: FollowOptions): void {
  /** Only the latest listing lands: an older one answering late is dropped. */
  let asked = 0;
  const loadProjects = async (): Promise<void> => {
    const ask = ++asked;
    const { projects } = await host.project.list();
    const places = await placesOf(projects, workspace);
    if (ask === asked) facts.setProjects(places);
  };
  const bindTab = (tab: AgentTabInfo): void => {
    if (tab.sessionId !== null) facts.bind(tab.sessionId, tab.projectId);
  };
  const loadTabs = async (): Promise<void> => {
    const tabs = await host.agentTabs.list();
    for (const tab of tabs) bindTab(tab);
    facts.listTabs(tabs);
  };
  const run = (what: string, task: () => Promise<void>): void => {
    task().catch((err: unknown) => log(`pomade: could not ${what}: ${message(err)}`));
  };

  run("follow its projects and agent tabs", async () => {
    await Promise.all([
      host.events.subscribe("project.created", () => run("list the projects", loadProjects)),
      host.events.subscribe("project.renamed", () => run("list the projects", loadProjects)),
      host.events.subscribe("project.removed", () => run("list the projects", loadProjects)),
      host.events.subscribe("agentTab.changed", ({ tab, changes }) => {
        bindTab(tab);
        facts.tabChanged(tab, changes);
      }),
      host.events.subscribe("agentTab.exited", (exited) => facts.tabExited(exited)),
      host.events.subscribe(RUN_STARTED_EVENT, (payload) => facts.runStarted(payload)),
      host.events.subscribe(RUN_FINISHED_EVENT, (payload) => facts.runFinished(payload)),
      host.events.subscribe("pomade.ready", () => {
        facts.ready();
        run("list the projects", loadProjects);
        run("list the agent tabs", loadTabs);
      }),
    ]);
    await Promise.all([loadProjects(), loadTabs()]);
  });
}
