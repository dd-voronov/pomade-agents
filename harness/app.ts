// The app as the harness sees it: its manifest (the source one, which every build copies) and
// where the built backend and command are.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

export const BUILD_DIR = `${ROOT}dist`;
export const BUILT_BACKEND = `${BUILD_DIR}/backend/main.mjs`;
/** The built `pomade-agents` command: the manifest's `commands[0].entry`. */
export const BUILT_COMMAND = `${BUILD_DIR}/cli/pomade-agents.mjs`;
export const SOURCE_BACKEND = `${ROOT}src/backend/main.ts`;

export interface AppManifest {
  id: string;
  name: string;
  version: string;
  api: string[];
  [key: string]: unknown;
}

export function readManifest(): AppManifest {
  return JSON.parse(readFileSync(`${ROOT}public/manifest.json`, "utf8")) as AppManifest;
}

/** The fake workspace both `dev:fake` and the e2e run in: the fixture workspace's two projects. */
export const FIXTURE_PROJECTS = [
  { id: "alpha", name: "Alpha", root: "Projects/alpha" },
  { id: "beta", name: "Beta", root: "Projects/beta" },
];

/** The agents the fixture home and workspace hold, in roster order: the built-ins and the fixture folder agent. */
export const FIXTURE_AGENTS = ["claude", "codex", "claude-libra"];
