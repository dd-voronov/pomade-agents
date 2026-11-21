import { describe, expect, it } from "vitest";

import type { SessionRecord } from "../../shared/sessions.ts";
import { testSummary } from "../../shared/test-sessions.ts";
import type { ProjectPlace } from "./attribution.ts";
import { isRecordId, latestSummary, newRecord, refreshRecord, sameRecord, type RecordContext } from "./rules.ts";

const ADOPTED = "2026-11-17T12:00:00.000Z";
const PROJECTS: ProjectPlace[] = [
  { id: "alpha", root: "Projects/alpha", folder: "/ws/Projects/alpha" },
  { id: "twin", root: "Projects/alpha", folder: "/ws/Projects/alpha" },
  { id: "beta", root: "Projects/beta", folder: "/ws/Projects/beta" },
];

const context = (patch: Partial<RecordContext> = {}, summary: Parameters<typeof testSummary>[0] = {}): RecordContext => ({
  summary: testSummary({ id: "s1", cwd: "/ws/Projects/beta/src", transcript: "/t/s1.jsonl", ...summary }),
  boundIn: null,
  projects: PROJECTS,
  runnerJob: null,
  ...patch,
});

describe("a session's first record", () => {
  it("is Done for every session the first run finds, never outside Pomade", () => {
    expect(newRecord(context({}, { startedAt: "2026-11-18T00:00:00.000Z" }), null)).toEqual({
      id: "s1",
      provider: "claude-code",
      agent: "claude",
      status: "done",
      transcript: "/t/s1.jsonl",
      cwd: "/ws/Projects/beta/src",
      project: "beta",
      projectRoot: "Projects/beta",
    });
  });

  it.each<[string, string | null, RecordContext["boundIn"], Partial<SessionRecord>]>([
    ["Active and outside Pomade when started after the first run and not bound", "2026-11-17T12:00:00.000Z", null, { status: "active", outsidePomade: true }],
    ["Active, launched from its tab's project, when bound", "2026-11-17T13:00:00.000Z", "alpha", { status: "active", launchedFrom: "alpha", project: "alpha", projectRoot: "Projects/alpha" }],
    ["Active, launched from the Workspace (no project), when bound in the Workspace scope", "2026-11-17T13:00:00.000Z", "__workspace__", { status: "active", launchedFrom: "__workspace__" }],
    ["Active when its start time is unknown", null, null, { status: "active", outsidePomade: true }],
    ["Done when it started before the first run (its record went missing, or another Mac)", "2026-11-17T11:59:59.999Z", null, { status: "done" }],
    ["Done, launched from its tab's project, when started before the first run and bound", "2026-11-01T00:00:00.000Z", "beta", { status: "done", launchedFrom: "beta" }],
  ])("is %s", (_name, startedAt, boundIn, expected) => {
    const record = newRecord(context({ boundIn }, { startedAt }), ADOPTED);
    expect(record).toMatchObject(expected);
    expect(record.outsidePomade).toBe(expected.outsidePomade);
    expect(record.launchedFrom).toBe(expected.launchedFrom);
  });

  it("has no project while Pomade's projects are not known", () => {
    const record = newRecord(context({ projects: null }), ADOPTED);
    expect(record.project).toBeUndefined();
    expect(record.projectRoot).toBeUndefined();
  });

  it("names the first of the projects sharing its folder's root", () => {
    const record = newRecord(context({}, { cwd: "/ws/Projects/alpha" }), null);
    expect([record.project, record.projectRoot]).toEqual(["alpha", "Projects/alpha"]);
  });
});

describe("keeping a record current", () => {
  const record: SessionRecord = {
    id: "s1",
    provider: "claude-code",
    agent: "claude",
    name: "Grill",
    status: "on-hold",
    note: "waiting",
    outsidePomade: true,
    transcript: "/t/old.jsonl",
    cwd: "/ws/Projects/beta/src",
    project: "beta",
    projectRoot: "Projects/beta",
  };

  it("follows the transcript and keeps everything that is the user's", () => {
    expect(refreshRecord(record, context({}, { transcript: "/t/new.jsonl" }))).toEqual({ ...record, transcript: "/t/new.jsonl" });
  });

  it("records the first binding: no longer outside Pomade, launched from that project, which places it", () => {
    const bound = refreshRecord(record, context({ boundIn: "alpha" }));
    expect(bound).toMatchObject({ launchedFrom: "alpha", project: "alpha", projectRoot: "Projects/alpha" });
    expect(bound.outsidePomade).toBeUndefined();
    expect(refreshRecord(bound, context({ boundIn: "beta" })).launchedFrom).toBe("alpha");
  });

  it("refreshes the project's root after a rename, keeping the project", () => {
    const renamed = PROJECTS.map((p) => (p.id === "beta" ? { ...p, root: "Projects/gamma", folder: "/ws/Projects/gamma" } : p));
    expect(refreshRecord(record, context({ projects: renamed }))).toMatchObject({ project: "beta", projectRoot: "Projects/gamma" });
  });

  it("keeps a Move to project, refreshing its root, and drops it when that project is gone", () => {
    const moved: SessionRecord = { ...record, projectOverride: true, project: "alpha", projectRoot: "old" };
    expect(refreshRecord(moved, context())).toMatchObject({ projectOverride: true, project: "alpha", projectRoot: "Projects/alpha" });
    const gone = refreshRecord({ ...moved, project: "deleted" }, context());
    expect(gone.projectOverride).toBeUndefined();
    expect(gone).toMatchObject({ project: "beta", projectRoot: "Projects/beta" });
  });

  it("keeps a move to the Workspace: no project", () => {
    const { project: _project, projectRoot: _root, ...placeless } = record;
    const refreshed = refreshRecord({ ...placeless, projectOverride: true }, context());
    expect(refreshed.projectOverride).toBe(true);
    expect(refreshed.project).toBeUndefined();
    expect(refreshed.projectRoot).toBeUndefined();
  });

  it("leaves the project alone while Pomade's projects are not known", () => {
    expect(refreshRecord(record, context({ projects: null }))).toMatchObject({ project: "beta", projectRoot: "Projects/beta" });
  });

  it("marks the session a Runner run started with its job, keeping a mark when no run is known, taking the latest job", () => {
    const marked = refreshRecord(record, context({ runnerJob: "Morning summary" }));
    expect(marked).toEqual({ ...record, transcript: "/t/s1.jsonl", startedByRunner: { job: "Morning summary" } });
    expect(refreshRecord(marked, context()).startedByRunner).toEqual({ job: "Morning summary" });
    expect(refreshRecord(marked, context({ runnerJob: "Nightly" })).startedByRunner).toEqual({ job: "Nightly" });
    expect(newRecord(context({ runnerJob: "Nightly" }, { startedAt: "2026-11-18T00:00:00.000Z" }), ADOPTED)).toMatchObject({ status: "active", outsidePomade: true, startedByRunner: { job: "Nightly" } });
  });

  it("keeps the start folder it knows when the transcript has none yet", () => {
    expect(refreshRecord(record, context({}, { cwd: null })).cwd).toBe("/ws/Projects/beta/src");
  });
});

describe("helpers", () => {
  it("takes the latest of a session's transcripts", () => {
    const a = testSummary({ transcript: "/a", lastActiveAt: "2026-11-17T10:00:00.000Z" });
    const b = testSummary({ transcript: "/b", lastActiveAt: "2026-11-17T11:00:00.000Z" });
    const c = testSummary({ transcript: "/c", lastActiveAt: "2026-11-17T11:00:00.000Z" });
    expect(latestSummary([])).toBeNull();
    expect(latestSummary([a, b])?.transcript).toBe("/b");
    expect(latestSummary([c, b, a])?.transcript).toBe("/c");
    expect(latestSummary([testSummary({ transcript: "/n", lastActiveAt: null }), a])?.transcript).toBe("/a");
  });

  it("names record files only with safe ids", () => {
    for (const id of ["7b5c3451-0370-4bf9-b6fd-617d56545a78", "019a7c3e-5b2d-7f10-8c4e-1d2f3a4b5c6d", "a.b_c"]) expect(isRecordId(id)).toBe(true);
    for (const id of ["", "../x", "a/b", ".hidden", "a b", "x".repeat(129)]) expect(isRecordId(id)).toBe(false);
  });

  it("compares records by value, `updated` and key order aside", () => {
    const a: SessionRecord = { id: "s", provider: "codex", agent: "codex", status: "done", updated: "1" };
    expect(sameRecord(a, { status: "done", agent: "codex", provider: "codex", id: "s", updated: "2" })).toBe(true);
    expect(sameRecord(a, { ...a, note: "x" })).toBe(false);
  });
});
