// A change of an agent's role line, tags, modes and hidden mark (`roster.updateProfile`): what it may hold, and
// the profile it makes. Only these keys are edited here; the profile's other keys are never touched.
// Normal is always on (ARCHITECTURE §3.4): an edit can switch only the other modes off.

import { MODE_IDS, ROLE_MAX, TAG_MAX, TAGS_MAX, isRoleLine, isTagList, type AgentProfile, type ModeId } from "../../shared/roster.ts";

export type ProfileEdit = {
  /** A new role line; `null` removes it. Absent: unchanged. */
  role?: string | null;
  /** The whole new tag list. Absent: unchanged. */
  tags?: string[];
  /** Modes switched on or off. Absent: unchanged. */
  modes?: Partial<Record<ModeId, boolean>>;
  /** Left out of Pomade's "+" menu, or offered there. Absent: unchanged. */
  hidden?: boolean;
};

/** `raw` as an edit, or what is wrong with it. */
export function checkProfileEdit(role: unknown, tags: unknown, modes?: unknown, hidden?: unknown): { ok: true; edit: ProfileEdit } | { ok: false; problem: string } {
  const edit: ProfileEdit = {};
  if (role !== undefined) {
    if (role !== null && !isRoleLine(role)) {
      return { ok: false, problem: `"role" must be one line of at most ${ROLE_MAX} characters, or null` };
    }
    edit.role = role === null ? null : role.trim();
  }
  if (tags !== undefined) {
    if (!isTagList(tags)) {
      return { ok: false, problem: `"tags" must be a list of at most ${TAGS_MAX} tags, each one line of at most ${TAG_MAX} characters` };
    }
    const trimmed = tags.map((t) => t.trim());
    if (new Set(trimmed).size !== trimmed.length) return { ok: false, problem: '"tags" must not repeat a tag' };
    edit.tags = trimmed;
  }
  if (modes !== undefined) {
    const entries = typeof modes === "object" && modes !== null && !Array.isArray(modes) ? Object.entries(modes) : null;
    if (entries === null || entries.length === 0 || !entries.every(([id, on]) => (MODE_IDS as readonly string[]).includes(id) && typeof on === "boolean")) {
      return { ok: false, problem: `"modes" must map one or more of ${MODE_IDS.join(", ")} to true or false` };
    }
    if ((modes as Record<string, boolean>).normal === false) return { ok: false, problem: "Normal is always on: it cannot be switched off" };
    edit.modes = modes as Partial<Record<ModeId, boolean>>;
  }
  if (hidden !== undefined) {
    if (typeof hidden !== "boolean") return { ok: false, problem: '"hidden" must be true or false' };
    edit.hidden = hidden;
  }
  if (edit.role === undefined && edit.tags === undefined && edit.modes === undefined && edit.hidden === undefined) return { ok: false, problem: 'give "role", "tags", "modes", "hidden" or some of them' };
  return { ok: true, edit };
}

/** `profile` with the edit applied. */
export function editedProfile(profile: AgentProfile, edit: ProfileEdit): AgentProfile {
  const { role: _role, ...rest } = profile;
  const role = edit.role === undefined ? profile.role : (edit.role ?? undefined);
  const modes = { ...profile.modes };
  for (const id of MODE_IDS) {
    const on = edit.modes?.[id];
    if (on !== undefined) modes[id] = { ...modes[id], enabled: on };
  }
  return { ...rest, ...(role === undefined ? {} : { role }), tags: edit.tags ?? profile.tags, hidden: edit.hidden ?? profile.hidden, modes };
}
