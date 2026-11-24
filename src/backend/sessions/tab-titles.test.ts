import { describe, expect, it } from "vitest";

import type { AgentTabChange, AgentTabInfo } from "pomade-kit/protocol";

import type { Session, SessionRecord, SessionsChanged } from "../../shared/sessions.ts";
import { startTabTitles, type TabTitlesOptions } from "./tab-titles.ts";

type Sessions = TabTitlesOptions["sessions"];

/** Sessions by id: a record (`name` set or not), `null` for one without a record yet, a string for an unusable record. */
function fakeSessions(initial: Record<string, { name?: string } | null | string>) {
  const known = new Map(Object.entries(initial));
  const changeListeners = new Set<(changed: SessionsChanged) => void>();
  const nameListeners = new Set<(id: string, name: string | null) => void>();
  const renamed: [string, string | null][] = [];
  const sessions: Sessions = {
    get(id) {
      if (!known.has(id)) return undefined;
      const held = known.get(id);
      const record = held === null || typeof held === "string" ? null : ({ id, ...held } as SessionRecord);
      return { id, record, recordProblem: typeof held === "string" ? held : null } as Session;
    },
    async rename(id, name) {
      renamed.push([id, name]);
      known.set(id, name === null ? {} : { name });
      for (const listener of nameListeners) listener(id, name);
      return sessions.get(id) as Session;
    },
    onChange(listener) {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
    onNameChange(listener) {
      nameListeners.add(listener);
      return () => nameListeners.delete(listener);
    },
  };
  return {
    sessions,
    renamed,
    /** A session gets (or changes) its record; the sessions tell their listeners. */
    set(id: string, value: { name?: string } | null | string) {
      known.set(id, value);
      for (const listener of changeListeners) listener({ epoch: "e", revision: 1 });
    },
  };
}

function tab(tabId: string, patch: Partial<AgentTabInfo> = {}): AgentTabInfo {
  return { tabId, projectId: "alpha", agentId: "claude", cwd: "/ws/Projects/alpha", launchedAt: null, sessionId: null, title: "Claude", titleSource: "default", unnamed: false, state: "idle", ...patch };
}

function setup(initial: Parameters<typeof fakeSessions>[0]) {
  const fake = fakeSessions(initial);
  const titled: [string, string | null][] = [];
  const titles = startTabTitles({ sessions: fake.sessions, log: () => undefined });
  titles.connect(async (tabId, title) => {
    titled.push([tabId, title]);
  });
  const change = (t: AgentTabInfo, ...changes: AgentTabChange[]): void => titles.changed(t, changes);
  return { ...fake, titles, titled, change };
}

describe("tab titles", () => {
  it("retitles every tab bound to a renamed session, with null for an unnamed one, and leaves a tab that shows it alone", async () => {
    const { titles, titled, sessions } = setup({ s: {}, other: {} });
    titles.list([tab("t1", { sessionId: "s", unnamed: true }), tab("t2", { sessionId: "other", unnamed: true })]);
    expect(titled).toEqual([]);

    await sessions.rename("s", "G4 agents grill");
    await sessions.rename("s", null);
    expect(titled).toEqual([
      ["t1", "G4 agents grill"],
      ["t1", null],
    ]);
  });

  it("renames the session when the user renames its tab, and not when the app or the default retitles it", async () => {
    const { titles, renamed, change, titled } = setup({ s: { name: "G4 agents grill" } });
    titles.list([tab("t", { sessionId: "s", title: "G4 agents grill", titleSource: "app" })]);
    change(tab("t", { sessionId: "s", title: "G4 tickets", titleSource: "user" }), "title");
    expect(renamed).toEqual([["s", "G4 tickets"]]);
    // The tab already shows the new name: no retitle back.
    expect(titled).toEqual([]);

    change(tab("t", { sessionId: "s", title: "Other", titleSource: "app" }), "title");
    change(tab("t", { sessionId: "s", title: "Claude", titleSource: "default", unnamed: true }), "title");
    expect(renamed).toEqual([["s", "G4 tickets"]]);
  });

  it("marks the tab unnamed when /clear binds a new session, once that session has its record, and keeps the old session's name", () => {
    const { titles, change, titled, renamed, set } = setup({ old: { name: "G4 tickets" } });
    titles.list([tab("t", { sessionId: "old", title: "G4 tickets", titleSource: "user" })]);
    change(tab("t", { sessionId: "new", title: "G4 tickets", titleSource: "user" }), "session");
    expect(titled).toEqual([]);
    set("new", null);
    expect(titled).toEqual([]);
    set("new", {});
    expect(titled).toEqual([["t", null]]);
    expect(renamed).toEqual([]);
  });

  it("shows the session's name when an in-session /resume binds a named session, and when a resume opens a tab on it", () => {
    const { titles, change, titled } = setup({ a: {}, named: { name: "Release notes" } });
    titles.list([tab("t", { sessionId: "a", unnamed: true })]);
    change(tab("t", { sessionId: "named", unnamed: true }), "session");
    change(tab("r", { sessionId: "named" }), "opened");
    expect(titled).toEqual([
      ["t", "Release notes"],
      ["r", "Release notes"],
    ]);
  });

  it("names a session after the title the user gave its tab before its first session", () => {
    const { change, renamed, titled, set } = setup({});
    change(tab("t"), "opened");
    change(tab("t", { title: "Spike", titleSource: "user" }), "title");
    change(tab("t", { sessionId: "s", title: "Spike", titleSource: "user" }), "session");
    set("s", {});
    expect(renamed).toEqual([["s", "Spike"]]);
    expect(titled).toEqual([]);
  });

  it("gives restored tabs their session's name; a listed tab the user titled names an unnamed session", () => {
    const { titles, titled, renamed } = setup({ named: { name: "G4 tickets" }, plain: {}, hand: {}, same: { name: "Same" } });
    titles.list([
      tab("t1", { sessionId: "named" }),
      tab("t2", { sessionId: "plain" }),
      tab("t3", { sessionId: "hand", title: "By hand", titleSource: "user" }),
      tab("t4", { sessionId: "same", title: "Same", titleSource: "app" }),
      tab("t5"),
    ]);
    expect(titled).toEqual([
      ["t1", "G4 tickets"],
      ["t2", null],
    ]);
    expect(renamed).toEqual([["hand", "By hand"]]);

    // Listed again with nothing changed: nothing to do.
    titles.list([tab("t1", { sessionId: "named", title: "G4 tickets", titleSource: "app" })]);
    expect(titled).toHaveLength(2);
  });

  it("waits while a session's record is not there, gives up on an unusable one, and forgets a tab that closed or a connection that ended", async () => {
    const { titles, titled, set, sessions, change } = setup({});
    titles.list([tab("t1", { sessionId: "late" }), tab("t2", { sessionId: "broken" })]);
    set("broken", "not a mapping");
    set("broken", { name: "Fixed" });
    expect(titled).toEqual([]);

    change(tab("t1", { sessionId: "late", state: "exited" }), "closed");
    set("late", { name: "Late" });
    expect(titled).toEqual([]);

    titles.list([tab("t3", { sessionId: "late" })]);
    expect(titled).toEqual([["t3", "Late"]]);
    titles.connect(null);
    await sessions.rename("late", "Later");
    expect(titled).toEqual([["t3", "Late"]]);
  });
});
