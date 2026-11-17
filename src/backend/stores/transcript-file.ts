// Reading one transcript from where its last parse stopped. The file is opened, read and closed
// within one call, so no descriptor stays open between reads, whatever the number of transcripts.
//
// A transcript only grows. Anything else is another file at the same path, parsed from the start:
// another inode, a size below the parsed offset, or a byte before the offset that is not the
// newline the offset was taken after.

import { open, stat } from "node:fs/promises";

import type { SessionProvider } from "../../shared/sessions.ts";
import type { FileMark } from "./index-file.ts";
import { applyChunk } from "./parser.ts";
import { newSessionState, type SessionState } from "./session-state.ts";

const CHUNK_BYTES = 1 << 20;
const NEWLINE = 0x0a;

export type ReadResult =
  /** The file is gone, or is not a regular file. */
  | { kind: "gone" }
  /** Nothing new since `mark`. */
  | { kind: "unchanged" }
  /** Parsed further (or from the start): the new mark and state. */
  | { kind: "parsed"; mark: FileMark; state: SessionState };

function isMissing(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * Parse what `path` holds beyond `previous` (`null`: never parsed). `previous.state` is not
 * changed; a parsed result carries a state of its own.
 */
export async function readTranscript(
  provider: SessionProvider,
  path: string,
  previous: { mark: FileMark; state: SessionState } | null,
): Promise<ReadResult> {
  let info;
  try {
    info = await stat(path);
  } catch (err) {
    if (isMissing(err)) return { kind: "gone" };
    throw err;
  }
  if (!info.isFile()) return { kind: "gone" };
  const sameFile = previous !== null && previous.mark.ino === info.ino && info.size >= previous.mark.offset;
  if (sameFile && info.size === previous.mark.offset) return { kind: "unchanged" };

  let handle;
  try {
    handle = await open(path, "r");
  } catch (err) {
    if (isMissing(err)) return { kind: "gone" };
    throw err;
  }
  try {
    let offset = 0;
    let state = newSessionState();
    if (sameFile && previous.mark.offset > 0) {
      const before = Buffer.alloc(1);
      await handle.read(before, 0, 1, previous.mark.offset - 1);
      if (before[0] === NEWLINE) {
        offset = previous.mark.offset;
        state = structuredClone(previous.state);
      }
    }
    // One buffer per read. The bytes after the last complete line move to its front and the next
    // read fills in behind them; a line longer than the buffer grows it, keeping what was read.
    let buffer = Buffer.allocUnsafe(CHUNK_BYTES);
    let held = 0;
    let position = offset;
    for (;;) {
      if (held === buffer.length) {
        const bigger = Buffer.allocUnsafe(buffer.length * 2);
        buffer.copy(bigger, 0, 0, held);
        buffer = bigger;
      }
      const { bytesRead } = await handle.read(buffer, held, buffer.length - held, position);
      if (bytesRead === 0) break;
      position += bytesRead;
      const filled = held + bytesRead;
      const consumed = applyChunk(provider, state, buffer.subarray(0, filled));
      offset += consumed;
      held = filled - consumed;
      if (held > 0 && consumed > 0) buffer.copy(buffer, 0, consumed, filled);
    }
    return { kind: "parsed", mark: { ino: info.ino, offset }, state };
  } finally {
    await handle.close();
  }
}
