// The Settings page's words: counts, the Remove warning, and what a toast says after a change.

import type { SkillFolder } from "../../shared/skills.ts";

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** A folder's links column: "5 links from 3 agents", or "no links". */
export function linksText(folder: Pick<SkillFolder, "links" | "agents">): string {
  return folder.links === 0 ? "no links" : `${plural(folder.links, "link")} from ${plural(folder.agents.length, "agent")}`;
}

/** The warning's lead before removing a folder links depend on. */
export function dependText(folder: Pick<SkillFolder, "links" | "agents">): string {
  return `${plural(folder.links, "skill link")} in ${plural(folder.agents.length, "agent")} ${folder.links === 1 ? "depends" : "depend"} on this folder`;
}

/** The toast after a folder was added. */
export function addedText(path: string, skills: number): string {
  return skills === 0 ? `Added ${path} — it holds no skills yet (no SKILL.md found).` : `Added ${path}: Add skill now offers its ${plural(skills, "skill")}.`;
}

export const removedText = (path: string): string => `Removed ${path} from Skill folders.`;

export const refusedText = (path: string, reason: string): string => `${path} was not added. ${reason}`;
