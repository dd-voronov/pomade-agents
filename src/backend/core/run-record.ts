// The backend's run record, `<stateDir>/backend.json`: which process serves the app now. Written
// when the backend starts and removed when it stops on request, so a record left behind names a
// backend that crashed or was killed.

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const RUN_RECORD_FILE = "backend.json";

export interface RunRecord {
  pid: number;
  version: string;
  /** ISO 8601. */
  startedAt: string;
}

/** Write the record atomically, creating the state folder. */
export async function writeRunRecord(stateDir: string, record: RunRecord): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  const path = join(stateDir, RUN_RECORD_FILE);
  const tmp = `${path}.${record.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

/** The record, or `null` when there is none or the file is not one. */
export async function readRunRecord(stateDir: string): Promise<RunRecord | null> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(join(stateDir, RUN_RECORD_FILE), "utf8"));
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const { pid, version, startedAt } = raw as Record<string, unknown>;
  if (typeof pid !== "number" || typeof version !== "string" || typeof startedAt !== "string") return null;
  return { pid, version, startedAt };
}

/** Remove the record `pid` wrote; a record another backend has written since stays. */
export async function removeRunRecord(stateDir: string, pid: number): Promise<void> {
  if ((await readRunRecord(stateDir))?.pid === pid) await rm(join(stateDir, RUN_RECORD_FILE), { force: true });
}
