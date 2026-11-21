// The fake Pomade with the app's real backend, run from source: the socket handshake, the broker
// path to the backend's API, the run record, and what a stop leaves behind.

import { connectSocket } from "pomade-kit/node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readRunRecord } from "../../src/backend/core/run-record.ts";
import { INDEX_FILE } from "../../src/backend/stores/index-file.ts";
import { APP_INFO_METHOD } from "../../src/shared/api.ts";
import { SESSIONS_LIST_METHOD, isSessionsAnswer } from "../../src/shared/sessions.ts";
import { FIXTURE_PROJECTS, SOURCE_BACKEND, readManifest } from "../app.ts";
import { spawnBackend, type BackendProcess } from "../backend-process.ts";
import { SEEDED_TRANSCRIPTS, createSandbox, fixtureSnapshots, type Sandbox } from "../sandbox.ts";
import { startFakePomade, type FakePomade } from "./server.ts";

const manifest = readManifest();

async function until(condition: () => boolean | Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("the backend against the fake Pomade", { timeout: 20_000 }, () => {
  let sandbox: Sandbox;
  let pomade: FakePomade;
  let backend: BackendProcess | null;

  beforeEach(async () => {
    sandbox = await createSandbox(manifest.id);
    pomade = await startFakePomade({
      manifest,
      socketPath: sandbox.socketPath,
      appKey: sandbox.appKey,
      host: { projects: FIXTURE_PROJECTS, activeProject: "alpha", workspaceRoot: sandbox.workspace },
    });
    backend = null;
  });

  afterEach(async () => {
    await backend?.stop();
    await pomade.close();
    await sandbox.cleanup();
  });

  it("connects, serves app.info with locations inside the sandbox, and records its run", async () => {
    backend = spawnBackend(sandbox, { entry: SOURCE_BACKEND });
    await until(() => pomade.backendCount() === 1, "the backend to connect");
    await until(async () => (await pomade.fake.callApi(APP_INFO_METHOD).catch(() => null)) !== null, "the API to be served");

    const stateDir = `${sandbox.userData}/app-state/${manifest.id}`;
    const info = await pomade.fake.callApi(APP_INFO_METHOD);
    expect(info).toEqual({
      version: manifest.version,
      startedAt: expect.any(String) as string,
      workspace: sandbox.workspace,
      dataDir: `${sandbox.workspace}/Apps/${manifest.id}`,
      stateDir,
    });
    expect(await readRunRecord(stateDir)).toMatchObject({ pid: backend.pid, version: manifest.version });
  });

  it("stops on SIGTERM with status 0, removes its run record, keeps its parse index, leaves home untouched and adds only its settings and session records to the workspace", async () => {
    backend = spawnBackend(sandbox, { entry: SOURCE_BACKEND });
    await until(() => pomade.backendCount() === 1, "the backend to connect");
    // The first run adopts every seeded session, writing into Apps/; stopping before or during it
    // would leave a different set of files each time.
    await until(async () => {
      const answer = await pomade.fake.callApi(SESSIONS_LIST_METHOD).catch(() => null);
      return isSessionsAnswer(answer) && !answer.indexing && answer.sessions.length === Object.keys(SEEDED_TRANSCRIPTS).length && answer.sessions.every((s) => s.record !== null);
    }, "the first run to record every seeded session");

    expect(await backend.stop()).toEqual({ code: 0, signal: null, killed: false });
    await until(() => pomade.backendCount() === 0, "the connection to close");
    expect(Object.keys(await sandbox.snapshot(`${sandbox.userData}/app-state`))).toEqual([`${manifest.id}/${INDEX_FILE}`]);
    const fixtures = await fixtureSnapshots();
    expect(await sandbox.snapshot(sandbox.home)).toEqual(fixtures.home);
    const workspace = await sandbox.snapshot(sandbox.workspace);
    const apps = `Apps/${manifest.id}/`;
    expect(Object.fromEntries(Object.entries(workspace).filter(([path]) => !path.startsWith(apps)))).toEqual(fixtures.workspace);
    const added = Object.keys(workspace).filter((path) => path.startsWith(apps));
    expect(added.filter((path) => !path.startsWith(`${apps}sessions/`))).toEqual([`${apps}settings.yaml`]);
    expect(added.filter((path) => path.startsWith(`${apps}sessions/`) && path.endsWith(".yaml"))).toHaveLength(Object.keys(SEEDED_TRANSCRIPTS).length);
    expect(added).toHaveLength(1 + Object.keys(SEEDED_TRANSCRIPTS).length);
  });

  it("refuses a client with the wrong key", async () => {
    const env = sandbox.backendEnv();
    const wrong = await connectSocket({ env, key: "not-the-key", timeoutMs: 2000 });
    expect(wrong).toMatchObject({ status: "rejected", reason: "unauthorized" });
    const right = await connectSocket({ env, timeoutMs: 2000 });
    if (right.status !== "connected") throw new Error(right.status);
    expect(right.host.welcome).toMatchObject({ appId: manifest.id, surface: "backend" });
    right.host.close();
  });
});
