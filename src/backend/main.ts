// The backend's entry (the manifest's `backend.entry`): a with-Pomade Node program.

import manifest from "../../public/manifest.json" with { type: "json" };
import { startBackend } from "./core/backend.ts";

const log = (line: string): void => console.log(`${new Date().toISOString()} ${line}`);

const backend = await startBackend({
  appId: manifest.id,
  version: manifest.version,
  env: process.env,
  pid: process.pid,
  now: () => new Date(),
  log,
});

let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void backend.stop();
  });
}
