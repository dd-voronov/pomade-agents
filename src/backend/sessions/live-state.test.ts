import type { AgentTabInfo } from "pomade-kit/protocol";
import { describe, expect, it } from "vitest";

import { createLiveState, followTabs } from "./live-state.ts";

const T0 = "2026-11-21T10:00:00.000Z";

function tab(patch: Partial<AgentTabInfo> & Pick<AgentTabInfo, "tabId">): AgentTabInfo {
  return {
    projectId: "alpha",
    agentId: "claude",
    cwd: "/w/alpha",
    launchedAt: T0,
    sessionId: null,
    title: "Claude",
    titleSource: "default",
    unnamed: false,
    state: "idle",
    ...patch,
  };
}

function setup() {
  let clock = new Date(T0);
  const state = createLiveState(() => clock);
  const tabs = followTabs(state);
  const heard: string[][] = [];
  state.onChange((ids) => heard.push([...ids].sort()));
  return {
    state,
    tabs,
    heard,
    at(iso: string) {
      clock = new Date(iso);
    },
  };
}

describe("the live state", () => {
  it("takes each session's state from the agent tab bound to it, and dates it when it changes", () => {
    const { state, tabs, heard, at } = setup();
    expect(state.ofSession("s1")).toEqual({ live: "closed", liveSince: null });

    tabs.list([tab({ tabId: "t1", sessionId: "s1", state: "working" }), tab({ tabId: "t2" })]);
    expect(state.ofSession("s1")).toEqual({ live: "working", liveSince: T0 });
    expect(heard).toEqual([["s1"]]);

    at("2026-11-21T10:01:00.000Z");
    tabs.changed(tab({ tabId: "t1", sessionId: "s1", state: "needs-you" }), false);
    expect(state.ofSession("s1")).toEqual({ live: "needs-you", liveSince: "2026-11-21T10:01:00.000Z" });

    at("2026-11-21T10:02:00.000Z");
    tabs.changed(tab({ tabId: "t1", sessionId: "s1", state: "needs-you", title: "Renamed" }), false);
    expect(state.ofSession("s1").liveSince).toBe("2026-11-21T10:01:00.000Z");
    expect(heard).toHaveLength(2);

    at("2026-11-21T10:03:00.000Z");
    tabs.changed(tab({ tabId: "t1", sessionId: "s1", state: "idle" }), false);
    expect(state.ofSession("s1")).toEqual({ live: "idle", liveSince: "2026-11-21T10:03:00.000Z" });
  });

  it("is Closed since the moment the tab's agent exits or the tab leaves", () => {
    const { state, tabs, heard, at } = setup();
    tabs.list([tab({ tabId: "t1", sessionId: "s1", state: "working" }), tab({ tabId: "t2", sessionId: "s2" })]);
    at("2026-11-21T10:05:00.000Z");
    tabs.changed(tab({ tabId: "t1", sessionId: "s1", state: "exited" }), false);
    expect(state.ofSession("s1")).toEqual({ live: "closed", liveSince: "2026-11-21T10:05:00.000Z" });
    at("2026-11-21T10:06:00.000Z");
    tabs.changed(tab({ tabId: "t2", sessionId: "s2", state: "exited" }), true);
    expect(state.ofSession("s2")).toEqual({ live: "closed", liveSince: "2026-11-21T10:06:00.000Z" });
    expect(heard).toEqual([["s1", "s2"], ["s1"], ["s2"]]);
    expect(state.entries()).toEqual([]);
  });

  it("follows a tab to its next session: the one it left is Closed, the new one live", () => {
    const { state, tabs, heard, at } = setup();
    tabs.list([tab({ tabId: "t1", sessionId: "s1", state: "idle" })]);
    at("2026-11-21T10:10:00.000Z");
    tabs.changed(tab({ tabId: "t1", sessionId: "s2", state: "idle" }), false);
    expect(state.ofSession("s1")).toEqual({ live: "closed", liveSince: "2026-11-21T10:10:00.000Z" });
    expect(state.ofSession("s2")).toEqual({ live: "idle", liveSince: "2026-11-21T10:10:00.000Z" });
    expect(heard.at(-1)).toEqual(["s1", "s2"]);
  });

  it("lists an agent tab not prompted yet as live with no session, and leaves out one whose agent exited", () => {
    const { state, tabs, heard } = setup();
    tabs.list([tab({ tabId: "t1" }), tab({ tabId: "t2", state: "exited", sessionId: "old" })]);
    expect(state.entries()).toEqual([{ source: "tab", sessionId: null, agent: "claude", cwd: "/w/alpha", state: "idle", job: null, since: T0 }]);
    expect(state.ofSession("old")).toEqual({ live: "closed", liveSince: null });
    expect(heard).toEqual([]);
  });

  it("answers the most urgent state when two entries hold one session", () => {
    const { state, tabs } = setup();
    tabs.list([tab({ tabId: "t1", sessionId: "s", state: "idle" }), tab({ tabId: "t2", sessionId: "s", state: "needs-you" })]);
    expect(state.ofSession("s").live).toBe("needs-you");
    tabs.changed(tab({ tabId: "t2", sessionId: "s", state: "working" }), false);
    expect(state.ofSession("s").live).toBe("working");
  });

  it("a new listing replaces the tabs: a state that stays keeps its date, a tab gone is Closed", () => {
    const { state, tabs, at } = setup();
    tabs.list([tab({ tabId: "t1", sessionId: "s1", state: "working" }), tab({ tabId: "t2", sessionId: "s2" })]);
    at("2026-11-21T11:00:00.000Z");
    tabs.list([tab({ tabId: "t1", sessionId: "s1", state: "working" })]);
    expect(state.ofSession("s1")).toEqual({ live: "working", liveSince: T0 });
    expect(state.ofSession("s2")).toEqual({ live: "closed", liveSince: "2026-11-21T11:00:00.000Z" });
    tabs.list([]);
    expect(state.entries()).toEqual([]);
    expect(state.ofSession("s1")).toEqual({ live: "closed", liveSince: "2026-11-21T11:00:00.000Z" });
  });

  it("takes a session's state from a tab bound to it over a run of it, and from the run once the tab goes", () => {
    const { state, tabs } = setup();
    state.put("run", "r1", { sessionId: "s", agent: "claude", cwd: "/w", state: "working", job: "Nightly" });
    expect(state.ofSession("s").live).toBe("working");
    tabs.list([tab({ tabId: "t1", sessionId: "s", state: "idle" })]);
    expect(state.ofSession("s").live).toBe("idle");
    tabs.list([]);
    expect(state.ofSession("s").live).toBe("working");
  });

  it("keeps each source's entries apart: replacing the tabs leaves the runs", () => {
    const { state, tabs } = setup();
    state.put("run", "r1", { sessionId: "s9", agent: "claude", cwd: "/w", state: "working", job: "Nightly" });
    tabs.list([tab({ tabId: "t1" })]);
    tabs.list([]);
    expect(state.entries()).toEqual([{ source: "run", sessionId: "s9", agent: "claude", cwd: "/w", state: "working", job: "Nightly", since: T0 }]);
    expect(state.ofSession("s9").live).toBe("working");
  });
});
