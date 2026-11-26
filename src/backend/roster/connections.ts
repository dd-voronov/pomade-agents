// The project ↔ agent connection (ARCHITECTURE §3.3, pomade:E-030): Pomade stores it as each project's
// visible agents — the agents its "+" menu offers — and the app reads it on every call
// (`project.getAgents`), so it never holds a copy that could go stale.
//
// What Pomade's lists mean (HOST-API §4 `project.read`): roster ids; `["*"]` is every agent (a
// project that never set its list has `["*"]`); `[]` is none. The Workspace offers every agent.
// An agent is connected to a project when the project's "+" menu offers it: it is listed there,
// or the project offers every agent, and it is in `roster.list` (neither hidden nor an orphan).

import { WORKSPACE_PROJECT_ID } from "pomade-kit/protocol";

/** What the connection is read from: Pomade's projects. */
export interface ProjectReads {
  /** Every project's stable id, in the Projects panel's order (the Workspace not among them). */
  projects(): Promise<string[]>;
  /** A project's visible agents as Pomade stores them; rejects with `not-found` for an unknown project. */
  visibleAgents(projectId: string): Promise<string[]>;
}

const EVERY_AGENT = "*";

/** The agents of `listed` (roster ids, in roster order) a project with `visible` offers. */
function offered(visible: readonly string[], listed: readonly string[]): string[] {
  return visible.includes(EVERY_AGENT) ? [...listed] : listed.filter((id) => visible.includes(id));
}

/** The agents connected to `project`, in roster order. */
export async function agentsFor(project: string, listed: readonly string[], reads: ProjectReads): Promise<string[]> {
  if (project === WORKSPACE_PROJECT_ID) return [...listed];
  return offered(await reads.visibleAgents(project), listed);
}

/** The projects `agent` is connected to, in the Projects panel's order. */
export async function projectsFor(agent: string, listed: readonly string[], reads: ProjectReads): Promise<string[]> {
  if (!listed.includes(agent)) return [];
  const projects = await reads.projects();
  // A project removed between the two reads offers nothing.
  const visible = await Promise.all(projects.map((id) => reads.visibleAgents(id).catch((): string[] => [])));
  return projects.filter((_, i) => offered(visible[i] ?? [], [agent]).length > 0);
}

/** Each of `agents` (roster ids) with the projects whose "+" menu offers it, in the Projects panel's
 *  order: the same reading as `projectsFor`, over every project once. Hidden agents are among
 *  `agents` as the project setting offers them; an agent not offered anywhere has `[]`. */
export async function connectionsOf(agents: readonly string[], reads: ProjectReads): Promise<{ agent: string; projects: string[] }[]> {
  const projects = await reads.projects();
  const visible = await Promise.all(projects.map((id) => reads.visibleAgents(id).catch((): string[] => [])));
  return agents.map((agent) => ({ agent, projects: projects.filter((_, i) => offered(visible[i] ?? [], [agent]).length > 0) }));
}
