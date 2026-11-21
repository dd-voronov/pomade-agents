import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createStatusWindow, type SettledStatus, type StatusWindow } from "./status-window.ts";

const WINDOW = 5000;

describe("the status window", () => {
  let settled: SettledStatus[];
  let window: StatusWindow;

  beforeEach(() => {
    vi.useFakeTimers();
    settled = [];
    window = createStatusWindow({ windowMs: WINDOW, settled: (change) => settled.push(change) });
  });

  afterEach(() => {
    window.stop();
    vi.useRealTimers();
  });

  it("settles a change once it stood for the whole window, not before", () => {
    window.changed("a", "active", "done", "t0");
    vi.advanceTimersByTime(WINDOW - 1);
    expect(settled).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(settled).toEqual([{ id: "a", from: "active", to: "done", at: "t0" }]);
    vi.advanceTimersByTime(WINDOW * 2);
    expect(settled).toHaveLength(1);
  });

  it("drops a change taken back inside the window", () => {
    window.changed("a", "active", "done", "t0");
    vi.advanceTimersByTime(3000);
    window.changed("a", "done", "active", "t1");
    vi.advanceTimersByTime(WINDOW * 2);
    expect(settled).toEqual([]);
  });

  it("makes several changes inside the window one, from the first `from` to the last `to`, the window counted from the last", () => {
    window.changed("a", "active", "done", "t0");
    vi.advanceTimersByTime(3000);
    window.changed("a", "done", "on-hold", "t1");
    vi.advanceTimersByTime(3000);
    expect(settled).toEqual([]);
    window.changed("a", "on-hold", "done-skip", "t2");
    vi.advanceTimersByTime(WINDOW - 1);
    expect(settled).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(settled).toEqual([{ id: "a", from: "active", to: "done-skip", at: "t2" }]);
  });

  it("starts a new window after one settled", () => {
    window.changed("a", "active", "done", "t0");
    vi.advanceTimersByTime(WINDOW);
    window.changed("a", "done", "active", "t1");
    vi.advanceTimersByTime(WINDOW);
    expect(settled.map((c) => [c.from, c.to])).toEqual([
      ["active", "done"],
      ["done", "active"],
    ]);
  });

  it("keeps one window per session: a bulk change of three settles three", () => {
    for (const id of ["a", "b", "c"]) window.changed(id, "active", "done", "t0");
    window.changed("b", "done", "active", "t1");
    vi.advanceTimersByTime(WINDOW);
    expect(settled.map((c) => c.id)).toEqual(["a", "c"]);
  });

  it("settles every pending change at once on flush, and drops them on stop", () => {
    window.changed("a", "active", "done", "t0");
    window.changed("b", "on-hold", "done", "t0");
    window.flush();
    expect(settled.map((c) => c.id)).toEqual(["a", "b"]);
    window.changed("c", "active", "done", "t1");
    window.stop();
    vi.advanceTimersByTime(WINDOW);
    expect(settled.map((c) => c.id)).toEqual(["a", "b"]);
  });
});
