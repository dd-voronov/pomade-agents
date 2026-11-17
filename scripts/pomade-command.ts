// Finds the `pomade` command (HOST-API §2): `POMADE_BIN` when set, else `pomade` on PATH — Pomade
// puts it there in its own terminals — else the sibling Pomade checkout's `bin/pomade`.

import { delimiter, join } from "node:path";

export type Env = Readonly<Record<string, string | undefined>>;

export function findPomadeCommand(env: Env, repoRoot: string, isFile: (path: string) => boolean): string | null {
  const override = env.POMADE_BIN;
  if (override) return isFile(override) ? override : null;
  const candidates = [
    ...(env.PATH ?? "").split(delimiter).filter(Boolean).map((dir) => join(dir, "pomade")),
    join(repoRoot, "..", "Pomade", "bin", "pomade"),
  ];
  return candidates.find(isFile) ?? null;
}
