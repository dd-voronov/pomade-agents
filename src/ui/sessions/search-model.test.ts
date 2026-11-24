import { describe, expect, it } from "vitest";
import { WORKSPACE_PROJECT_ID } from "pomade-kit/protocol";

import type { Session, SessionRecord } from "../../shared/sessions.ts";
import { testSession, testSummary } from "../../shared/test-sessions.ts";
import {
  NO_FILTERS,
  filterMenu,
  folderOf,
  highlightParts,
  isFiltering,
  matchCount,
  matches,
  searchHits,
  searchPattern,
  snippetOf,
  type Criteria,
} from "./search-model.ts";

const at = "2026-11-17T10:00:00.000Z";
const text = (t: string) => ({ text: t, at });

function session(patch: { id?: string; name?: string; note?: string; first?: string; last?: string; answer?: string; agent?: string; cwd?: string | null; projects?: string[]; folderInProject?: string | null; record?: Partial<SessionRecord> } = {}): Session {
  const id = patch.id ?? "s1";
  const first = patch.first === undefined ? null : text(patch.first);
  return testSession({
    id,
    summary: testSummary({
      id,
      agent: patch.agent ?? "claude",
      cwd: patch.cwd === undefined ? "/w" : patch.cwd,
      firstMessage: first,
      lastMessage: patch.last === undefined ? first : { text: patch.last, at: "2026-11-17T11:00:00.000Z" },
      lastAnswer: patch.answer === undefined ? null : text(patch.answer),
    }),
    record: { id, provider: "claude-code", agent: patch.agent ?? "claude", status: "active", ...(patch.name === undefined ? {} : { name: patch.name }), ...(patch.note === undefined ? {} : { note: patch.note }), ...patch.record },
    attribution: { projects: patch.projects ?? [], by: "folder", sharedFolder: (patch.projects?.length ?? 0) > 1 },
    folderInProject: patch.folderInProject ?? null,
  });
}

const pattern = (query: string): RegExp => {
  const p = searchPattern(query);
  if (p === null) throw new Error("blank query");
  return p;
};

describe("the search's pattern", () => {
  it("is null for a blank field", () => {
    expect(searchPattern("")).toBeNull();
    expect(searchPattern("   ")).toBeNull();
  });

  it("matches case-insensitively, the query's characters literally", () => {
    expect(pattern("Debounce").test("add a DEBOUNCE here")).toBe(true);
    expect(pattern("a.b(c)*").test("x a.b(c)* y")).toBe(true);
    expect(pattern("a.b").test("axb")).toBe(false);
    expect(pattern("straße").test("STRASSE")).toBe(false);
    expect(pattern("ПРИВЕТ").test("скажи привет")).toBe(true);
  });

  it("takes a run of spaces for any white space, line breaks included", () => {
    expect(pattern("  fix   the ").test("please fix\n  the build")).toBe(true);
    expect(pattern("fix the").test("fixthe")).toBe(false);
  });
});

describe("what the search covers", () => {
  it("hits the name, the first and last message, the last agent answer and the note", () => {
    const s = session({ name: "Alpha name", first: "beta first", last: "gamma last", answer: "delta answer", note: "epsilon note" });
    for (const word of ["alpha", "beta", "gamma", "delta", "epsilon"]) expect(searchHits(s, pattern(word))).toBe(true);
    expect(searchHits(s, pattern("zeta"))).toBe(false);
  });

  it("hits nothing in a session with no texts", () => {
    expect(searchHits(session(), pattern("a"))).toBe(false);
    expect(searchHits(testSession({ record: null }), pattern("a"))).toBe(false);
  });
});

describe("the snippet line", () => {
  it("names the field of a match the row does not show", () => {
    expect(snippetOf(session({ name: "N", first: "only here: needle" }), pattern("needle"))).toEqual({ label: "First message", text: "only here: needle" });
    expect(snippetOf(session({ name: "N", first: "one", last: "two needle" }), pattern("needle"))).toEqual({ label: "Last message", text: "two needle" });
    expect(snippetOf(session({ name: "N", first: "one", answer: "Fixed the needle." }), pattern("needle"))).toEqual({ label: "Agent", text: "Fixed the needle." });
  });

  it("is left out when a match shows in the row: the name, the note, the start of an unnamed row's first message", () => {
    expect(snippetOf(session({ name: "needle", answer: "needle" }), pattern("needle"))).toBeNull();
    expect(snippetOf(session({ name: "N", note: "needle", answer: "needle" }), pattern("needle"))).toBeNull();
    expect(snippetOf(session({ first: "a needle early", answer: "needle" }), pattern("needle"))).toBeNull();
    expect(snippetOf(session({ name: "N", first: "x" }), pattern("needle"))).toBeNull();
  });

  it("shows a match far into an unnamed row's first message", () => {
    const first = `${"word ".repeat(12)}needle`;
    expect(snippetOf(session({ first }), pattern("needle"))?.label).toBe("First message");
  });

  it("does not search the last message when it is the first", () => {
    const s = session({ name: "N", first: "only needle" });
    expect(snippetOf(s, pattern("needle"))?.label).toBe("First message");
  });

  it("keeps a little text before the match, as one line, with … when cut", () => {
    const long = `${"word ".repeat(10)}\n\nThe   needle\tand more`;
    const snippet = snippetOf(session({ name: "N", answer: long }), pattern("needle"));
    expect(snippet?.text).toBe("…word word word word The needle and more");
  });

  it("starts at a word: a word cut by the window is left out", () => {
    const answer = "Shall we keep the tickets? Shall I also cut the glossary section down?";
    expect(snippetOf(session({ name: "N", answer }), pattern("glossary"))?.text).toBe("…Shall I also cut the glossary section down?");
    const word = `${"x".repeat(40)}needle`;
    expect(snippetOf(session({ name: "N", answer: word }), pattern("needle"))?.text).toBe("…needle");
  });
});

describe("highlighting", () => {
  it("splits a text around every match, keeping its case", () => {
    expect(highlightParts("Needle, a needle and NEEDLE", pattern("needle"))).toEqual([
      { text: "Needle", match: true },
      { text: ", a ", match: false },
      { text: "needle", match: true },
      { text: " and ", match: false },
      { text: "NEEDLE", match: true },
    ]);
  });

  it("is one part when nothing matches, and handles a match across a line break", () => {
    expect(highlightParts("hay", pattern("needle"))).toEqual([{ text: "hay", match: false }]);
    expect(highlightParts("", pattern("needle"))).toEqual([{ text: "", match: false }]);
    expect(highlightParts("fix\nthe", pattern("fix the"))).toEqual([{ text: "fix\nthe", match: true }]);
  });
});

describe("folders", () => {
  const roots = ["/real/ws", "/ws"];

  it("in a project's tab: relative to the project, the root as \"project root\"", () => {
    expect(folderOf(session({ cwd: "/ws/Projects/a/docs", folderInProject: "docs" }), false, roots)).toEqual({ key: "p:docs", label: "docs" });
    expect(folderOf(session({ cwd: "/ws/Projects/a", folderInProject: "" }), false, roots)).toEqual({ key: "p:", label: "project root" });
  });

  it("in the Workspace's tab: relative to the workspace, either way it is named", () => {
    expect(folderOf(session({ cwd: "/ws/Projects/a/docs", folderInProject: "docs" }), true, roots)).toEqual({ key: "w:Projects/a/docs", label: "Projects/a/docs" });
    expect(folderOf(session({ cwd: "/real/ws/Projects/a", folderInProject: "" }), true, roots)).toEqual({ key: "w:Projects/a", label: "Projects/a" });
    expect(folderOf(session({ cwd: "/ws" }), true, roots)).toEqual({ key: "w:", label: "workspace root" });
  });

  it("in the Workspace's tab, a folder reached through a symlink: from the project's folder", () => {
    const s = session({ cwd: "/elsewhere/a/docs", folderInProject: "docs", record: { projectRoot: "Projects/a" } });
    expect(folderOf(s, true, roots)).toEqual({ key: "w:Projects/a/docs", label: "Projects/a/docs" });
  });

  it("outside every root: as recorded; none recorded says so", () => {
    expect(folderOf(session({ cwd: "/tmp/x" }), true, roots)).toEqual({ key: "a:/tmp/x", label: "/tmp/x" });
    expect(folderOf(session({ cwd: "/tmp/x" }), false, roots)).toEqual({ key: "a:/tmp/x", label: "/tmp/x" });
    expect(folderOf(session({ cwd: null }), true, roots)).toEqual({ key: "none", label: "no folder recorded" });
  });
});

describe("filters", () => {
  const roots = ["/ws"];
  const sessions = [
    session({ id: "c1", agent: "claude", cwd: "/ws/Projects/a", folderInProject: "", projects: ["a"], answer: "needle" }),
    session({ id: "c2", agent: "claude", cwd: "/ws/Projects/a/docs", folderInProject: "docs", projects: ["a", "b"] }),
    session({ id: "x1", agent: "codex", cwd: "/ws/Projects/b", folderInProject: "", projects: ["b"], answer: "needle" }),
    session({ id: "w1", agent: "codex", cwd: "/tmp" }),
  ];
  const criteria = (patch: Partial<Criteria> = {}): Criteria => ({ pattern: null, filters: NO_FILTERS, folder: (s) => folderOf(s, true, roots), ...patch });
  const ids = (c: Criteria): string[] => sessions.filter((s) => matches(s, c)).map((s) => s.id);
  const names = new Map([
    ["a", "Alpha"],
    ["b", "Beta"],
  ]);

  it("are off until a search or a filter is on", () => {
    expect(isFiltering(criteria())).toBe(false);
    expect(isFiltering(criteria({ pattern: pattern("x") }))).toBe(true);
    expect(isFiltering(criteria({ filters: { ...NO_FILTERS, folder: "w:" } }))).toBe(true);
  });

  it("leave the sessions that pass the search and every filter", () => {
    expect(ids(criteria())).toEqual(["c1", "c2", "x1", "w1"]);
    expect(ids(criteria({ filters: { ...NO_FILTERS, agent: "codex" } }))).toEqual(["x1", "w1"]);
    expect(ids(criteria({ filters: { ...NO_FILTERS, project: "b" } }))).toEqual(["c2", "x1"]);
    expect(ids(criteria({ filters: { ...NO_FILTERS, project: WORKSPACE_PROJECT_ID } }))).toEqual(["w1"]);
    expect(ids(criteria({ filters: { ...NO_FILTERS, folder: "w:Projects/a/docs" } }))).toEqual(["c2"]);
    expect(ids(criteria({ pattern: pattern("needle"), filters: { ...NO_FILTERS, agent: "claude" } }))).toEqual(["c1"]);
  });

  it("count each option over the search and the other filters, not its own", () => {
    const c = criteria({ pattern: pattern("needle"), filters: { ...NO_FILTERS, agent: "codex" } });
    expect(filterMenu("agent", sessions, c, names)).toEqual({
      all: 2,
      options: [
        { key: "claude", label: "claude", count: 1 },
        { key: "codex", label: "codex", count: 1 },
      ],
    });
    expect(filterMenu("project", sessions, c, names)).toEqual({
      all: 1,
      options: [
        { key: "a", label: "Alpha", count: 0 },
        { key: "b", label: "Beta", count: 1 },
        { key: WORKSPACE_PROJECT_ID, label: "Workspace (no project)", count: 0 },
      ],
    });
  });

  it("list folders root first, then relative paths, absolute ones, none recorded; projects in panel order, an unknown one before the bucket", () => {
    const more = [...sessions, session({ id: "n1", cwd: null }), session({ id: "w2", cwd: "/ws" }), session({ id: "z1", projects: ["zeta"] })];
    expect(filterMenu("folder", more, criteria(), names).options.map((o) => o.label)).toEqual(["workspace root", "Projects/a", "Projects/a/docs", "Projects/b", "/tmp", "/w", "no folder recorded"]);
    expect(filterMenu("project", more, criteria(), names).options.map((o) => o.key)).toEqual(["a", "b", "zeta", WORKSPACE_PROJECT_ID]);
  });

  it("say how many match", () => {
    expect(matchCount(1)).toBe("1 match");
    expect(matchCount(0)).toBe("0 matches");
    expect(matchCount(12)).toBe("12 matches");
  });
});
