// The delay behind event C (DESIGN §6): a status change settles `windowMs` after the session's
// last change, so the Sessions tab's Undo can take it back before anyone hears of it. One pending
// change per session: a change inside the window restarts it and keeps the first `from`; one that
// brings the status back to that `from` drops it — nothing changed. `flush` settles every pending
// change at once (a requested stop).

import type { SessionStatus } from "pomade-kit/protocol";

/** A status change that stood through its window. */
export interface SettledStatus {
  id: string;
  /** The status before the window's first change. */
  from: SessionStatus;
  /** The status after its last change. */
  to: SessionStatus;
  /** When the last change was made, ISO 8601. */
  at: string;
}

export interface Timers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const REAL_TIMERS: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

export interface StatusWindowOptions {
  windowMs: number;
  settled: (change: SettledStatus) => void;
  timers?: Timers;
}

export interface StatusWindow {
  /** Session `id` went from `from` to `to` at `at`. */
  changed(id: string, from: SessionStatus, to: SessionStatus, at: string): void;
  /** Settle every pending change now. */
  flush(): void;
  /** Drop every pending change without settling it. */
  stop(): void;
}

interface Pending extends SettledStatus {
  timer: unknown;
}

export function createStatusWindow({ windowMs, settled, timers = REAL_TIMERS }: StatusWindowOptions): StatusWindow {
  const pending = new Map<string, Pending>();

  const settle = (id: string): void => {
    const held = pending.get(id);
    if (held === undefined) return;
    pending.delete(id);
    timers.clear(held.timer);
    settled({ id, from: held.from, to: held.to, at: held.at });
  };

  return {
    changed(id, from, to, at) {
      const held = pending.get(id);
      if (held !== undefined) timers.clear(held.timer);
      const first = held?.from ?? from;
      if (to === first) {
        pending.delete(id);
        return;
      }
      pending.set(id, { id, from: first, to, at, timer: timers.set(() => settle(id), windowMs) });
    },

    flush() {
      for (const id of [...pending.keys()]) settle(id);
    },

    stop() {
      for (const held of pending.values()) timers.clear(held.timer);
      pending.clear();
    },
  };
}
