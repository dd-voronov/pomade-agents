// Session records and project attribution through the built backend and the fake Pomade: the first
// run adopts every session as Done, silently; a later session starts Active; a status and note set
// through the API are in the record file and survive a restart; a session launched from a tab of one
// of two projects on one folder shows only there, Move to project moves it, and a project rename
// keeps it and refreshes its root.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { JsonValue } from "pomade-kit/protocol";

import { BUILT_BACKEND, FIXTURE_PROJECTS } from "../harness/app.ts";
import { spawnBackend } from "../harness/backend-process.ts";
import { startFakePomade, type FakePomade } from "../harness/fake-pomade/server.ts";
import { SEEDED_TRANSCRIPTS } from "../harness/sandbox.ts";
import {
  SESSIONS_LIST_METHOD,
  SESSIONS_MOVE_METHOD,
  SESSIONS_SET_STATUS_METHOD,
  isSessionsAnswer,
  type Session,
  type SessionsUpdated,
} from "../src/shared/sessions.ts";
import { expect, test } from "./fixtures.ts";
import { claudeSession, prompt } from "./transcripts.ts";

/** The ticket's bound for a new transcript to show. */
const WITHIN_MS = 2000;
const NEW_ID = "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c";
const SECOND_ID = "4e3d2c1b-0a9f-4e8d-9c7b-6a5f4e3d2c1b";

async function sessions(pomade: FakePomade): Promise<Session[]> {
  const answer = await pomade.fake.callApi(SESSIONS_LIST_METHOD);
  if (!isSessionsAnswer(answer)) throw new Error("malformed sessions.list answer");
  return answer.sessions;
}

const statuses = async (pomade: FakePomade): Promise<Record<string, string | undefined>> =>
  Object.fromEntries((await sessions(pomade).catch(() => [])).map((s) => [s.id, s.record?.status]));

const sessionOf = async (pomade: FakePomade, id: string): Promise<Session | undefined> => (await sessions(pomade).catch(() => [])).find((s) => s.id === id);

const call = async (pomade: FakePomade, method: string, params: JsonValue): Promise<SessionsUpdated> => (await pomade.fake.callApi(method, params)) as SessionsUpdated;

/** A moment after now: a session started after the first run. */
const soon = (): string => new Date(Date.now() + 1000).toISOString();

test("the first run records every existing session as Done, silently, and a session started later is Active", async ({ page, openShell, pomade, sandbox, backend, manifest }) => {
  const dataDir = join(sandbox.workspace, "Apps", manifest.id);
  await expect.poll(() => statuses(pomade), { message: backend.output() }).toEqual({
    "5b0e8f52-3c1d-4a7e-9f21-6d8c0b4a7e13": "done",
    "c41f7e2a-9b3d-4e60-8d15-3a7b9c2e1f04": "done",
    "019a7c3e-5b2d-7f10-8c4e-1d2f3a4b5c6d": "done",
  });
  expect(await readFile(join(dataDir, "settings.yaml"), "utf8")).toMatch(/^adoptedAt: \d{4}-\d\d-\d\dT[\d:.]+Z\n$/);
  expect(await readFile(join(dataDir, "sessions", "5b0e8f52-3c1d-4a7e-9f21-6d8c0b4a7e13.yaml"), "utf8")).toContain("status: done");
  expect(pomade.fake.notices).toEqual([]);

  const { panel, tabFrame } = await openShell(page);
  await panel.getByTestId("open-sessions").click();
  const frame = tabFrame("alpha");
  await expect(frame.getByTestId("sessions-status-done")).toHaveAttribute("data-count", "3");
  await expect(frame.getByTestId("sessions-status-active")).toHaveAttribute("data-count", "0");

  const started = Date.now();
  await claudeSession(sandbox, NEW_ID, prompt("Start something new", soon()));
  await expect(frame.getByTestId("sessions-status-active")).toHaveAttribute("data-count", "1", { timeout: WITHIN_MS });
  expect(Date.now() - started).toBeLessThan(WITHIN_MS);
  await expect(frame.getByTestId("sessions-status-active")).toHaveText("Active 1");
  expect((await sessionOf(pomade, NEW_ID))?.record).toMatchObject({ status: "active", outsidePomade: true });
  expect(await readFile(join(dataDir, "sessions", `${NEW_ID}.yaml`), "utf8")).toContain("status: active");
});

test("a status and note set through the API are in the record file and survive a backend restart", async ({ pomade, sandbox, backend, manifest }) => {
  const id = "5b0e8f52-3c1d-4a7e-9f21-6d8c0b4a7e13";
  const record = join(sandbox.workspace, "Apps", manifest.id, "sessions", `${id}.yaml`);
  await expect.poll(async () => (await statuses(pomade))[id]).toBe("done");

  const answer = await call(pomade, SESSIONS_SET_STATUS_METHOD, { ids: [id], status: "on-hold", note: "waiting for the test round" });
  expect(answer.sessions.map((s) => [s.id, s.record?.status, s.record?.note])).toEqual([[id, "on-hold", "waiting for the test round"]]);
  const text = await readFile(record, "utf8");
  expect(text).toContain("status: on-hold");
  expect(text).toContain("note: waiting for the test round");

  expect((await backend.stop()).code).toBe(0);
  await expect.poll(() => pomade.backendCount()).toBe(0);
  const again = spawnBackend(sandbox, { entry: BUILT_BACKEND });
  try {
    await expect.poll(() => pomade.backendCount(), { message: again.output() }).toBe(1);
    await expect.poll(async () => (await sessionOf(pomade, id))?.record).toMatchObject({ status: "on-hold", note: "waiting for the test round" });
    expect(await readFile(record, "utf8")).toBe(text);
  } finally {
    await again.stop();
  }
});

test("a session launched from one of two projects on one folder shows only there; Move to project moves it; a rename keeps it", async ({ sandbox, manifest }) => {
  const folder = join(sandbox.workspace, "Projects", "alpha");
  const pomade = await startFakePomade({
    manifest,
    socketPath: sandbox.socketPath,
    appKey: sandbox.appKey,
    host: {
      projects: [...FIXTURE_PROJECTS, { id: "twin", name: "Alpha twin", root: "Projects/alpha" }],
      activeProject: "alpha",
      workspaceRoot: sandbox.workspace,
      agentTabs: [{ tabId: "tab-a", projectId: "alpha", agentId: "claude" }],
    },
  });
  const backend = spawnBackend(sandbox, { entry: BUILT_BACKEND });
  try {
    await expect.poll(() => pomade.backendCount(), { message: backend.output() }).toBe(1);
    await expect.poll(async () => Object.keys(await statuses(pomade)).length).toBe(Object.keys(SEEDED_TRANSCRIPTS).length);
    await expect.poll(async () => Object.values(await statuses(pomade))).toEqual(["done", "done", "done"]);

    // Two new sessions in alpha's folder, which twin shares: one from alpha's tab, one from a plain terminal.
    await claudeSession(sandbox, NEW_ID, prompt("From the alpha tab", soon(), folder));
    pomade.fake.updateAgentTab("tab-a", { sessionId: NEW_ID, cwd: folder, launchedAt: new Date().toISOString() });
    await claudeSession(sandbox, SECOND_ID, prompt("From a terminal", soon(), folder));

    await expect.poll(async () => (await sessionOf(pomade, NEW_ID))?.attribution).toEqual({ projects: ["alpha"], by: "launched", sharedFolder: false });
    expect((await sessionOf(pomade, NEW_ID))?.record).toMatchObject({ status: "active", launchedFrom: "alpha", project: "alpha", projectRoot: "Projects/alpha" });
    expect((await sessionOf(pomade, NEW_ID))?.record?.outsidePomade).toBeUndefined();
    await expect.poll(async () => (await sessionOf(pomade, SECOND_ID))?.attribution).toEqual({ projects: ["alpha", "twin"], by: "folder", sharedFolder: true });
    expect((await sessionOf(pomade, SECOND_ID))?.record).toMatchObject({ status: "active", outsidePomade: true });

    const moved = await call(pomade, SESSIONS_MOVE_METHOD, { id: NEW_ID, project: "twin" });
    expect(moved.sessions[0]?.attribution).toEqual({ projects: ["twin"], by: "override", sharedFolder: false });
    const record = join(sandbox.workspace, "Apps", manifest.id, "sessions", `${NEW_ID}.yaml`);
    expect(await readFile(record, "utf8")).toMatch(/project: twin\n(.*\n)*projectOverride: true\n/);

    pomade.fake.updateProject("twin", { name: "Twin", root: "Projects/twin" });
    await expect.poll(async () => (await sessionOf(pomade, NEW_ID))?.record?.projectRoot).toBe("Projects/twin");
    expect((await sessionOf(pomade, NEW_ID))?.attribution).toEqual({ projects: ["twin"], by: "override", sharedFolder: false });
    expect(await readFile(record, "utf8")).toContain("projectRoot: Projects/twin");
    await expect.poll(async () => (await sessionOf(pomade, SECOND_ID))?.attribution).toEqual({ projects: ["alpha"], by: "folder", sharedFolder: false });
  } finally {
    await backend.stop();
    await pomade.close();
  }
});
