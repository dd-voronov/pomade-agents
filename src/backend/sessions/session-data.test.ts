import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HostError } from "pomade-kit/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Session, SessionSummary, SessionsChanged } from "../../shared/sessions.ts";
import { testSummary } from "../../shared/test-sessions.ts";
import { createRealPaths } from "../core/real-paths.ts";
import { SESSIONS_FOLDER, SETTINGS_FILE, openRecordStore, type RecordStore } from "../records/record-store.ts";
import type { SummariesAnswer } from "../stores/session-store.ts";
import type { ProjectPlace } from "./attribution.ts";
import { createBoundTabs, type BoundTabs } from "./bound-tabs.ts";
import { createLiveState, followTabs, type LiveState } from "./live-state.ts";
import { startSessionData, type SessionData, type SummarySource } from "./session-data.ts";

const SOON = { timeout: 2000, interval: 20 };
const FIRST_RUN = "2026-11-17T12:00:00.000Z";

/** The session store as the session data sees it: every answer whole. */
function fakeSource(): SummarySource & { put(...s: SessionSummary[]): void; drop(transcript: string): void; indexed(): void } {
  const summaries = new Map<string, SessionSummary>();
  const listeners = new Set<(changed: SessionsChanged) => void>();
  let revision = 0;
  let indexing = true;
  const changed = (): void => {
    revision += 1;
    for (const listener of listeners) listener({ epoch: "store", revision });
  };
  return {
    answer: (): SummariesAnswer => ({ epoch: "store", revision, full: true, summaries: [...summaries.values()], removed: [], indexing }),
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    put(...list) {
      for (const s of list) summaries.set(s.transcript, s);
      changed();
    },
    drop(transcript) {
      summaries.delete(transcript);
      changed();
    },
    indexed() {
      indexing = false;
      changed();
    },
  };
}

describe("the session data", () => {
  let dir: string;
  let dataDir: string;
  let ws: string;
  let records: RecordStore | null = null;
  let data: SessionData | null = null;
  let live: LiveState = createLiveState(() => clock);
  let tabs: BoundTabs = createBoundTabs();
  let clock = new Date(FIRST_RUN);
  const lines: string[] = [];

  const PROJECTS = (): ProjectPlace[] => [
    { id: "alpha", root: "Projects/alpha", folder: `${ws}/Projects/alpha` },
    { id: "twin", root: "Projects/alpha", folder: `${ws}/Projects/alpha` },
    { id: "beta", root: "Projects/beta", folder: `${ws}/Projects/beta` },
  ];
  const summary = (id: string, patch: Partial<SessionSummary> = {}): SessionSummary =>
    testSummary({ id, transcript: `/store/${id}.jsonl`, cwd: `${ws}/Projects/beta`, startedAt: "2026-11-10T00:00:00.000Z", ...patch });
  const fileOf = (id: string): string => join(dataDir, SESSIONS_FOLDER, `${id}.yaml`);

  async function start(source: SummarySource, withRecords = true): Promise<SessionData> {
    records = withRecords ? await openRecordStore({ dataDir, now: () => clock, log: (l) => lines.push(l) }) : null;
    live = createLiveState(() => clock);
    tabs = createBoundTabs();
    data = startSessionData({ summaries: source, records, noRecords: "No workspace is open", live, tabs, realPath: createRealPaths(), now: () => clock, log: (l) => lines.push(l) });
    return data;
  }

  const session = (id: string): Session | undefined => data?.answer().sessions.find((s) => s.id === id);
  const status = (id: string): string | undefined => session(id)?.record?.status;

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), "pa-data-")));
    ws = join(dir, "ws");
    dataDir = join(ws, "Apps", "pomade-agents");
    clock = new Date(FIRST_RUN);
    lines.length = 0;
  });

  afterEach(async () => {
    data?.stop();
    data = null;
    await records?.stop();
    records = null;
    await rm(dir, { recursive: true, force: true });
  });

  it("on the first run records every session found as Done once indexing ends, then writes adoptedAt; later sessions start Active", async () => {
    const source = fakeSource();
    source.put(summary("old1"), summary("old2", { startedAt: "2026-11-18T00:00:00.000Z" }));
    const d = await start(source);
    expect(d.answer()).toMatchObject({ indexing: true, recordsOff: null });
    expect(session("old1")?.record).toBeNull();
    expect(await readdir(join(dataDir, SESSIONS_FOLDER))).toEqual([]);

    source.indexed();
    await expect.poll(() => readFile(join(dataDir, SETTINGS_FILE), "utf8").catch(() => ""), SOON).toBe(`adoptedAt: ${FIRST_RUN}\n`);
    await expect.poll(() => [status("old1"), status("old2")], SOON).toEqual(["done", "done"]);
    expect(await readFile(fileOf("old1"), "utf8")).toContain("status: done");
    expect(session("old1")?.record?.outsidePomade).toBeUndefined();
    expect(lines.join("\n")).toContain("first run — 2 existing sessions recorded as Done");

    clock = new Date("2026-11-17T13:00:00.000Z");
    source.put(summary("new", { startedAt: "2026-11-17T12:30:00.000Z" }));
    await expect.poll(() => status("new"), SOON).toBe("active");
    expect(session("new")?.record).toMatchObject({ outsidePomade: true, updated: "2026-11-17T13:00:00.000Z" });
  });

  it("adopts nothing on a first run with no sessions, and starts the first later one Active", async () => {
    const source = fakeSource();
    await start(source);
    source.indexed();
    await expect.poll(() => readFile(join(dataDir, SETTINGS_FILE), "utf8").catch(() => ""), SOON).toBe(`adoptedAt: ${FIRST_RUN}\n`);
    source.put(summary("first", { startedAt: "2026-11-17T12:00:01.000Z" }));
    await expect.poll(() => status("first"), SOON).toBe("active");
  });

  it("starts a session it sees after the first run Done when it started before it (its record went missing, or another Mac's)", async () => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, SETTINGS_FILE), `adoptedAt: ${FIRST_RUN}\n`);
    const source = fakeSource();
    source.put(summary("before", { startedAt: "2026-11-01T00:00:00.000Z" }), summary("after", { startedAt: "2026-11-18T00:00:00.000Z" }));
    await start(source);
    await expect.poll(() => [status("before"), status("after")], SOON).toEqual(["done", "active"]);
  });

  it("records the tab that first ran a session, whether the binding comes before or after the record, and so places it", async () => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, SETTINGS_FILE), `adoptedAt: ${FIRST_RUN}\n`);
    const source = fakeSource();
    const d = await start(source);
    d.setProjects(PROJECTS());
    const later = { cwd: `${ws}/Projects/alpha`, startedAt: "2026-11-18T00:00:00.000Z" };

    d.bind("early", "twin");
    source.put(summary("early", later));
    await expect.poll(() => session("early")?.record?.launchedFrom, SOON).toBe("twin");
    expect(session("early")?.record?.outsidePomade).toBeUndefined();
    expect(session("early")?.attribution).toEqual({ projects: ["twin"], by: "launched", sharedFolder: false });

    source.put(summary("late", later));
    await expect.poll(() => session("late")?.record?.outsidePomade, SOON).toBe(true);
    expect(session("late")?.attribution).toEqual({ projects: ["alpha", "twin"], by: "folder", sharedFolder: true });
    d.bind("late", "alpha");
    d.bind("late", "twin");
    await expect.poll(() => session("late")?.attribution.projects, SOON).toEqual(["alpha"]);
    expect(session("late")?.record).toMatchObject({ launchedFrom: "alpha", project: "alpha", projectRoot: "Projects/alpha" });
    expect(session("late")?.record?.outsidePomade).toBeUndefined();
    expect(await readFile(fileOf("late"), "utf8")).not.toContain("outsidePomade");
  });

  it("marks a session a Runner run started, whether the mark comes before its record or after, changing only that key", async () => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, SETTINGS_FILE), `adoptedAt: ${FIRST_RUN}\n`);
    const source = fakeSource();
    const d = await start(source);
    const later = { startedAt: "2026-11-18T00:00:00.000Z" };

    d.markStartedByRunner("early", "Morning summary");
    source.put(summary("early", later));
    await expect.poll(() => session("early")?.record?.startedByRunner, SOON).toEqual({ job: "Morning summary" });
    expect(await readFile(fileOf("early"), "utf8")).toContain("startedByRunner:\n  job: Morning summary\n");

    source.put(summary("late", later));
    await expect.poll(() => session("late")?.record?.status, SOON).toBe("active");
    const text = `# kept by hand\n${await readFile(fileOf("late"), "utf8")}`;
    await writeFile(fileOf("late"), text);
    await expect.poll(async () => (await readFile(fileOf("late"), "utf8")).startsWith("# kept by hand"), SOON).toBe(true);
    await expect.poll(() => session("late")?.record !== null, SOON).toBe(true);
    d.markStartedByRunner("late", "Nightly");
    await expect.poll(() => session("late")?.record?.startedByRunner, SOON).toEqual({ job: "Nightly" });
    const marked = await readFile(fileOf("late"), "utf8");
    const others = (t: string): string[] => t.split("\n").filter((line) => !line.startsWith("updated:") && !line.startsWith("startedByRunner:") && !line.startsWith("  job:"));
    expect(others(marked)).toEqual(others(text));
    expect(marked).toContain("startedByRunner:\n  job: Nightly\n");
  });

  it("sets statuses and notes in bulk, renames (telling the name listeners) and moves, writing the records", async () => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, SETTINGS_FILE), `adoptedAt: ${FIRST_RUN}\n`);
    const source = fakeSource();
    source.put(summary("a"), summary("b"), summary("c", { cwd: `${ws}/Projects/alpha` }));
    const d = await start(source);
    d.setProjects(PROJECTS());
    await expect.poll(() => ["a", "b", "c"].map(status), SOON).toEqual(["done", "done", "done"]);

    const held = await d.changeStatus(["a", "b"], "on-hold", "  waiting for review ");
    expect(held.map((s) => [s.id, s.record?.status, s.record?.note])).toEqual([
      ["a", "on-hold", "waiting for review"],
      ["b", "on-hold", "waiting for review"],
    ]);
    expect(await readFile(fileOf("a"), "utf8")).toContain("note: waiting for review");
    expect((await d.changeStatus(["a"], "active"))[0]?.record?.note).toBe("waiting for review");
    expect((await d.changeStatus(["a"], "done", null))[0]?.record?.note).toBeUndefined();

    const named: [string, string | null][] = [];
    d.onNameChange((id, name) => named.push([id, name]));
    expect((await d.rename("a", " Grill ")).record?.name).toBe("Grill");
    expect((await d.rename("a", null)).record?.name).toBeUndefined();
    expect(named).toEqual([
      ["a", "Grill"],
      ["a", null],
    ]);

    expect((await d.moveToProject("c", "beta")).attribution).toEqual({ projects: ["beta"], by: "override", sharedFolder: false });
    expect(await readFile(fileOf("c"), "utf8")).toMatch(/project: beta\nprojectRoot: Projects\/beta\n(.*\n)*projectOverride: true\n/);
    expect((await d.moveToProject("c", "__workspace__")).attribution).toEqual({ projects: [], by: "override", sharedFolder: false });
    const back = await d.moveToProject("c", null);
    expect(back.attribution).toEqual({ projects: ["alpha", "twin"], by: "folder", sharedFolder: true });
    expect(back.record).toMatchObject({ project: "alpha", projectRoot: "Projects/alpha" });
    expect(back.record?.projectOverride).toBeUndefined();

    await expect(d.moveToProject("c", "nowhere")).rejects.toMatchObject({ code: "not-found" });
    await expect(d.changeStatus(["a", "ghost"], "done")).rejects.toMatchObject({ code: "not-found" });
    expect(status("a")).toBe("done");
  });

  it("tells its listeners every status changeStatus changes, from what to what, and nothing for one that stays", async () => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, SETTINGS_FILE), `adoptedAt: ${FIRST_RUN}\n`);
    const source = fakeSource();
    source.put(summary("a"), summary("b"));
    const d = await start(source);
    await expect.poll(() => ["a", "b"].map(status), SOON).toEqual(["done", "done"]);
    const heard: unknown[] = [];
    const unsubscribe = d.onStatusChange((change) => heard.push(change));

    await d.changeStatus(["a", "b"], "on-hold");
    await d.changeStatus(["a"], "on-hold", "a note only");
    clock = new Date("2026-11-17T12:05:00.000Z");
    await d.changeStatus(["a"], "active");
    expect(heard).toEqual([
      { id: "a", from: "done", to: "on-hold", at: FIRST_RUN },
      { id: "b", from: "done", to: "on-hold", at: FIRST_RUN },
      { id: "a", from: "on-hold", to: "active", at: "2026-11-17T12:05:00.000Z" },
    ]);
    unsubscribe();
    await d.changeStatus(["b"], "done");
    expect(heard).toHaveLength(3);
    expect(d.get("b")?.record?.status).toBe("done");
    expect(d.get("ghost")).toBeUndefined();
  });

  it("refreshes the project root after a rename and keeps the session in its project", async () => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, SETTINGS_FILE), `adoptedAt: ${FIRST_RUN}\n`);
    const source = fakeSource();
    source.put(summary("s", { cwd: `${ws}/Projects/beta/src` }));
    const d = await start(source);
    d.setProjects(PROJECTS());
    await expect.poll(() => session("s")?.record?.projectRoot, SOON).toBe("Projects/beta");
    d.setProjects(PROJECTS().map((p) => (p.id === "beta" ? { ...p, root: "Projects/gamma", folder: `${ws}/Projects/gamma` } : p)));
    await expect.poll(() => session("s")?.record?.projectRoot, SOON).toBe("Projects/gamma");
    expect(session("s")?.attribution).toEqual({ projects: ["beta"], by: "remembered", sharedFolder: false });
    expect(await readFile(fileOf("s"), "utf8")).toContain("projectRoot: Projects/gamma");
  });

  it("places a session started through a symlinked folder in the project the folder is in, keeping the folder as recorded", async () => {
    await mkdir(join(ws, "Projects", "beta", "src"), { recursive: true });
    await symlink(join(ws, "Projects", "beta"), join(dir, "beta-link"));
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, SETTINGS_FILE), `adoptedAt: ${FIRST_RUN}\n`);
    const source = fakeSource();
    source.put(summary("s", { cwd: join(dir, "beta-link", "src") }));
    const d = await start(source);
    d.setProjects(PROJECTS());
    await expect.poll(() => session("s")?.record?.project, SOON).toBe("beta");
    expect(session("s")).toMatchObject({ attribution: { projects: ["beta"], by: "folder" }, folderInProject: "src" });
    expect(session("s")?.record?.cwd).toBe(join(dir, "beta-link", "src"));
  });

  it("leaves an unreadable record alone, refuses changes to it, and takes it back once fixed", async () => {
    await mkdir(join(dataDir, SESSIONS_FOLDER), { recursive: true });
    await writeFile(join(dataDir, SETTINGS_FILE), `adoptedAt: ${FIRST_RUN}\n`);
    await writeFile(fileOf("s"), "id: s\nstatus: [broken\n");
    const source = fakeSource();
    source.put(summary("s"));
    const d = await start(source);
    d.setProjects(PROJECTS());
    await expect.poll(() => session("s")?.recordProblem ?? null, SOON).toContain("not valid YAML");
    expect(session("s")?.record).toBeNull();
    const refused = d.changeStatus(["s"], "done");
    await expect(refused).rejects.toBeInstanceOf(HostError);
    await expect(refused).rejects.toMatchObject({ code: "io-error" });
    expect(await readFile(fileOf("s"), "utf8")).toBe("id: s\nstatus: [broken\n");

    await writeFile(fileOf("s"), "id: s\nprovider: claude-code\nagent: claude\nstatus: on-hold\n");
    await expect.poll(() => status("s"), SOON).toBe("on-hold");
    expect(session("s")?.recordProblem).toBeNull();
    await expect.poll(() => readFile(fileOf("s"), "utf8"), SOON).toContain("project: beta");
  });

  it("drops a session whose transcript is gone, keeps its record, and joins it again when the transcript is back", async () => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, SETTINGS_FILE), `adoptedAt: ${FIRST_RUN}\n`);
    const source = fakeSource();
    source.put(summary("s"));
    const d = await start(source);
    await expect.poll(() => status("s"), SOON).toBe("done");
    await d.changeStatus(["s"], "on-hold", "keep me");
    const before = d.answer();

    source.drop("/store/s.jsonl");
    await expect.poll(() => session("s"), SOON).toBeUndefined();
    expect(d.answer({ epoch: before.epoch, revision: before.revision })).toMatchObject({ full: false, sessions: [], removed: ["s"] });
    expect(await readFile(fileOf("s"), "utf8")).toContain("note: keep me");
    await expect(d.changeStatus(["s"], "done")).rejects.toMatchObject({ code: "not-found" });

    source.put(summary("s", { transcript: "/store/moved/s.jsonl" }));
    await expect.poll(() => session("s")?.record?.note, SOON).toBe("keep me");
    await expect.poll(() => session("s")?.record?.transcript, SOON).toBe("/store/moved/s.jsonl");
    expect(status("s")).toBe("on-hold");
  });

  it("answers only what changed since a revision", async () => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, SETTINGS_FILE), `adoptedAt: ${FIRST_RUN}\n`);
    const source = fakeSource();
    source.put(summary("a"), summary("b"));
    const d = await start(source);
    await expect.poll(() => [status("a"), status("b")], SOON).toEqual(["done", "done"]);
    const notices: SessionsChanged[] = [];
    d.onChange((n) => notices.push(n));
    const before = d.answer();
    await d.rename("b", "Bee");
    const delta = d.answer({ epoch: before.epoch, revision: before.revision });
    expect(delta).toMatchObject({ full: false, removed: [] });
    expect(delta.sessions.map((s) => s.id)).toEqual(["b"]);
    expect(d.answer({ epoch: "another", revision: 0 }).full).toBe(true);
    await expect.poll(() => notices.at(-1)?.revision, SOON).toBe(d.answer().revision);
  });

  it("answers each session's live state, and a change of it as a change since a revision with a notice", async () => {
    const source = fakeSource();
    source.put(summary("a"), summary("b"));
    source.indexed();
    const d = await start(source, false);
    expect(session("a")).toMatchObject({ live: "closed", liveSince: null });
    const notices: SessionsChanged[] = [];
    d.onChange((n) => notices.push(n));
    const before = d.answer();

    clock = new Date("2026-11-17T12:30:00.000Z");
    const followed = followTabs(live);
    followed.list([{ tabId: "t", projectId: "beta", agentId: "claude", cwd: `${ws}/Projects/beta`, launchedAt: null, sessionId: "a", title: "Claude", titleSource: "default", unnamed: false, state: "working" }]);
    const delta = d.answer({ epoch: before.epoch, revision: before.revision });
    expect(delta.sessions.map((s) => [s.id, s.live, s.liveSince])).toEqual([["a", "working", "2026-11-17T12:30:00.000Z"]]);
    await expect.poll(() => notices.at(-1)?.revision, SOON).toBe(d.answer().revision);

    followed.list([]);
    expect(session("a")).toMatchObject({ live: "closed", liveSince: "2026-11-17T12:30:00.000Z" });
    expect(d.list().map((s) => s.id).sort()).toEqual(["a", "b"]);
  });

  it("answers the agent tab each session is bound to, and a change of it as a change since a revision", async () => {
    const source = fakeSource();
    source.put(summary("a"), summary("b"));
    source.indexed();
    const d = await start(source, false);
    expect(session("a")?.tab).toBeNull();
    const before = d.answer();

    const tab = { tabId: "t", projectId: "beta", agentId: "claude", cwd: `${ws}/Projects/beta`, launchedAt: null, sessionId: "a", title: "Claude", titleSource: "default", unnamed: false, state: "exited" } as const;
    tabs.list([tab]);
    const delta = d.answer({ epoch: before.epoch, revision: before.revision });
    expect(delta.sessions.map((s) => [s.id, s.tab])).toEqual([["a", { tabId: "t", projectId: "beta" }]]);

    tabs.changed({ ...tab, projectId: "alpha" }, false);
    expect(session("a")?.tab).toEqual({ tabId: "t", projectId: "alpha" });
    tabs.changed(tab, true);
    expect(session("a")?.tab).toBeNull();
    expect(session("b")?.tab).toBeNull();
  });

  it("marks a session without messages hidden as empty and lists it, and shows it from its first message as a change since a revision", async () => {
    const source = fakeSource();
    source.put(summary("bare"), summary("talk", { firstMessage: { text: "Hi", at: null }, lastMessage: { text: "Hi", at: null } }));
    source.indexed();
    const d = await start(source, false);
    expect([session("bare")?.hidden, session("talk")?.hidden]).toEqual(["empty", null]);
    expect(d.list().map((s) => s.id).sort()).toEqual(["bare", "talk"]);

    const before = d.answer();
    source.put(summary("bare", { firstMessage: { text: "Start over", at: null }, lastMessage: { text: "Start over", at: null } }));
    await expect.poll(() => session("bare")?.hidden, SOON).toBeNull();
    expect(d.answer({ epoch: before.epoch, revision: before.revision }).sessions.map((s) => s.id)).toEqual(["bare"]);
  });

  it("without a workspace keeps no records, answers the sessions with why, and refuses changes", async () => {
    const source = fakeSource();
    source.put(summary("s"));
    source.indexed();
    const d = await start(source, false);
    expect(d.answer()).toMatchObject({ recordsOff: "No workspace is open", indexing: false });
    expect(session("s")).toMatchObject({ record: null, recordProblem: null });
    await expect(d.changeStatus(["s"], "done")).rejects.toMatchObject({ code: "not-ready" });
  });

  it("with unreadable settings creates no record and says why, and adopts once the file is fixed", async () => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, SETTINGS_FILE), "adoptedAt: [\n");
    const source = fakeSource();
    source.put(summary("s"));
    source.indexed();
    const d = await start(source);
    expect(d.answer().recordsOff).toContain("settings.yaml cannot be used");
    expect(session("s")?.record).toBeNull();
    await writeFile(join(dataDir, SETTINGS_FILE), "# fixed\n");
    await expect.poll(() => status("s"), SOON).toBe("done");
    expect(d.answer().recordsOff).toBeNull();
    await expect.poll(() => readFile(join(dataDir, SETTINGS_FILE), "utf8"), SOON).toBe(`# fixed\n\nadoptedAt: ${FIRST_RUN}\n`);
  });
});
