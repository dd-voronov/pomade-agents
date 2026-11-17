// A real, built Pomade for the smoke spec: which checkout it is, and how it is launched so it
// touches nothing of the user's — its user data, workspace and HOME are the sandbox's, and
// `NODE_ENV=test` keeps Pomade's own home folder and shell-profile line off (HOST-API §2
// "Testing hook"). The checkout is only read: its built `out/` and its Electron binary.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";

import type { Sandbox } from "../../harness/sandbox.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** The Pomade checkout: `POMADE_REPO`, else the sibling repo. */
const POMADE_REPO = resolve(ROOT, process.env.POMADE_REPO ?? "../Pomade");
const MAIN = resolve(POMADE_REPO, "out/main/index.js");
const ELECTRON = resolve(POMADE_REPO, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
const POMADE_BIN = resolve(POMADE_REPO, "bin/pomade");

export function requireBuiltPomade(): void {
  for (const path of [MAIN, ELECTRON, POMADE_BIN]) {
    if (!existsSync(path)) throw new Error(`Pomade smoke: ${path} is missing — point POMADE_REPO at a built Pomade checkout`);
  }
}

function isolatedEnv(sandbox: Sandbox, extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !name.startsWith("POMADE_") && !name.startsWith("ELECTRON_")) env[name] = value;
  }
  return {
    ...env,
    HOME: sandbox.home,
    NODE_ENV: "test",
    POMADE_USER_DATA: sandbox.userData,
    POMADE_WORKSPACE: sandbox.workspace,
    ...extra,
  };
}

/** Launch Pomade on the sandbox; `devApps` are build folders dev-linked for this run. */
export async function launchPomade(sandbox: Sandbox, devApps: string[] = []): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: [MAIN],
    env: isolatedEnv(sandbox, devApps.length > 0 ? { POMADE_DEV_APPS: devApps.join(";") } : {}),
  });
  const page = await app.firstWindow();
  await page.waitForURL("**/index.html");
  await page.waitForLoadState("domcontentloaded");
  return { app, page };
}

/** `pomade apps <args>` against the sandbox's user data. */
export function pomadeApps(sandbox: Sandbox, ...args: string[]): string {
  return execFileSync(POMADE_BIN, ["apps", ...args], { env: isolatedEnv(sandbox, {}), encoding: "utf8" });
}
