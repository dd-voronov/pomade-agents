import { readRunRecord } from "../src/backend/core/run-record.ts";
import { INDEX_FILE } from "../src/backend/stores/index-file.ts";
import { APP_INFO_METHOD } from "../src/shared/api.ts";
import { BUILT_BACKEND, FIXTURE_AGENTS } from "../harness/app.ts";
import { spawnBackend } from "../harness/backend-process.ts";
import { startFakePomade } from "../harness/fake-pomade/server.ts";
import { SEEDED_TRANSCRIPTS, fixtureSnapshots } from "../harness/sandbox.ts";
import { expect, test } from "./fixtures.ts";

/** A seeded transcript's session id: Claude's file name, Codex's trailing uuid. */
function sessionIdOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1, -".jsonl".length);
  return /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.exec(name)?.[0] ?? name;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("the panel reaches the backend through the broker and shows it running", async ({ page, openShell, backend, manifest }) => {
  const { panel } = await openShell(page);
  const status = panel.getByTestId("backend-status");
  await expect(status).toHaveAttribute("data-status", "running");
  await expect(status).toContainText("Background: running");
  await expect(panel.getByTestId("backend-version")).toHaveText(`v${manifest.version}`);
  expect(backend.running()).toBe(true);
});

test("without a backend the panel says so, and recovers when one starts", async ({ page, openShell, sandbox, pomade }) => {
  const { panel } = await openShell(page);
  const status = panel.getByTestId("backend-status");
  await expect(status).toHaveAttribute("data-status", "down");
  await expect(status).toContainText("Background: not answering");
  await expect(status).toHaveAttribute("title", "Pomade's answer: app-absent");
  await expect(panel.getByTestId("backend-version")).toHaveCount(0);

  const backend = spawnBackend(sandbox, { entry: BUILT_BACKEND });
  try {
    await expect.poll(() => pomade.backendCount()).toBe(1);
    await expect(status).toHaveAttribute("data-status", "running");
  } finally {
    await backend.stop();
  }
});

test("the built backend serves app.info to Pomade with every location inside the sandbox", async ({ backend, pomade, sandbox, manifest }) => {
  const stateDir = `${sandbox.userData}/app-state/${manifest.id}`;
  await expect
    .poll(() => pomade.fake.callApi(APP_INFO_METHOD).catch((err: unknown) => String(err)), { message: backend.output() })
    .toEqual({
      version: manifest.version,
      startedAt: expect.any(String),
      workspace: sandbox.workspace,
      dataDir: `${sandbox.workspace}/Apps/${manifest.id}`,
      stateDir,
    });
  expect(await readRunRecord(stateDir)).toMatchObject({ pid: backend.pid, version: manifest.version });
});

test("the backend stops cleanly on SIGTERM and writes only its state folder (run record, parse index) and its data folder (settings, session records, agent profiles)", async ({ backend, pomade, sandbox, manifest }) => {
  const stateDir = `${sandbox.userData}/app-state/${manifest.id}`;
  const dataFiles = [
    ...Object.keys(SEEDED_TRANSCRIPTS).map((path) => `workspace/Apps/${manifest.id}/sessions/${sessionIdOf(path)}.yaml`),
    ...FIXTURE_AGENTS.map((id) => `workspace/Apps/${manifest.id}/agents/${id}/agent.yaml`),
  ];
  await expect.poll(() => readRunRecord(stateDir)).not.toBeNull();
  await expect.poll(() => sandbox.snapshot(stateDir).then((files) => Object.keys(files).sort())).toEqual(["backend.json", INDEX_FILE]);
  await expect
    .poll(() => sandbox.snapshot(`${sandbox.workspace}/Apps/${manifest.id}`).then((files) => Object.keys(files).sort()))
    .toEqual(["settings.yaml", ...dataFiles.map((path) => path.slice(`workspace/Apps/${manifest.id}/`.length))].sort());
  const fixtures = await fixtureSnapshots();
  const inSandbox = (folder: string, files: Record<string, string>): Record<string, string> =>
    Object.fromEntries(Object.entries(files).map(([path, hash]) => [`${folder}/${path}`, hash]));
  const appData = Object.fromEntries([`workspace/Apps/${manifest.id}/settings.yaml`, ...dataFiles].map((path) => [path, expect.any(String)]));
  expect(await sandbox.snapshot(sandbox.root)).toEqual({
    ...inSandbox("home", fixtures.home),
    ...inSandbox("workspace", fixtures.workspace),
    ...appData,
    [`ud/app-keys/${manifest.id}`]: expect.any(String),
    [`ud/app-state/${manifest.id}/backend.json`]: expect.any(String),
    [`ud/app-state/${manifest.id}/${INDEX_FILE}`]: expect.any(String),
  });

  expect(await backend.stop()).toEqual({ code: 0, signal: null, killed: false });
  expect(alive(backend.pid)).toBe(false);
  await expect.poll(() => pomade.backendCount()).toBe(0);
  expect(backend.output()).toContain("stopped");
  expect(Object.keys(await sandbox.snapshot(`${sandbox.userData}/app-state`))).toEqual([`${manifest.id}/${INDEX_FILE}`]);
  expect(await sandbox.snapshot(sandbox.home)).toEqual(fixtures.home);
  expect(inSandbox("workspace", await sandbox.snapshot(sandbox.workspace))).toEqual({ ...inSandbox("workspace", fixtures.workspace), ...appData });
});

test("a backend survives Pomade going away and reconnects when it is back", async ({ backend, pomade, sandbox, manifest }) => {
  await pomade.close();
  await expect.poll(() => backend.output()).toContain("Pomade went away");
  expect(backend.running()).toBe(true);

  const again = await startFakePomade({ manifest, socketPath: sandbox.socketPath, appKey: sandbox.appKey });
  try {
    await expect.poll(() => again.backendCount(), { timeout: 10_000 }).toBe(1);
    await expect.poll(() => again.fake.callApi(APP_INFO_METHOD).then(() => "served", () => "not yet")).toBe("served");
  } finally {
    await again.close();
  }
});
