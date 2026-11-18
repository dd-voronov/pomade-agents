// Which project(s) a session shows in (DESIGN §2.6), in order: Move to project; the project of the
// Pomade tab that first ran it (`launchedFrom`; a tab in the Workspace scope places it in the
// Workspace bucket, in no project); the deepest project root holding its start folder
// — every project on that root when several share it; the project it was placed in before, when no
// project root holds the folder any more (its project was renamed or moved: ids are stable,
// pomade:E-030); else the Workspace bucket. A project that no longer exists never holds a session.

import { sep } from "node:path";
import { WORKSPACE_PROJECT_ID } from "pomade-kit/protocol";

import type { Attribution, SessionRecord } from "../../shared/sessions.ts";

/** A project as attribution sees it. */
export interface ProjectPlace {
  /** Stable id. */
  id: string;
  /** Workspace-relative, as Pomade names it (`ProjectRef.root`). */
  root: string;
  /** Absolute, symlinks resolved: what start folders are compared with. */
  folder: string;
}

export interface AttributionInput {
  /** The start folder: absolute, as the transcript records it. */
  cwd: string | null;
  record: Pick<SessionRecord, "project" | "projectOverride" | "launchedFrom"> | null;
  /** Pomade's projects in sidebar order; `null` while not known (Pomade not reached yet). */
  projects: readonly ProjectPlace[] | null;
}

export const isInside = (folder: string, path: string): boolean => path === folder || path.startsWith(folder.endsWith(sep) ? folder : folder + sep);

/** The projects whose root is the deepest one holding `cwd`, in sidebar order. */
export function projectsHolding(cwd: string, projects: readonly ProjectPlace[]): ProjectPlace[] {
  const holding = projects.filter((p) => isInside(p.folder, cwd));
  const deepest = Math.max(...holding.map((p) => p.folder.length));
  return holding.filter((p) => p.folder.length === deepest);
}

export function attribute({ cwd, record, projects }: AttributionInput): Attribution {
  /** A project id names a project that exists — or may, while the projects are not known. */
  const exists = (id: string): boolean => projects === null || projects.some((p) => p.id === id);
  const only = (id: string, by: Attribution["by"]): Attribution => ({ projects: [id], by, sharedFolder: false });

  if (record?.projectOverride) {
    if (record.project === undefined) return { projects: [], by: "override", sharedFolder: false };
    if (exists(record.project)) return only(record.project, "override");
  }
  if (record?.launchedFrom === WORKSPACE_PROJECT_ID) return { projects: [], by: "launched", sharedFolder: false };
  if (record?.launchedFrom !== undefined && exists(record.launchedFrom)) return only(record.launchedFrom, "launched");
  if (projects !== null && cwd !== null) {
    const holding = projectsHolding(cwd, projects);
    if (holding.length > 0) return { projects: holding.map((p) => p.id), by: "folder", sharedFolder: holding.length > 1 };
  }
  if (record?.project !== undefined && exists(record.project)) return only(record.project, "remembered");
  return { projects: [], by: "workspace", sharedFolder: false };
}
