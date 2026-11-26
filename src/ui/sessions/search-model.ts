// Search and filters of the Sessions tab (ARCHITECTURE §2.7 "Both layouts"), as pure functions: the
// search's pattern, which of a session's texts it hits, the snippet line a row adds for a hit it
// does not show, the parts a text splits into around its matches, each session's folder, and the
// filters' options with their counts.
//
// The search is one phrase, case-insensitive; a run of spaces in it matches any run of white
// space, line breaks included, so a phrase finds text that wraps in the transcript.

import { WORKSPACE_PROJECT_ID } from "pomade-kit/protocol";

import type { Session } from "../../shared/sessions.ts";
import { relativeTo, sameMessage } from "./detail-model.ts";
import { WORKSPACE_TARGET } from "./edit-model.ts";

// ── The search ──────────────────────────────────────────────────────────────

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The search's pattern for what the user typed; `null` for an empty or blank field. */
export function searchPattern(query: string): RegExp | null {
  const words = query.trim().split(/\s+/).filter((word) => word !== "");
  return words.length === 0 ? null : new RegExp(words.map(escape).join("\\s+"), "iu");
}

/** The texts the search covers, in the order a hit is looked for. */
export type HitField = "name" | "first" | "last" | "answer" | "note";

export const SNIPPET_LABELS: Record<Exclude<HitField, "name" | "note">, string> = {
  first: "First message",
  last: "Last message",
  answer: "Agent",
};

/** The texts of a session the search covers; the last message only when it is not the first. */
export function searchTexts(session: Session): [HitField, string][] {
  const { firstMessage, lastMessage, lastAnswer } = session.summary;
  const texts: [HitField, string | undefined][] = [
    ["name", session.record?.name],
    ["first", firstMessage?.text],
    ["last", sameMessage(firstMessage, lastMessage) ? undefined : lastMessage?.text],
    ["answer", lastAnswer?.text],
    ["note", session.record?.note],
  ];
  return texts.filter((entry): entry is [HitField, string] => entry[1] !== undefined && entry[1] !== "");
}

/** True when the pattern hits any of the session's texts. */
export function searchHits(session: Session, pattern: RegExp): boolean {
  return searchTexts(session).some(([, text]) => pattern.test(text));
}

/** An unnamed row shows its first message as the name, cut at the row's width: a match this far
 *  into it is taken to show; one further in adds a "First message" snippet. */
export const FIRST_SHOWN_CHARS = 48;

/** Whether a hit in `field` shows in the row as it is: the name, the note (its own line), or the
 *  start of an unnamed session's first message. */
function shownInRow(field: HitField, text: string, session: Session, pattern: RegExp): boolean {
  if (field === "name" || field === "note") return true;
  if (field !== "first" || session.record?.name !== undefined) return false;
  const index = text.replace(/\s+/g, " ").trim().search(pattern);
  return index >= 0 && index < FIRST_SHOWN_CHARS;
}

/** How much of the text before a match a snippet keeps at most: from the first word that starts
 *  within it. */
export const SNIPPET_BEFORE = 28;
/** How much after the match's start a snippet takes; the row cuts it at its width. */
const SNIPPET_AFTER = 200;

export interface Snippet {
  label: string;
  /** One line: the text around the first match, "…" in front when it starts mid-text. */
  text: string;
}

/** The snippet line a row adds under it: `null` when nothing matches, or a match already shows in
 *  the row; else the first field that matches. */
export function snippetOf(session: Session, pattern: RegExp): Snippet | null {
  const hits = searchTexts(session).filter(([, text]) => pattern.test(text));
  if (hits.some(([field, text]) => shownInRow(field, text, session, pattern))) return null;
  const hit = hits[0];
  if (hit === undefined) return null;
  const [field, text] = hit;
  if (field === "name" || field === "note") return null;
  const index = text.search(pattern);
  let from = Math.max(0, index - SNIPPET_BEFORE);
  if (from > 0) {
    const space = text.slice(from - 1, index).search(/\s/);
    from = space < 0 ? index : from - 1 + space + 1;
  }
  const around = text.slice(from, index + SNIPPET_AFTER).replace(/\s+/g, " ");
  return { label: SNIPPET_LABELS[field], text: from > 0 ? `…${around.trimStart()}` : around.trim() };
}

export interface TextPart {
  text: string;
  match: boolean;
}

/** `text` split around every match of `pattern`, in order; one unmatched part when none matches. */
export function highlightParts(text: string, pattern: RegExp): TextPart[] {
  const every = new RegExp(pattern.source, "giu");
  const parts: TextPart[] = [];
  let at = 0;
  for (const match of text.matchAll(every)) {
    if (match[0] === "") continue;
    if (match.index > at) parts.push({ text: text.slice(at, match.index), match: false });
    parts.push({ text: match[0], match: true });
    at = match.index + match[0].length;
  }
  if (at < text.length || parts.length === 0) parts.push({ text: text.slice(at), match: false });
  return parts;
}

// ── Folders ─────────────────────────────────────────────────────────────────

export interface Folder {
  /** Tells folders apart: how the folder is named (`p:` project-relative, `w:` workspace-relative,
   *  `a:` absolute) and its path; `none` when the transcript records no folder. */
  key: string;
  label: string;
}

/** How the Folder filter names the folder of `key` (a `Folder.key`). */
export function folderLabel(key: string): string {
  if (key === "none") return "no folder recorded";
  if (key === "p:") return "project root";
  if (key === "w:") return "workspace root";
  return key.slice(2);
}

const folder = (key: string): Folder => ({ key, label: folderLabel(key) });
const NO_FOLDER = folder("none");
const inProject = (relative: string): Folder => folder(`p:${relative}`);
const inWorkspace = (relative: string): Folder => folder(`w:${relative}`);

function workspaceRelative(cwd: string, workspaceRoots: readonly string[]): string | null {
  for (const root of workspaceRoots) {
    const relative = relativeTo(root, cwd);
    if (relative !== null) return relative;
  }
  return null;
}

/** A session's start folder as the Folder filter names it: in a project's tab relative to the
 *  project (as the backend resolves it, `folderInProject`), in the Workspace's tab relative to the
 *  workspace — from the recorded folder, else from the project's folder (`projectRoot`) and the
 *  folder in it; else as recorded. `workspaceRoots`: the workspace's root as Pomade names it and
 *  with symlinks resolved. */
export function folderOf(session: Session, workspaceScope: boolean, workspaceRoots: readonly string[]): Folder {
  const { cwd } = session.summary;
  if (!workspaceScope && session.folderInProject !== null) return inProject(session.folderInProject);
  const relative = cwd === null ? null : workspaceRelative(cwd, workspaceRoots);
  if (relative !== null) return inWorkspace(relative);
  const projectRoot = session.record?.projectRoot;
  if (workspaceScope && projectRoot !== undefined && session.folderInProject !== null) {
    return inWorkspace([projectRoot, session.folderInProject].filter((part) => part !== "").join("/"));
  }
  return cwd === null ? NO_FOLDER : folder(`a:${cwd}`);
}

// ── Filters ─────────────────────────────────────────────────────────────────

export type FilterKind = "agent" | "folder" | "project";

/** The filters that are on: an agent (roster id), a folder (`Folder.key`), a project (stable id, or
 *  `WORKSPACE_PROJECT_ID` for the Workspace bucket); `null` for off. */
export type Filters = Record<FilterKind, string | null>;

export const NO_FILTERS: Filters = { agent: null, folder: null, project: null };

/** The places a session shows in, as the Project filter knows them. */
export function projectsOf(session: Session): readonly string[] {
  const { projects } = session.attribution;
  return projects.length === 0 ? [WORKSPACE_PROJECT_ID] : projects;
}

/** What the search and filters test a session against. */
export interface Criteria {
  pattern: RegExp | null;
  filters: Filters;
  folder: (session: Session) => Folder;
}

/** True while a search or any filter is on. */
export function isFiltering(criteria: Pick<Criteria, "pattern" | "filters">): boolean {
  const { agent, folder, project } = criteria.filters;
  return criteria.pattern !== null || agent !== null || folder !== null || project !== null;
}

/** True when the session passes the search and every filter that is on, but `skip`. */
export function matches(session: Session, criteria: Criteria, skip: FilterKind | null = null): boolean {
  const { agent, folder, project } = criteria.filters;
  if (skip !== "agent" && agent !== null && session.summary.agent !== agent) return false;
  if (skip !== "project" && project !== null && !projectsOf(session).includes(project)) return false;
  if (skip !== "folder" && folder !== null && criteria.folder(session).key !== folder) return false;
  return criteria.pattern === null || searchHits(session, criteria.pattern);
}

export interface FilterOption {
  key: string;
  label: string;
  /** The sessions it would leave, with the search and the other filters as they are. */
  count: number;
}

export interface FilterMenu {
  /** The sessions "All …" would leave. */
  all: number;
  options: FilterOption[];
}

const byLabel = (a: FilterOption, b: FilterOption): number => a.label.localeCompare(b.label);

/** A filter's menu: every value the tab's sessions hold, counted over the sessions that pass the
 *  search and the other filters. Agents by name; folders with the root first, then the relative
 *  paths, the absolute ones and "no folder recorded";
 *  projects in the order of `names` (Projects panel order), one `names` lacks after them, then the
 *  Workspace bucket. */
export function filterMenu(kind: FilterKind, sessions: readonly Session[], criteria: Criteria, names: ReadonlyMap<string, string>): FilterMenu {
  const labels = new Map<string, string>();
  const counts = new Map<string, number>();
  let all = 0;
  for (const session of sessions) {
    const keys: { key: string; label: string }[] =
      kind === "agent"
        ? [{ key: session.summary.agent, label: session.summary.agent }]
        : kind === "folder"
          ? [criteria.folder(session)]
          : projectsOf(session).map((id) => ({ key: id, label: id === WORKSPACE_PROJECT_ID ? WORKSPACE_TARGET : (names.get(id) ?? id) }));
    const counted = matches(session, criteria, kind);
    if (counted) all += 1;
    for (const { key, label } of keys) {
      labels.set(key, label);
      counts.set(key, (counts.get(key) ?? 0) + (counted ? 1 : 0));
    }
  }
  const options = [...labels].map(([key, label]) => ({ key, label, count: counts.get(key) ?? 0 }));
  if (kind === "agent") options.sort(byLabel);
  if (kind === "folder") {
    const rank = (option: FilterOption): number => {
      if (option.key === "p:" || option.key === "w:") return 0;
      if (option.key === "none") return 3;
      return option.key.startsWith("a:") ? 2 : 1;
    };
    options.sort((a, b) => rank(a) - rank(b) || byLabel(a, b));
  }
  if (kind === "project") {
    const order = [...names.keys(), WORKSPACE_PROJECT_ID];
    const rank = (option: FilterOption): number => {
      const index = order.indexOf(option.key);
      return index < 0 ? names.size - 0.5 : index;
    };
    options.sort((a, b) => rank(a) - rank(b) || byLabel(a, b));
  }
  return { all, options };
}

/** "1 match", "12 matches". */
export function matchCount(count: number): string {
  return count === 1 ? "1 match" : `${count} matches`;
}
