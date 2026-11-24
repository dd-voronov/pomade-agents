// A change of an agent's role line and tags (`roster.updateProfile`): what it may hold, and the
// profile it makes. Only these two keys are edited here; the profile's other keys are never touched.

import { ROLE_MAX, TAG_MAX, type AgentProfile } from "../../shared/roster.ts";

export type ProfileEdit = {
  /** A new role line; `null` removes it. Absent: unchanged. */
  role?: string | null;
  /** The whole new tag list. Absent: unchanged. */
  tags?: string[];
};

/** The most tags one agent holds. */
export const TAGS_MAX = 20;

const oneLine = (text: string): boolean => text.trim() !== "" && !/[\r\n\0]/.test(text);

/** `raw` as an edit, or what is wrong with it. */
export function checkProfileEdit(role: unknown, tags: unknown): { ok: true; edit: ProfileEdit } | { ok: false; problem: string } {
  const edit: ProfileEdit = {};
  if (role !== undefined) {
    if (role !== null && (typeof role !== "string" || !oneLine(role) || role.trim().length > ROLE_MAX)) {
      return { ok: false, problem: `"role" must be one line of at most ${ROLE_MAX} characters, or null` };
    }
    edit.role = role === null ? null : role.trim();
  }
  if (tags !== undefined) {
    if (!Array.isArray(tags) || tags.length > TAGS_MAX || !tags.every((t) => typeof t === "string" && oneLine(t) && t.trim().length <= TAG_MAX)) {
      return { ok: false, problem: `"tags" must be a list of at most ${TAGS_MAX} tags, each one line of at most ${TAG_MAX} characters` };
    }
    const trimmed = (tags as string[]).map((t) => t.trim());
    if (new Set(trimmed).size !== trimmed.length) return { ok: false, problem: '"tags" must not repeat a tag' };
    edit.tags = trimmed;
  }
  if (edit.role === undefined && edit.tags === undefined) return { ok: false, problem: 'give "role", "tags" or both' };
  return { ok: true, edit };
}

/** `profile` with the edit applied. */
export function editedProfile(profile: AgentProfile, edit: ProfileEdit): AgentProfile {
  const { role: _role, ...rest } = profile;
  const role = edit.role === undefined ? profile.role : (edit.role ?? undefined);
  return { ...rest, ...(role === undefined ? {} : { role }), tags: edit.tags ?? profile.tags };
}
