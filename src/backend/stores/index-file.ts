// The parse index, `<stateDir>/session-index.json`: for every transcript, how far it was parsed and
// the state reached there, so a warm start reads only what grew. Machine-local and rebuildable —
// a missing, corrupt or outdated index is a cold start, never an error.
//
// It is valid only for the parser and price table that wrote it: `PARSER_VERSION` changes with
// any change to what a state holds or how a record is read (bump it then), and the price table's
// fingerprint covers the long-prompt thresholds the states' tiers were cut at.

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { PRICE_TABLE } from "./prices.ts";
import { isSessionState, type SessionState } from "./session-state.ts";

export const INDEX_FILE = "session-index.json";

/** Bump on any change to `SessionState` or to how a parser reads a record. */
export const PARSER_VERSION = 1;

export const PRICES_FINGERPRINT = createHash("sha256").update(JSON.stringify(PRICE_TABLE)).digest("hex").slice(0, 16);

/** How far one transcript was parsed. */
export interface FileMark {
  /** The file's inode: another inode at the same path is another file. */
  ino: number;
  /** Bytes parsed; always just after a newline (or 0). */
  offset: number;
}

export interface IndexedFile {
  mark: FileMark;
  state: SessionState;
}

interface IndexDocument {
  parser: number;
  prices: string;
  files: Record<string, IndexedFile>;
}

function isIndexedFile(value: unknown): value is IndexedFile {
  if (typeof value !== "object" || value === null) return false;
  const { mark, state } = value as Record<string, unknown>;
  if (typeof mark !== "object" || mark === null || !isSessionState(state)) return false;
  const { ino, offset } = mark as Record<string, unknown>;
  return typeof ino === "number" && Number.isInteger(offset) && (offset as number) >= 0;
}

/** The indexed files by path; empty when the index is missing, unreadable or from another parser. */
export async function readIndex(stateDir: string): Promise<Map<string, IndexedFile>> {
  let doc: unknown;
  try {
    doc = JSON.parse(await readFile(join(stateDir, INDEX_FILE), "utf8"));
  } catch {
    return new Map();
  }
  if (typeof doc !== "object" || doc === null) return new Map();
  const { parser, prices, files } = doc as Record<string, unknown>;
  if (parser !== PARSER_VERSION || prices !== PRICES_FINGERPRINT || typeof files !== "object" || files === null) return new Map();
  return new Map(Object.entries(files).filter((entry): entry is [string, IndexedFile] => isIndexedFile(entry[1])));
}

/** Write the index atomically, creating the state folder. */
export async function writeIndex(stateDir: string, files: ReadonlyMap<string, IndexedFile>): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  const doc: IndexDocument = { parser: PARSER_VERSION, prices: PRICES_FINGERPRINT, files: Object.fromEntries(files) };
  const path = join(stateDir, INDEX_FILE);
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(doc), "utf8");
  await rename(tmp, path);
}
