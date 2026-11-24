// What editing an agent's role line and tags in place sends and says, as pure functions: the role
// to save from the field's text, the tags a typed entry adds, and the words for a refused change.

import type { ErrorCode } from "pomade-kit/protocol";
import { HostError } from "pomade-kit/sdk";

import { TAG_MAX } from "../../../shared/roster.ts";

/** A role line from the field's text: runs of white space become one space, ends trimmed. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** What saving the role field sends as `roster.updateProfile`'s `role`: the new line, `null` to
 *  remove it (an empty field), or `undefined` when it would not change the saved one. */
export function roleToSave(draft: string, saved: string | undefined): string | null | undefined {
  const role = oneLine(draft);
  if (role === (saved ?? "")) return undefined;
  return role === "" ? null : role;
}

/** The tags a typed entry holds: split at commas, each lower-cased, one line, cut to `TAG_MAX`, none empty. */
export function tagsOf(entry: string): string[] {
  return entry
    .split(",")
    .map((tag) => oneLine(tag).toLowerCase().slice(0, TAG_MAX).trim())
    .filter((tag) => tag !== "");
}

/** `tags` with the entry's tags added after them; the same list (`===`) when it adds none. */
export function withTags(tags: readonly string[], entry: string): readonly string[] {
  const added = tagsOf(entry).filter((tag, i, all) => !tags.includes(tag) && all.indexOf(tag) === i);
  return added.length === 0 ? tags : [...tags, ...added];
}

/** `tags` without `tag`. */
export function withoutTag(tags: readonly string[], tag: string): string[] {
  return tags.filter((t) => t !== tag);
}

export type EditKind = "role" | "tags";

const CAUSES: Partial<Record<ErrorCode, string>> = {
  "io-error": "agent.yaml could not be written, or it cannot be used as it is.",
  "not-ready": "Agent profiles are not kept right now.",
  "not-found": "The agent is no longer there.",
  "invalid-params": "The backend refused it.",
  "app-absent": "The app's backend is not running.",
  "app-not-responding": "The app's backend did not answer in time.",
};

const LEADS: Record<EditKind, string> = { role: "The role line was not saved.", tags: "The tags were not saved." };

/** What a refused change says: `text` in plain words, `reason` (the backend's own words) on hover. */
export function failureText(kind: EditKind, error: unknown): { text: string; reason: string } {
  const cause = (error instanceof HostError ? CAUSES[error.code] : undefined) ?? "Something went wrong.";
  const reason = (error instanceof Error ? error.message : String(error)).trim();
  return { text: `${LEADS[kind]} ${cause}`, reason: reason === "" ? cause : reason };
}

/** What a saved change says. */
export const SAVED_TEXT: Record<EditKind, string> = { role: "Role line saved to agent.yaml.", tags: "Tags saved to agent.yaml." };
