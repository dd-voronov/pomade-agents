// Test isolation: one throwaway folder holding everything a run of the app may touch — a HOME with
// copies of the fixture stores (`~/.claude`, `~/.codex`, `~/.zshrc`), a copy of the fixture
// workspace, and a Pomade user-data folder. The backend is started with `backendEnv()`, the
// environment Pomade gives a backend (HOST-API §2 "Backends") and nothing of the caller's own, so
// it never sees the real home, the real stores or the real `Apps/`.
//
// Later tickets seed their own store files into `home` and `workspace` after `createSandbox()`.

import { createHash, randomBytes } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { POMADE_ENV, keeperSocketPath, socketPathProblem } from "pomade-kit/protocol";

const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));

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

/** The fixture home and workspace as they are before any run: what a sandbox starts with. */
export async function fixtureSnapshots(): Promise<{ home: Record<string, string>; workspace: Record<string, string> }> {
  return { home: await snapshotFolder(join(FIXTURES, "home")), workspace: await snapshotFolder(join(FIXTURES, "workspace")) };
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
