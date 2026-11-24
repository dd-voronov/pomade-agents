// The agent page's Projects tab as data (DESIGN §3.4): every project of the workspace as one row —
// its work sessions of the agent in the last 90 days, the agent's last session there — placed under
// Connected (the project's "+" menu offers the agent) or Not connected. Pure: the tab reads the
// projects, the agent's counts and each project's visible agents, and shows what this returns.

import type { ProjectInfo } from "pomade-kit/protocol";

import type { ProjectCounts } from "../../../shared/work-sessions.ts";

/** What a project's visible agents list says for every agent. */
export const EVERY_AGENT = "*";

/** The label of the sidebar's group of projects that sit in none. */
export const UNGROUPED = "Ungrouped";

/** More never-used projects than this are folded behind **Show all projects**. */
export const NEVER_USED_SHOWN = 5;

export type ProjectRow = {
  id: string;
  name: string;
  /** Workspace-relative. */
  root: string;
  /** The agent's work sessions in the project within the window; `null` when it has none in the project, ever. */
  sessions: number | null;
  /** The agent's latest work session in the project, ever (ISO 8601); `null` without one. */
  lastAt: string | null;
  /** The project offers every agent (`["*"]`): the agent is connected, and cannot be disconnected here. */
  everyAgent: boolean;
};

/** Projects in one sidebar group, in the Projects panel's order of groups. */
export type ProjectGroup = {
  /** The group's `GroupInfo.id`; `""` for the ungrouped projects. */
  key: string;
  /** The group's path from the top level, "Work / Clients"; `UNGROUPED` for none. */
  label: string;
  rows: ProjectRow[];
};

export type ProjectsView = {
  /** Projects offering the agent, under the sidebar's groups, the most sessions first inside a group. */
  connected: ProjectGroup[];
  connectedCount: number;
  /** The other projects the agent has sessions in: the most sessions first, then the latest. */
  used: ProjectRow[];
  /** The other projects it never worked in, under the sidebar's groups. */
  never: ProjectGroup[];
  neverCount: number;
  /** `never` is folded behind **Show all projects**. */
  foldable: boolean;
};

export type ProjectsInput = {
  /** In the Projects panel's order, the Workspace not among them. */
  projects: Iterable<ProjectInfo>;
  /** The agent's `AgentCounts.projects`. */
  counts: readonly ProjectCounts[];
  /** Each project's visible agents (`project.getAgents`); a project missing is not known to offer the agent. */
  visible: ReadonlyMap<string, readonly string[]>;
  agent: string;
};

const groupLabel = (project: ProjectInfo): string => (project.groupPath.length === 0 ? UNGROUPED : project.groupPath.join(" / "));

/** Rows under their groups, the groups in the order the panel lists them first. */
function grouped(rows: readonly { row: ProjectRow; project: ProjectInfo }[], order: (a: ProjectRow, b: ProjectRow) => number): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  for (const { row, project } of rows) {
    const key = project.groupId ?? "";
    const group = groups.get(key) ?? { key, label: groupLabel(project), rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  // Array#sort is stable: equal rows keep the panel's order.
  return [...groups.values()].map((group) => ({ ...group, rows: group.rows.sort(order) }));
}

const bySessions = (a: ProjectRow, b: ProjectRow): number => (b.sessions ?? 0) - (a.sessions ?? 0);
const byLast = (a: ProjectRow, b: ProjectRow): number => (b.lastAt === null ? 0 : Date.parse(b.lastAt)) - (a.lastAt === null ? 0 : Date.parse(a.lastAt));

export function projectsView({ projects, counts, visible, agent }: ProjectsInput): ProjectsView {
  const used = new Map(counts.map((c) => [c.project, c]));
  const connected: { row: ProjectRow; project: ProjectInfo }[] = [];
  const others: { row: ProjectRow; project: ProjectInfo }[] = [];
  for (const project of projects) {
    const list = visible.get(project.id) ?? [];
    const everyAgent = list.includes(EVERY_AGENT);
    const count = used.get(project.id);
    const row: ProjectRow = { id: project.id, name: project.name, root: project.root, sessions: count?.sessions ?? null, lastAt: count?.lastAt ?? null, everyAgent };
    (everyAgent || list.includes(agent) ? connected : others).push({ row, project });
  }
  const worked = others.filter(({ row }) => row.sessions !== null);
  const never = others.filter(({ row }) => row.sessions === null);
  return {
    connected: grouped(connected, bySessions),
    connectedCount: connected.length,
    used: worked.map(({ row }) => row).sort((a, b) => bySessions(a, b) || byLast(a, b)),
    never: grouped(never, () => 0),
    neverCount: never.length,
    foldable: never.length > NEVER_USED_SHOWN,
  };
}

/** The visible agents of a project with `agent` added; `list` unchanged when it already offers it or offers every agent. */
export function withAgent(list: readonly string[], agent: string, at?: number): string[] {
  if (list.includes(EVERY_AGENT) || list.includes(agent)) return [...list];
  const next = [...list];
  next.splice(at === undefined ? next.length : Math.min(at, next.length), 0, agent);
  return next;
}

/** The visible agents of a project without `agent`; `list` unchanged when it names no such agent. */
export function withoutAgent(list: readonly string[], agent: string): string[] {
  return list.filter((id) => id !== agent);
}
