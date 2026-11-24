import { describe, expect, it } from "vitest";

import { testSession, testSummary } from "../../shared/test-sessions.ts";
import {
  NONE_CHECKED,
  TOAST_NAME_MAX,
  changing,
  extended,
  headerClick,
  headerState,
  movedText,
  pruned,
  targetsOf,
  toastName,
  toggled,
  undoCalls,
  withAll,
  withRange,
} from "./check-model.ts";

const ORDER = ["a", "b", "c", "d", "e"];
const set = (...ids: string[]): Set<string> => new Set(ids);
const sorted = (checked: ReadonlySet<string>): string[] => [...checked].sort();

describe("checking rows", () => {
  it("a toggle checks an unchecked row and unchecks a checked one", () => {
    expect(sorted(toggled(set("a"), "b"))).toEqual(["a", "b"]);
    expect(sorted(toggled(set("a", "b"), "a"))).toEqual(["b"]);
  });

  it("a Shift range checks every row between the anchor and the row, either way, keeping earlier checks", () => {
    expect(sorted(withRange(set("e"), ORDER, "b", "d"))).toEqual(["b", "c", "d", "e"]);
    expect(sorted(withRange(NONE_CHECKED, ORDER, "d", "a"))).toEqual(["a", "b", "c", "d"]);
    expect(sorted(withRange(NONE_CHECKED, ORDER, "c", "c"))).toEqual(["c"]);
  });

  it("a range without its anchor among the rows shown checks the row alone", () => {
    expect(sorted(withRange(NONE_CHECKED, ORDER, null, "c"))).toEqual(["c"]);
    expect(sorted(withRange(NONE_CHECKED, ORDER, "gone", "c"))).toEqual(["c"]);
  });

  it("Cmd+A checks every row shown", () => {
    expect(sorted(withAll(set("x"), ORDER))).toEqual(["a", "b", "c", "d", "e", "x"]);
  });

  it("Shift+↑↓ check the row and the next, and go on from the next; at either end they stay", () => {
    expect(extended(NONE_CHECKED, ORDER, "b", 1)).toEqual({ checked: set("b", "c"), at: "c" });
    expect(extended(set("b", "c"), ORDER, "c", 1)).toEqual({ checked: set("b", "c", "d"), at: "d" });
    expect(extended(NONE_CHECKED, ORDER, "b", -1)).toEqual({ checked: set("b", "a"), at: "a" });
    expect(extended(NONE_CHECKED, ORDER, "e", 1)).toEqual({ checked: set("e"), at: "e" });
  });

  it("Shift+↑↓ from no row check the first (↓) or the last (↑); with no rows, nothing", () => {
    expect(extended(NONE_CHECKED, ORDER, null, 1)).toEqual({ checked: set("a"), at: "a" });
    expect(extended(NONE_CHECKED, ORDER, "gone", -1)).toEqual({ checked: set("e"), at: "e" });
    expect(extended(NONE_CHECKED, [], null, 1)).toBeNull();
  });

  it("the header checkbox is empty, mixed or checked; its click checks every row shown, or clears them all", () => {
    expect(headerState(NONE_CHECKED, ORDER)).toBe("false");
    expect(headerState(set("a"), ORDER)).toBe("mixed");
    expect(headerState(set("hidden"), ORDER)).toBe("mixed");
    expect(headerState(set(...ORDER), ORDER)).toBe("true");
    expect(headerState(set("a"), [])).toBe("mixed");
    expect(sorted(headerClick(set("a"), ORDER))).toEqual(ORDER);
    expect(sorted(headerClick(NONE_CHECKED, ORDER))).toEqual(ORDER);
    expect(headerClick(set(...ORDER, "hidden"), ORDER).size).toBe(0);
  });

  it("a row's menu or drag acts on every checked row when it is one of several checked, else on the row alone", () => {
    expect(targetsOf("b", set("a", "b", "c"))).toEqual(["a", "b", "c"]);
    expect(targetsOf("d", set("a", "b", "c"))).toEqual(["d"]);
    expect(targetsOf("a", set("a"))).toEqual(["a"]);
  });

  it("checks of sessions the tab no longer lists fall away; otherwise the same set comes back", () => {
    const checked = set("a", "b");
    expect(pruned(checked, () => true)).toBe(checked);
    expect(sorted(pruned(checked, (id) => id !== "b"))).toEqual(["a"]);
  });
});

describe("changing statuses", () => {
  const named = testSession({ id: "n", record: { id: "n", provider: "claude-code", agent: "claude", status: "active", name: "Release notes" } });
  const unnamed = testSession({
    id: "u",
    summary: testSummary({ id: "u", firstMessage: { text: "Why does the side panel flicker when I drag the column divider past the minimum", at: null } }),
    record: { id: "u", provider: "claude-code", agent: "claude", status: "on-hold" },
  });
  const unrecorded = testSession({ id: "r", record: null });
  const byId = new Map([named, unnamed, unrecorded].map((s) => [s.id, s]));

  it("changes the known sessions that have another status", () => {
    expect(changing(["n", "u", "r", "gone"], "on-hold", byId).map((s) => s.id)).toEqual(["n", "r"]);
    expect(changing(["r"], "done", byId)).toEqual([]);
  });

  it("the toast names one session as its row does, cut with …; several by their count", () => {
    expect(movedText([named], "done")).toBe("“Release notes” → Done");
    expect(toastName(unnamed)).toHaveLength(TOAST_NAME_MAX);
    expect(toastName(unnamed)).toBe("Why does the side panel flicker when I drag…");
    expect(movedText([named, unnamed, unrecorded], "done-skip")).toBe("3 sessions → Done–skip/Failed");
  });

  it("an Undo sets each session's earlier status back, one call per earlier status", () => {
    const earlier = new Map([
      ["a", "active"],
      ["b", "on-hold"],
      ["c", "active"],
    ] as const);
    expect(undoCalls(earlier)).toEqual([
      { status: "active", ids: ["a", "c"] },
      { status: "on-hold", ids: ["b"] },
    ]);
    expect(undoCalls(new Map())).toEqual([]);
  });
});
