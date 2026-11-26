// Naming a session and moving it to another project (ARCHITECTURE §2.5, §2.6, §2.7), as pure functions:
// what a typed name saves, the projects Move to project offers and which one is checked, the
// project Undo moves a session back to, and what the toasts say.

import { WORKSPACE_PROJECT_ID, type ProjectRef } from "pomade-kit/protocol";

import type { Session, SessionRecord } from "../../shared/sessions.ts";
import { cutForToast } from "./check-model.ts";

// ── Rename ──────────────────────────────────────────────────────────────────

/** What `sessions.rename` gets for the typed `text`: the trimmed name, `null` for an empty one
 *  (unnamed again), or `undefined` when it is the name the session has — nothing to save. */
export function nameToSave(text: string, saved: string | undefined): string | null | undefined {
  const name = text.trim();
  if (name === (saved ?? "")) return undefined;
  return name === "" ? null : name;
}

/** True while an agent tab is bound to the session (`Session.tab`), so a new name becomes that
 *  tab's title. A Runner run has no agent tab. */
export function inAgentTab(session: Session): boolean {
  return session.tab !== null;
}

/** What the toast says once `session` was renamed to `name` (`null`: unnamed again). It mentions
 *  the tab only when an agent tab is bound to the session now. */
export function renamedText(session: Session, name: string | null): string {
  if (name === null) return "Name removed — the session is unnamed again";
  const quoted = `“${cutForToast(name)}”`;
  return inAgentTab(session) ? `Renamed — the tab title follows: ${quoted}` : `Renamed to ${quoted}`;
}

// ── Move to project ─────────────────────────────────────────────────────────

/** A place Move to project offers: a project, or the Workspace bucket (`WORKSPACE_PROJECT_ID`). */
export interface MoveTarget {
  id: string;
  name: string;
}

/** How the menu names the Workspace bucket, as the Project filter does. */
export const WORKSPACE_TARGET = "Workspace (no project)";

/** Every project in Projects panel order, then the Workspace bucket. */
export function moveTargets(projects: Iterable<Pick<ProjectRef, "id" | "name">>): MoveTarget[] {
  return [...[...projects].map((p) => ({ id: p.id, name: p.name })), { id: WORKSPACE_PROJECT_ID, name: WORKSPACE_TARGET }];
}

/** The place the session shows in now, as a `MoveTarget` id; `null` while it shows in several
 *  (a shared folder) — moving pins it to one. */
export function currentTarget(session: Session): string | null {
  const { projects } = session.attribution;
  if (projects.length === 0) return WORKSPACE_PROJECT_ID;
  return projects.length === 1 ? (projects[0] ?? null) : null;
}

/** What `sessions.moveToProject` takes to put a session back where `record` had it: the place the
 *  user had chosen, or `null` — its automatic project — when there was none. */
export function moveBack(record: SessionRecord | null): string | null {
  if (record?.projectOverride !== true) return null;
  return record.project ?? WORKSPACE_PROJECT_ID;
}

/** What the toast says once a session was moved to `target`. */
export function movedToText(target: MoveTarget): string {
  return target.id === WORKSPACE_PROJECT_ID ? "Moved to the Workspace" : `Moved to ${target.name}`;
}
