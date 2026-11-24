// `npm run dev:fake`: the app without Pomade. A fake Pomade (pomade-kit's fake host) hosts the UI
// from a Vite dev server and the backend from source, restarted on change. Everything runs in a
// sandbox — a temp HOME with copies of the fixture stores, a temp copy of the fixture workspace
// and temp Pomade user data — so the real ~/.claude, ~/.codex, ~/.zshrc and Apps/ are never touched.

import { fileURLToPath } from "node:url";

import { createServer } from "vite";

import { FIXTURE_PROJECTS, SOURCE_BACKEND, readManifest } from "../harness/app.ts";
import { spawnBackend } from "../harness/backend-process.ts";
import { startFakePomade } from "../harness/fake-pomade.ts";
import { createSandbox } from "../harness/sandbox.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const APP_PORT = 5327;
const SHELL_PORT = 5328;

const manifest = readManifest();
const sandbox = await createSandbox(manifest.id);
const pomade = await startFakePomade({
  manifest,
  socketPath: sandbox.socketPath,
  appKey: sandbox.appKey,
  host: { projects: FIXTURE_PROJECTS, activeProject: "alpha", workspaceRoot: sandbox.workspace, pomadeVersion: "0.0.0-fake" },
});
const backend = spawnBackend(sandbox, { entry: SOURCE_BACKEND, nodeArgs: ["--watch"], echo: true, pomade });
const app = await createServer({ root: ROOT, server: { port: APP_PORT, strictPort: true } });
const shell = await createServer({ configFile: `${ROOT}harness/shell/vite.config.ts`, server: { port: SHELL_PORT, strictPort: true } });
await app.listen();
await shell.listen();

const appUrl = `http://localhost:${APP_PORT}/`;
console.log(`\nAgents in the fake Pomade:  http://localhost:${SHELL_PORT}/index.html?host=${encodeURIComponent(pomade.shellSocketUrl)}&app=${encodeURIComponent(appUrl)}`);
console.log(`Standalone (no host):       ${appUrl}`);
console.log(`Sandbox:                    ${sandbox.root}\n`);

let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    void (async () => {
      await backend.stop();
      await Promise.all([app.close(), shell.close(), pomade.close()]);
      await sandbox.cleanup();
    })();
  });
}
