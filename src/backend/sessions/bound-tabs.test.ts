import type { AgentTabInfo } from "pomade-kit/protocol";
import { describe, expect, it } from "vitest";

import { createBoundTabs } from "./bound-tabs.ts";

function tab(patch: Partial<AgentTabInfo> & Pick<AgentTabInfo, "tabId">): AgentTabInfo {
  return {
    projectId: "alpha",
    agentId: "claude",
    cwd: "/w/alpha",
    launchedAt: null,
    sessionId: null,
    title: "Claude",
    titleSource: "default",
    unnamed: false,
    state: "idle",
    ...patch,
  };
}

function setup() {
  const tabs = createBoundTabs();
  const heard: string[][] = [];
  tabs.onChange((ids) => heard.push([...ids].sort()));
  return { tabs, heard };
}

describe("the agent tabs sessions are bound to", () => {
  it("answers the listed tab bound to a session, an exited one too, and none for a session no tab names", () => {
    const { tabs, heard } = setup();
    tabs.list([tab({ tabId: "t1", sessionId: "s1" }), tab({ tabId: "t2", sessionId: "s2", projectId: "beta", state: "exited" }), tab({ tabId: "t3" })]);
    expect(tabs.ofSession("s1")).toEqual({ tabId: "t1", projectId: "alpha" });
    expect(tabs.ofSession("s2")).toEqual({ tabId: "t2", projectId: "beta" });
    expect(tabs.ofSession("s3")).toBeNull();
    expect(heard).toEqual([["s1", "s2"]]);
  });

  it("answers the session each listed agent tab names, until it leaves the list", () => {
    const { tabs } = setup();
    tabs.list([tab({ tabId: "t1", sessionId: "s1", state: "exited" }), tab({ tabId: "t2" })]);
    expect(tabs.ofTab("t1")).toEqual({ sessionId: "s1" });
    expect(tabs.ofTab("t2")).toEqual({ sessionId: null });
    expect(tabs.ofTab("plain")).toBeNull();
    tabs.changed(tab({ tabId: "t2", sessionId: "s2" }), false);
    expect(tabs.ofTab("t2")).toEqual({ sessionId: "s2" });
    tabs.changed(tab({ tabId: "t2", sessionId: "s2" }), true);
    expect(tabs.ofTab("t2")).toBeNull();
    tabs.list([]);
    expect(tabs.ofTab("t1")).toBeNull();
  });

  it("prefers a live tab over an exited one, then the first listed", () => {
    const { tabs } = setup();
    tabs.list([tab({ tabId: "dead", sessionId: "s1", state: "exited" }), tab({ tabId: "a", sessionId: "s1" }), tab({ tabId: "b", sessionId: "s1", state: "working" })]);
    expect(tabs.ofSession("s1")?.tabId).toBe("a");
    tabs.changed(tab({ tabId: "a", sessionId: "s1", state: "exited" }), false);
    expect(tabs.ofSession("s1")?.tabId).toBe("b");
  });

  it("follows each change: a new binding, a move to another project, a tab that left the list", () => {
    const { tabs, heard } = setup();
    tabs.list([tab({ tabId: "t1" })]);
    expect(heard).toEqual([]);
    tabs.changed(tab({ tabId: "t1", sessionId: "s1" }), false);
    expect(tabs.ofSession("s1")).toEqual({ tabId: "t1", projectId: "alpha" });
    tabs.changed(tab({ tabId: "t1", sessionId: "s1", projectId: "beta" }), false);
    expect(tabs.ofSession("s1")).toEqual({ tabId: "t1", projectId: "beta" });
    // A state change keeps the binding: no change to tell.
    tabs.changed(tab({ tabId: "t1", sessionId: "s1", projectId: "beta", state: "working" }), false);
    // `/clear`: the tab moves to a new session.
    tabs.changed(tab({ tabId: "t1", sessionId: "s2", projectId: "beta" }), false);
    expect(tabs.ofSession("s1")).toBeNull();
    tabs.changed(tab({ tabId: "t1", sessionId: "s2", projectId: "beta" }), true);
    expect(tabs.ofSession("s2")).toBeNull();
    expect(heard).toEqual([["s1"], ["s1"], ["s1", "s2"], ["s2"]]);
  });

  it("forgets every tab with an empty listing (the connection ended)", () => {
    const { tabs, heard } = setup();
    tabs.list([tab({ tabId: "t1", sessionId: "s1" })]);
    tabs.list([]);
    expect(tabs.ofSession("s1")).toBeNull();
    expect(heard).toEqual([["s1"], ["s1"]]);
  });
});
