// A real, built Pomade for the smoke spec: which checkout it is, and how it is launched so it
// touches nothing of the user's — its user data, workspace and HOME are the sandbox's, and
// `NODE_ENV=test` keeps Pomade's own home folder and shell-profile line off (HOST-API §2
// "Testing hook"). The checkout is only read: its built `out/` and its Electron binary. Also what
// the smoke specs share: Pomade's own client, and a stand-in for a Claude-shaped agent.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { connectSocket } from "pomade-kit/node";
import type { HostClient } from "pomade-kit/sdk";

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

/** Launch Pomade on the sandbox; `devApps` are build folders dev-linked for this run. `pomadeHome`
 *  turns its commands on (they are off in a test run without it): Pomade writes its shims into
 *  `<pomadeHome>/bin` and puts that folder first on its terminals' `PATH`. */
export async function launchPomade(sandbox: Sandbox, devApps: string[] = [], pomadeHome?: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: [MAIN],
    env: isolatedEnv(sandbox, { ...(devApps.length > 0 ? { POMADE_DEV_APPS: devApps.join(";") } : {}), ...(pomadeHome === undefined ? {} : { POMADE_HOME: pomadeHome }) }),
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

/** Pomade's own client (the platform key) on the sandbox's Pomade: it calls the app's API. */
export async function platformClient(sandbox: Sandbox): Promise<HostClient> {
  const connected = await connectSocket({
    socketPath: sandbox.socketPath,
    appId: "pomade",
    keyFile: join(sandbox.userData, "app-keys", "pomade"),
    role: "command",
    env: {},
  });
  if (connected.status !== "connected") throw new Error(`could not reach Pomade as its platform client: ${connected.status}`);
  return connected.host;
}

/** A Claude-shaped stand-in agent writing into the store `store`: ready at once; started with
 *  `--resume <id>` it says `AGENT_RESUMED <id>` and goes on in that session; otherwise its first
 *  prompt starts a session. Every prompt it gets is echoed as `AGENT_GOT: <prompt>`. The prompt
 *  `/show` runs `pomade-agents show --json` as an agent would — from its terminal's `PATH` — into
 *  `<store>/show.json`, and says `AGENT_SHOWED <exit status>`. */
export const STAND_IN_AGENT = (store: string): string => `#!/bin/zsh
current=""
dir="${store}/projects/\${\${PWD:A}//[^a-zA-Z0-9]/-}"
printf '\\e]0;✳ Claude\\a'
if [[ "$1" == "--resume" ]]; then
  current="$2"
  echo "AGENT_RESUMED $current"
fi
echo AGENT_READY
while IFS= read -r line; do
  if [[ "$line" == "/exit" ]]; then exit 0; fi
  if [[ "$line" == "/show" ]]; then
    pomade-agents show --json > "${store}/show.json" 2>&1
    echo "AGENT_SHOWED $?"
    continue
  fi
  if [[ -z "$current" ]]; then
    current="$(uuidgen | tr A-Z a-z)"
    mkdir -p "$dir"
    print -r -- "{\\"type\\":\\"user\\",\\"message\\":{\\"role\\":\\"user\\",\\"content\\":\\"$line\\"},\\"origin\\":{\\"kind\\":\\"human\\"},\\"promptSource\\":\\"typed\\",\\"timestamp\\":\\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\\",\\"cwd\\":\\"\${PWD:A}\\",\\"sessionId\\":\\"$current\\"}" >> "$dir/$current.jsonl"
  fi
  echo "AGENT_GOT: $line"
done
`;
