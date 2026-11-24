// What the agent's page shows of one agent, as pure functions of its roster entry: the provider,
// whether its profile can be edited, the model line, and the path an editor opens.

import type { AgentProvider, RosterEntry } from "../../../shared/roster.ts";

export const PROVIDER_LABELS: Record<AgentProvider, string> = { claude: "Claude Code", codex: "Codex" };

/** The provider an agent runs, as the roster answers it (an unusable profile answers from first-sight values). */
export function providerOf(entry: RosterEntry): AgentProvider {
  return entry.provider;
}

export function isBuiltin(entry: RosterEntry): boolean {
  return entry.kind === "builtin";
}

/** True when the role and tags can be written: a usable profile of an agent that is not an orphan. */
export function isEditable(entry: RosterEntry): boolean {
  return entry.profile !== null && !entry.orphan;
}

/** The model and effort the header shows: "provider default" when the provider's config sets none. */
export function modelText(entry: RosterEntry): { model: string | null; effort: string | null } {
  return { model: entry.model, effort: entry.model === null ? null : entry.effort };
}

/** The workspace as the editor names it: how Pomade writes it, and with symlinks resolved. */
export interface WorkspaceRoots {
  workspace: string | null;
  workspaceReal: string | null;
}

/** The path `tabs.openFile` takes for an absolute path: workspace-relative inside the workspace, else the absolute path. */
export function openPathOf(absolute: string, roots: WorkspaceRoots): string {
  for (const root of [roots.workspace, roots.workspaceReal]) {
    if (root !== null && root !== "" && absolute.startsWith(`${root}/`)) return absolute.slice(root.length + 1);
  }
  return absolute;
}

/** An agent's profile file, absolute; `null` without a data folder (no workspace). */
export function profileFileOf(dataDir: string | null, id: string): string | null {
  return dataDir === null ? null : `${dataDir}/agents/${id}/agent.yaml`;
}

/** An agent's `CLAUDE.md`, absolute; `null` for Codex and without a usable config folder. */
export function claudeMdOf(entry: RosterEntry): string | null {
  return providerOf(entry) === "claude" && entry.configDir !== null ? `${entry.configDir}/CLAUDE.md` : null;
}
