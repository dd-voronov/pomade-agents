// `npm run dev`: build the app, dev-link the build folder into Pomade (`pomade apps link dist`),
// then rebuild both halves on every source change. A dev link serves the folder as it is, so a
// rebuilt UI shows when its frame reloads; `pomade apps unlink pomade-agents` removes the link.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

import { runPomade } from "./pomade.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const built = spawnSync("npm", ["run", "build"], { cwd: ROOT, stdio: "inherit" });
if (built.status !== 0) process.exit(built.status ?? 1);
const linked = runPomade(["apps", "link", "dist"]);
if (linked !== 0) process.exit(linked);

const watchers: ChildProcess[] = [
  spawn("npx", ["vite", "build", "--watch"], { cwd: ROOT, stdio: "inherit" }),
  spawn("npx", ["vite", "build", "--watch", "--config", "vite.backend.config.ts"], { cwd: ROOT, stdio: "inherit" }),
];
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    for (const watcher of watchers) watcher.kill(signal);
  });
}
