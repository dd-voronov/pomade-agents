import { describe, expect, it } from "vitest";
import { HostError } from "pomade-kit/sdk";
import type { ProjectRef } from "pomade-kit/protocol";

import type { Session } from "../../shared/sessions.ts";
import { testSession, testSummary } from "../../shared/test-sessions.ts";
import {
  detailName,
  draftNote,
  failureText,
  lastActiveLine,
  markerNotes,
  noteToSave,
  oneLine,
  relativeTo,
  rowMeta,
  sameMessage,
  startedIn,
} from "./detail-model.ts";

const NOW = new Date(2026, 10, 17, 15, 0);
const local = (day: number, h: number, m: number): string => new Date(2026, 10, day, h, m).toISOString();

const PROJECTS: ReadonlyMap<string, ProjectRef> = new Map([
  ["alpha", { id: "alpha", kind: "project", name: "Alpha", root: "Projects/alpha" }],
  ["twin", { id: "twin", kind: "project", name: "Alpha twin", root: "Projects/alpha" }],
]);
const NAMES: ReadonlyMap<string, string> = new Map([...PROJECTS].map(([id, p]) => [id, p.name]));

const inProject = (cwd: string | null, projects: string[] = ["alpha"], branch: string | null = null): Session =>
  testSession({ summary: testSummary({ cwd, branch }), attribution: { projects, by: "folder", sharedFolder: projects.length > 1 } });

describe("the panel's head", () => {
  it("names the session, or says it is unnamed", () => {
    expect(detailName(testSession({ record: { id: "s1", provider: "claude-code", agent: "claude", status: "active", name: "Plan it" } }))).toEqual({ text: "Plan it", unnamed: false });
    expect(detailName(testSession())).toEqual({ text: "Unnamed session", unnamed: true });
    expect(detailName(testSession({ record: null }))).toEqual({ text: "Unnamed session", unnamed: true });
  });

  it("says when it was last active", () => {
    expect(lastActiveLine(local(17, 9, 5), NOW)).toBe("Last active today, 09:05");
    expect(lastActiveLine(local(16, 18, 40), NOW)).toBe("Last active yesterday, 18:40");
    expect(lastActiveLine(local(3, 9, 5), NOW)).toBe("Last active Nov 3, 09:05");
    expect(lastActiveLine(null, NOW)).toBe("No activity recorded");
  });
});

describe("marker notes", () => {
  const parent = testSession({ id: "p", record: { id: "p", provider: "claude-code", agent: "claude", status: "done", name: "The parent" } });
  const byId = new Map([["p", parent]]);
  const record = { id: "s1", provider: "claude-code" as const, agent: "claude", status: "active" as const };

  it("tell of an unattended run, a fork, a shared folder and outside Pomade, in that order", () => {
    const session = testSession({
      record: { ...record, startedByRunner: { job: "nightly" }, forkedFrom: "p", outsidePomade: true },
      attribution: { projects: ["alpha", "twin"], by: "folder", sharedFolder: true },
    });
    expect(markerNotes(session, byId, NAMES, () => true)).toEqual([
      { kind: "runner", job: "nightly" },
      { kind: "fork", parentName: "The parent", parent: "p" },
      { kind: "shared-folder", projects: "Alpha and Alpha twin" },
      { kind: "outside-pomade" },
    ]);
  });

  it("link a fork's parent only when this tab lists it, and name it only when it is known", () => {
    const fork = testSession({ record: { ...record, forkedFrom: "p" } });
    expect(markerNotes(fork, byId, NAMES, () => false)).toEqual([{ kind: "fork", parentName: "The parent", parent: null }]);
    expect(markerNotes(fork, new Map(), NAMES, () => true)).toEqual([{ kind: "fork", parentName: null, parent: null }]);
  });

  it("are none for a plain session", () => {
    expect(markerNotes(testSession(), byId, NAMES, () => true)).toEqual([]);
  });
});

describe("started in", () => {
  it("is relative to a path, never matching a sibling that shares its name's start", () => {
    expect(relativeTo("/w/p", "/w/p")).toBe("");
    expect(relativeTo("/w/p/", "/w/p/docs/api/")).toBe("docs/api");
    expect(relativeTo("/w/p", "/w/px/docs")).toBeNull();
    expect(relativeTo("/w/p", "/w")).toBeNull();
  });

  /** A session started in `cwd`, `folderInProject` as the backend placed it. */
  const placed = (cwd: string | null, folderInProject: string | null, branch: string | null = null): Session =>
    testSession({ summary: testSummary({ cwd, branch }), attribution: { projects: folderInProject === null ? [] : ["alpha"], by: "folder", sharedFolder: false }, folderInProject });

  it("is the folder relative to the session's project, as the backend resolves it, with the branch", () => {
    expect(startedIn(placed("/ws/Projects/alpha/docs", "docs", "main"), ["/ws"])).toEqual({ folder: "docs/", root: null, branch: "main" });
    expect(startedIn(placed("/ws/Projects/alpha", ""), ["/ws/"])).toEqual({ folder: "./", root: "project root", branch: null });
  });

  it("is relative to the project also when the folder or the project's root is reached through a symlink", () => {
    expect(startedIn(placed("/ws/Projects/alpha-link/docs", "docs"), ["/ws"])).toEqual({ folder: "docs/", root: null, branch: null });
    expect(startedIn(placed("/elsewhere/alpha", ""), ["/ws"])).toEqual({ folder: "./", root: "project root", branch: null });
  });

  it("is relative to the workspace for the Workspace bucket, or when the project's folder does not hold it", () => {
    expect(startedIn(placed("/ws/notes", null), ["/ws"])).toEqual({ folder: "notes/", root: null, branch: null });
    expect(startedIn(placed("/ws", null), ["/ws"])).toEqual({ folder: "./", root: "workspace root", branch: null });
    expect(startedIn(inProject("/ws/Projects/beta/src", ["alpha"]), ["/ws"])).toEqual({ folder: "Projects/beta/src/", root: null, branch: null });
  });

  it("is relative to the workspace through a symlinked workspace, whichever way the transcript records the folder", () => {
    expect(startedIn(placed("/private/ws/notes", null), ["/private/ws", "/ws"])).toEqual({ folder: "notes/", root: null, branch: null });
    expect(startedIn(placed("/ws/notes", null), ["/private/ws", "/ws"])).toEqual({ folder: "notes/", root: null, branch: null });
  });

  it("is the folder as recorded outside the workspace, or before the workspace is known", () => {
    expect(startedIn(placed("/elsewhere/x", null), ["/ws"])).toEqual({ folder: "/elsewhere/x", root: null, branch: null });
    expect(startedIn(placed("/ws/Projects/alpha/docs", null), [])).toEqual({ folder: "/ws/Projects/alpha/docs", root: null, branch: null });
  });

  it("is nothing when the transcript records no folder", () => {
    expect(startedIn(inProject(null), ["/ws"])).toBeNull();
  });
});

describe("messages", () => {
  it("are the same only when the last message is the first one", () => {
    const first = { text: "Fix it", at: "2026-11-17T10:00:00.000Z" };
    expect(sameMessage(first, { ...first })).toBe(true);
    expect(sameMessage(first, { text: "Fix it", at: "2026-11-17T11:00:00.000Z" })).toBe(false);
    expect(sameMessage(first, { text: "Thanks", at: first.at })).toBe(false);
    expect(sameMessage(null, null)).toBe(false);
  });
});

describe("the list row's second line", () => {
  const session = testSession({ summary: testSummary({ agent: "claude-libra", model: "claude-opus-5-5", effort: "high" }), attribution: { projects: ["alpha"], by: "folder", sharedFolder: false } });

  it("is agent · model · effort, with the project first in the Workspace scope", () => {
    expect(rowMeta(session, false, NAMES)).toEqual(["claude-libra", "claude-opus-5-5 · high"]);
    expect(rowMeta(session, true, NAMES)).toEqual(["Alpha", "claude-libra", "claude-opus-5-5 · high"]);
  });

  it("leaves out what is not known yet", () => {
    expect(rowMeta(testSession(), false, NAMES)).toEqual(["claude"]);
    expect(rowMeta(testSession({ summary: testSummary({ model: "gpt-5.6-sol" }) }), true, NAMES)).toEqual(["Workspace", "claude", "gpt-5.6-sol"]);
  });
});

describe("the note", () => {
  it("is one line", () => {
    expect(oneLine("  wait\nfor   the\treview  ")).toBe("wait for the review");
  });

  it("is saved when it differs from the saved note; an empty field removes it", () => {
    expect(noteToSave("Waiting for review", undefined)).toBe("Waiting for review");
    expect(noteToSave(" Waiting  for review ", "Blocked")).toBe("Waiting for review");
    expect(noteToSave("", "Blocked")).toBeNull();
    expect(noteToSave("   ", "Blocked")).toBeNull();
  });

  it("is not saved when nothing would change", () => {
    expect(noteToSave("Blocked ", "Blocked")).toBeUndefined();
    expect(noteToSave("", undefined)).toBeUndefined();
    expect(noteToSave("  ", undefined)).toBeUndefined();
  });

  it("shows on its row as it is typed, and not at all while the field is empty", () => {
    expect(draftNote("Blocked  on\nCI")).toBe("Blocked on CI");
    expect(draftNote("  ")).toBeUndefined();
  });
});

describe("a failed change", () => {
  it("says what was not done and why in plain words; the backend's reason is kept for the hover", () => {
    const unwritable = new HostError("io-error", "/ws/Apps/pomade-agents/sessions/s.yaml could not be written (EACCES: permission denied)");
    expect(failureText("status", unwritable)).toEqual({
      text: "The status was not changed. The record file could not be written.",
      reason: "/ws/Apps/pomade-agents/sessions/s.yaml could not be written (EACCES: permission denied)",
    });
    expect(failureText("note", new HostError("not-ready", "No workspace is open in Pomade, so session records are not kept."))).toEqual({
      text: "The note was not saved. Session records are not kept right now.",
      reason: "No workspace is open in Pomade, so session records are not kept.",
    });
    expect(failureText("status", new HostError("not-found", 'No session "s"')).text).toBe("The status was not changed. The session is no longer there.");
    expect(failureText("status", new HostError("app-not-responding", "no answer in 5000 ms")).text).toBe("The status was not changed. The app's backend did not answer in time.");
    expect(failureText("status", new HostError("app-absent", "pomade-agents is not served")).text).toBe("The status was not changed. The app's backend is not running.");
    expect(failureText("status", new Error("the backend's answer was malformed"))).toEqual({ text: "The status was not changed. Something went wrong.", reason: "the backend's answer was malformed" });
    expect(failureText("note", new Error(""))).toEqual({ text: "The note was not saved. Something went wrong.", reason: "Something went wrong." });
    expect(failureText("undo", new HostError("io-error", "EACCES")).text).toBe("The earlier status was not set back. The record file could not be written.");
  });
});
