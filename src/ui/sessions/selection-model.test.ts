import { describe, expect, it } from "vitest";
import type { SessionStatus } from "pomade-kit/protocol";

import type { Session } from "../../shared/sessions.ts";
import { testSession } from "../../shared/test-sessions.ts";
import { listRows, openTab, revealInTable, step, tableOrder, type Groups } from "./selection-model.ts";

const session = (id: string, status: SessionStatus = "active"): Session =>
  testSession({ id, record: { id, provider: "claude-code", agent: "claude", status } });

const many = (prefix: string, n: number, status: SessionStatus): Session[] => Array.from({ length: n }, (_, i) => session(`${prefix}${i + 1}`, status));

const groupsOf = (patch: Partial<Groups>): Groups => ({ active: [], "on-hold": [], done: [], "done-skip": [], ...patch });

const ids = (sessions: readonly Session[]): string[] => sessions.map((s) => s.id);

describe("the table's order", () => {
  const groups = groupsOf({ active: [session("a1"), session("a2")], "on-hold": [session("h1", "on-hold")], done: many("d", 13, "done"), "done-skip": [session("x1", "done-skip")] });

  it("walks the groups in status order, a long Done group cut to its latest 10", () => {
    expect(tableOrder(groups, new Set(), new Set())).toEqual(["a1", "a2", "h1", ...ids(groups.done.slice(0, 10)), "x1"]);
  });

  it("skips collapsed groups and shows all of an expanded one", () => {
    expect(tableOrder(groups, new Set(["active", "done-skip"]), new Set(["done"]))).toEqual(["h1", ...ids(groups.done)]);
  });
});

describe("a step of ↑ ↓", () => {
  const order = ["a", "b", "c"];

  it("moves from the selected row and stays put at either end", () => {
    expect(step(order, "b", 1)).toBe("c");
    expect(step(order, "b", -1)).toBe("a");
    expect(step(order, "c", 1)).toBe("c");
    expect(step(order, "a", -1)).toBe("a");
  });

  it("with nothing selected selects the first row on ↓ and the last on ↑", () => {
    expect(step(order, null, 1)).toBe("a");
    expect(step(order, null, -1)).toBe("c");
    expect(step(order, "gone", 1)).toBe("a");
  });

  it("goes on from the row selected before the panel closed, when the order holds it", () => {
    expect(step(order, null, 1, "b")).toBe("c");
    expect(step(order, null, -1, "b")).toBe("a");
    expect(step(order, null, 1, "c")).toBe("c");
    expect(step(order, null, 1, "gone")).toBe("a");
    expect(step(order, "a", 1, "c")).toBe("b");
  });

  it("selects nothing in an empty order", () => {
    expect(step([], null, 1)).toBeNull();
    expect(step([], "a", -1, "a")).toBeNull();
  });
});

describe("the open status tab", () => {
  const onHold = session("s", "on-hold");

  it("is the selected session's status", () => {
    expect(openTab(onHold, null)).toBe("on-hold");
  });

  it("is the tab the user opened while that session was selected with that status", () => {
    expect(openTab(onHold, { status: "done", session: "s", sessionStatus: "on-hold" })).toBe("done");
  });

  it("follows the session again once its status changes, or for another session", () => {
    expect(openTab(session("s", "done-skip"), { status: "done", session: "s", sessionStatus: "on-hold" })).toBe("done-skip");
    expect(openTab(onHold, { status: "done", session: "other", sessionStatus: "on-hold" })).toBe("on-hold");
  });
});

describe("the list's rows", () => {
  const done = many("d", 15, "done");

  it("cut a long tab to its latest 10 until it is expanded", () => {
    expect(listRows("done", done, false, "d2")).toEqual({ rows: done.slice(0, 10), long: true, expanded: false });
    expect(listRows("done", done, true, "d2")).toEqual({ rows: done, long: true, expanded: true });
  });

  it("show every row when the selected session is past the latest 10", () => {
    expect(listRows("done", done, false, "d13")).toEqual({ rows: done, long: true, expanded: true });
  });

  it("cut as usual when the selected session is in another tab", () => {
    expect(listRows("done", done, false, "elsewhere").rows).toHaveLength(10);
  });

  it("never cut Active or On hold, nor 12 rows", () => {
    expect(listRows("active", many("a", 15, "active"), false, null)).toMatchObject({ long: false, expanded: true });
    expect(listRows("done", done.slice(0, 12), false, null)).toMatchObject({ long: false, expanded: true });
  });
});

describe("revealing a row in the table", () => {
  const groups = groupsOf({ active: [session("a1")], done: many("d", 15, "done") });
  const collapsed: ReadonlySet<SessionStatus> = new Set(["done", "active"]);
  const expanded: ReadonlySet<SessionStatus> = new Set();

  it("uncollapses its group and expands it when the row is past the latest 10", () => {
    const revealed = revealInTable(groups, "d14", collapsed, expanded);
    expect([...revealed.collapsed]).toEqual(["active"]);
    expect([...revealed.expanded]).toEqual(["done"]);
  });

  it("leaves the sets as they are when the row shows already", () => {
    const open: ReadonlySet<SessionStatus> = new Set();
    const revealed = revealInTable(groups, "d1", open, expanded);
    expect(revealed.collapsed).toBe(open);
    expect(revealed.expanded).toBe(expanded);
  });

  it("leaves the sets as they are for a session the table does not hold", () => {
    expect(revealInTable(groups, "gone", collapsed, expanded)).toEqual({ collapsed, expanded });
  });
});
