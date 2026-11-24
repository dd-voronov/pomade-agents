// Which project a memory folder belongs to. Claude Code files an agent's memory of a project under
// `<configDir>/projects/<folder>/memory/`, where `<folder>` is the project's folder path with every
// character but letters and digits written as `-` (`claudeFolderName`). The path is not recoverable
// from the name, so each project of the workspace is encoded the same way and compared.

import type { ProjectRef } from "pomade-kit/protocol";

import { claudeFolderName } from "../../../shared/roster.ts";
import type { WorkspaceRoots } from "./agent-model.ts";

/** The name each folder name stands for: the workspace's projects and the workspace itself, with the
 *  workspace as Pomade names it and with symlinks resolved. */
export function folderLabels(projects: Iterable<ProjectRef>, roots: WorkspaceRoots): Map<string, string> {
  const labels = new Map<string, string>();
  const bases = [...new Set([roots.workspace, roots.workspaceReal].filter((root): root is string => root !== null && root !== ""))];
  for (const base of bases) {
    labels.set(claudeFolderName(base), "Workspace");
    for (const project of projects) {
      if (project.kind === "project" && project.root !== "") labels.set(claudeFolderName(`${base}/${project.root}`), project.name);
    }
  }
  return labels;
}
