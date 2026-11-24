// What the detail panel and the list's two-line rows show, as pure functions of a session (DESIGN
// §2.7 "List with the detail panel"): the panel's name and live line, its marker notes, the
// start folder relative to the project, the message blocks, the note's save rule and how a failed
// change reads. Values read as in the table (`table-model.ts`).

import type { ErrorCode } from "pomade-kit/protocol";
import { HostError } from "pomade-kit/sdk";

import type { Session, SessionProvider, TimedText } from "../../shared/sessions.ts";
import { LIVE_LABELS } from "../core/live.ts";
import { formatStamp, projectLabel, rowName, sinceStamp } from "./table-model.ts";

export const PROVIDER_LABELS: Record<SessionProvider, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
};

/** The panel's title: the session's name, or "Unnamed session". */
export function detailName(session: Session): { text: string; unnamed: boolean } {
  const name = session.record?.name;
  return name === undefined ? { text: "Unnamed session", unnamed: true } : { text: name, unnamed: false };
}

/** The panel's live line: the live state in words, then since when — "Working", "since 09:05" — or,
 *  Closed, when it was last active: "last active today, 09:05". */
export function liveLine(session: Session, now: Date): { state: string; when: string } {
  if (session.live !== "closed") return { state: LIVE_LABELS[session.live], when: session.liveSince === null ? "" : `since ${sinceStamp(session.liveSince, now)}` };
  const at = session.summary.lastActiveAt;
  return { state: LIVE_LABELS.closed, when: at === null ? "no activity recorded" : `last active ${formatStamp(at, now).replace(/^(Today|Yesterday)\b/, (day) => day.toLowerCase())}` };
}

// ── Marker notes ────────────────────────────────────────────────────────────

export type MarkerNote =
  | { kind: "runner"; job: string }
  /** `parent`: the parent session when this tab lists it, so the note links to it. */
  | { kind: "fork"; parentName: string | null; parent: string | null }
  | { kind: "shared-folder"; projects: string }
  | { kind: "outside-pomade" };

/** The notes above the status: an unattended run, a fork (with its parent), a shared folder, outside Pomade. */
export function markerNotes(session: Session, byId: ReadonlyMap<string, Session>, names: ReadonlyMap<string, string>, inTab: (id: string) => boolean): MarkerNote[] {
  const notes: MarkerNote[] = [];
  const job = session.record?.startedByRunner?.job;
  if (job !== undefined) notes.push({ kind: "runner", job });
  const parentId = session.record?.forkedFrom;
  if (parentId !== undefined) {
    const parent = byId.get(parentId);
    notes.push({ kind: "fork", parentName: parent === undefined ? null : rowName(parent).text, parent: parent !== undefined && inTab(parentId) ? parentId : null });
  }
  if (session.attribution.sharedFolder) notes.push({ kind: "shared-folder", projects: session.attribution.projects.map((id) => names.get(id) ?? id).join(" and ") });
  if (session.record?.outsidePomade) notes.push({ kind: "outside-pomade" });
  return notes;
}

// ── Started in ──────────────────────────────────────────────────────────────

/** `path` relative to `base`: `""` for `base` itself, `"docs/api"` inside it, `null` outside. */
export function relativeTo(base: string, path: string): string | null {
  const root = base.replace(/\/+$/, "");
  const target = path.replace(/\/+$/, "");
  if (target === root) return "";
  return target.startsWith(`${root}/`) ? target.slice(root.length + 1) : null;
}

export interface StartedIn {
  /** `docs/`, `./` for the root it is relative to, or the absolute folder when no known root holds it. */
  folder: string;
  /** What `./` is: "project root" or "workspace root"; `null` otherwise. */
  root: "project root" | "workspace root" | null;
  branch: string | null;
}

/** The first of `roots` that holds `path`, as `path` relative to it; `null` when none does. */
function relativeToAny(roots: readonly string[], path: string): string | null {
  for (const root of roots) {
    const relative = relativeTo(root, path);
    if (relative !== null) return relative;
  }
  return null;
}

/** The start folder relative to the session's (first) project — as the backend resolves it
 *  (`folderInProject`), symlinks and all — else to the workspace, else as recorded; `null` when the
 *  transcript records none. `workspaceRoots` are the workspace's root with symlinks resolved and as
 *  Pomade names it (`app.info`'s `workspaceReal`, `workspace`): a transcript records the folder
 *  either way. Empty while the workspace is not known. */
export function startedIn(session: Session, workspaceRoots: readonly string[]): StartedIn | null {
  const { cwd, branch } = session.summary;
  if (cwd === null) return null;
  const as = (relative: string, root: "project root" | "workspace root"): StartedIn =>
    relative === "" ? { folder: "./", root, branch } : { folder: `${relative}/`, root: null, branch };
  if (session.folderInProject !== null) return as(session.folderInProject, "project root");
  const inWorkspace = relativeToAny(workspaceRoots, cwd);
  if (inWorkspace !== null) return as(inWorkspace, "workspace root");
  return { folder: cwd, root: null, branch };
}

// ── Messages ────────────────────────────────────────────────────────────────

/** True when the last message is the first one: the session has one message from the user. */
export function sameMessage(first: TimedText | null, last: TimedText | null): boolean {
  return first !== null && last !== null && first.text === last.text && first.at === last.at;
}

/** Lines a message block shows until "Show more": the user's messages 4, the agent's answer 7. */
export const CLAMP_LINES = { user: 4, agent: 7 } as const;

// ── The list's two-line rows ────────────────────────────────────────────────

/** The second line's left part: project (Workspace scope) · agent · model · effort. */
export function rowMeta(session: Session, workspace: boolean, names: ReadonlyMap<string, string>): string[] {
  const { agent, model, effort } = session.summary;
  const parts = workspace ? [projectLabel(session, names), agent] : [agent];
  if (model !== null) parts.push(effort === null ? model : `${model} · ${effort}`);
  return parts;
}

// ── The note ────────────────────────────────────────────────────────────────

/** A note as one line: runs of white space (line breaks included) become one space, ends trimmed. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** What saving the note field sends as `sessions.setStatus`'s `note`: the new one-line note, `null`
 *  to remove it (an empty field), or `undefined` when it would not change the saved note. */
export function noteToSave(draft: string, saved: string | undefined): string | null | undefined {
  const note = oneLine(draft);
  if (note === (saved ?? "")) return undefined;
  return note === "" ? null : note;
}

/** The note a row shows while its field is typed in: the draft as one line; `undefined` when it is empty. */
export function draftNote(draft: string): string | undefined {
  const note = oneLine(draft);
  return note === "" ? undefined : note;
}

// ── A failed change ─────────────────────────────────────────────────────────

/** What a change sets: a status, a note, the earlier statuses back (Undo), a name, a project, or
 *  the earlier project back (Undo); or Open / Resume. */
export type ChangeKind = "status" | "note" | "undo" | "rename" | "move" | "move-back" | "open";

/** A failed change as the panel shows it: `text` in plain words, `reason` (the backend's own
 *  words, paths included) on hover. */
export interface FailureText {
  text: string;
  reason: string;
}

/** What went wrong, by the error's Host API code (HOST-API §4 `apps.call`, CONTRACTS "Published API"). */
const CAUSES: Partial<Record<ErrorCode, string>> = {
  "io-error": "The record file could not be written.",
  "not-ready": "Session records are not kept right now.",
  "not-found": "The session is no longer there.",
  "app-absent": "The app's backend is not running.",
  "app-not-responding": "The app's backend did not answer in time.",
};

const LEADS: Record<ChangeKind, string> = {
  status: "The status was not changed.",
  note: "The note was not saved.",
  undo: "The earlier status was not set back.",
  rename: "The name was not saved.",
  move: "The session was not moved.",
  "move-back": "The session was not moved back.",
  open: "The session was not opened.",
};

/** What the panel says when a change fails: what was not done and, in plain words, why. */
export function failureText(kind: ChangeKind, error: unknown): FailureText {
  const lead = LEADS[kind];
  const cause = (error instanceof HostError ? CAUSES[error.code] : undefined) ?? "Something went wrong.";
  const reason = (error instanceof Error ? error.message : String(error)).trim();
  return { text: `${lead} ${cause}`, reason: reason === "" ? cause : reason };
}
