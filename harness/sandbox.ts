// Test isolation: one throwaway folder holding everything a run of the app may touch — a HOME with
// copies of the fixture stores (`~/.claude`, `~/.codex`, `~/.zshrc`), a copy of the fixture
// workspace, and a Pomade user-data folder. The backend is started with `backendEnv()`, the
// environment Pomade gives a backend (HOST-API §2 "Backends") and nothing of the caller's own, so
// it never sees the real home, the real stores or the real `Apps/`.
//
// The stores start with three synthetic transcripts from `fixtures/transcripts/` (`SEEDED_TRANSCRIPTS`):
// one per kind of store — the built-in Claude Code store, a folder agent's, and Codex's.

import { createHash, randomBytes } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { POMADE_ENV, keeperSocketPath, socketPathProblem } from "pomade-kit/protocol";

const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));

/** The synthetic transcripts the unit tests and the sandbox's stores use. */
export const TRANSCRIPTS = join(FIXTURES, "transcripts");

/** Where the sandbox's stores hold a copy of a transcript fixture: path under the sandbox root → fixture. */
export const SEEDED_TRANSCRIPTS: Readonly<Record<string, string>> = {
  "home/.claude/projects/-fixture-workspace-Projects-alpha/5b0e8f52-3c1d-4a7e-9f21-6d8c0b4a7e13.jsonl": "claude-session.jsonl",
  "workspace/Agents/claude-libra/projects/-fixture-workspace-Projects-beta/c41f7e2a-9b3d-4e60-8d15-3a7b9c2e1f04.jsonl": "claude-after-clear.jsonl",
  "home/.codex/sessions/2026/11/12/rollout-2026-11-12T11-00-00-019a7c3e-5b2d-7f10-8c4e-1d2f3a4b5c6d.jsonl": "codex-session.jsonl",
};

export interface Sandbox {
  /** The throwaway folder; everything below is inside it. */
  readonly root: string;
  readonly home: string;
  readonly workspace: string;
  readonly userData: string;
  /** `<userData>/run/pomade.sock`. */
  readonly socketPath: string;
  /** The key issued for the app (`<userData>/app-keys/<appId>` holds it). */
  readonly appKey: string;
  /** The environment a backend of `appId` runs with. */
  backendEnv(): Record<string, string>;
  /** Every file under `folder` (a path inside the sandbox): relative path → content hash. */
  snapshot(folder: string): Promise<Record<string, string>>;
  cleanup(): Promise<void>;
}

/** Every file under `folder`: path relative to it (POSIX separators) → SHA-256 of its content. */
export async function snapshotFolder(folder: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  let entries;
  try {
    entries = await readdir(folder, { recursive: true, withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return out;
    throw err;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    out[relative(folder, path).split(sep).join("/")] = createHash("sha256").update(await readFile(path)).digest("hex");
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

async function seedTranscripts(root: string): Promise<void> {
  for (const [to, from] of Object.entries(SEEDED_TRANSCRIPTS)) {
    await mkdir(dirname(join(root, to)), { recursive: true });
    await cp(join(TRANSCRIPTS, from), join(root, to));
  }
}

/** The home and workspace a sandbox starts with, before any run. */
export async function fixtureSnapshots(): Promise<{ home: Record<string, string>; workspace: Record<string, string> }> {
  const root = await mkdtemp(join(await realpath(tmpdir()), "pa-fixtures-"));
  try {
    await cp(join(FIXTURES, "home"), join(root, "home"), { recursive: true });
    await cp(join(FIXTURES, "workspace"), join(root, "workspace"), { recursive: true });
    await seedTranscripts(root);
    return { home: await snapshotFolder(join(root, "home")), workspace: await snapshotFolder(join(root, "workspace")) };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function createSandbox(appId: string): Promise<Sandbox> {
  const root = await mkdtemp(join(await realpath(tmpdir()), "pa-"));
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  const userData = join(root, "ud");
  const socketPath = join(userData, "run", "pomade.sock");
  const tooLong = socketPathProblem(socketPath);
  if (tooLong) {
    await rm(root, { recursive: true, force: true });
    throw new Error(`sandbox: ${tooLong}`);
  }
  await cp(join(FIXTURES, "home"), home, { recursive: true });
  await cp(join(FIXTURES, "workspace"), workspace, { recursive: true });
  await seedTranscripts(root);
  const appKey = randomBytes(16).toString("hex");
  const keyFile = join(userData, "app-keys", appId);
  await mkdir(join(userData, "app-keys"), { recursive: true, mode: 0o700 });
  await writeFile(keyFile, `${appKey}\n`, { mode: 0o600 });

  return {
    root,
    home,
    workspace,
    userData,
    socketPath,
    appKey,
    backendEnv: () => ({
      HOME: home,
      USER: "sandbox",
      LOGNAME: "sandbox",
      SHELL: "/bin/zsh",
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      LANG: "en_US.UTF-8",
      TMPDIR: join(root, "tmp"),
      [POMADE_ENV.appId]: appId,
      [POMADE_ENV.keyFile]: keyFile,
      [POMADE_ENV.role]: "backend",
      [POMADE_ENV.socket]: socketPath,
      [POMADE_ENV.keeperSocket]: keeperSocketPath(userData, appId),
      [POMADE_ENV.workspace]: workspace,
    }),
    snapshot: (folder) => {
      if (folder !== root && !folder.startsWith(root + sep)) throw new Error(`sandbox: ${folder} is outside ${root}`);
      return snapshotFolder(folder);
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
