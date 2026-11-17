// What the backend learns from Pomade on each connection (HOST-API §4): the projects — their stable
// ids and folders (`project.list`, again on `project.created`, `project.renamed` and `pomade.ready`)
// — and which session each agent tab is bound to (`agentTabs.list`, then every `agentTab.changed`;
// pomade:E-033). Subscriptions end with the connection; the next one sets them up again.

import { realpath } from "node:fs/promises";
import { join } from "node:path";

import type { AgentTabInfo, ProjectInfo } from "pomade-kit/protocol";
import type { HostClient } from "pomade-kit/sdk";

import type { ProjectPlace } from "../sessions/attribution.ts";

/** Where the facts go: the session data. */
export interface PlatformFacts {
  setProjects(projects: ProjectPlace[]): void;
  bind(sessionId: string, projectId: string): void;
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
    for (const tab of await host.agentTabs.list()) bindTab(tab);
  };
  const run = (what: string, task: () => Promise<void>): void => {
    task().catch((err: unknown) => log(`pomade: could not ${what}: ${message(err)}`));
  };

  run("follow its projects and agent tabs", async () => {
    await Promise.all([
      host.events.subscribe("project.created", () => run("list the projects", loadProjects)),
      host.events.subscribe("project.renamed", () => run("list the projects", loadProjects)),
      host.events.subscribe("agentTab.changed", ({ tab }) => bindTab(tab)),
      host.events.subscribe("pomade.ready", () => {
        run("list the projects", loadProjects);
        run("list the agent tabs", loadTabs);
      }),
    ]);
    await Promise.all([loadProjects(), loadTabs()]);
  });
}
