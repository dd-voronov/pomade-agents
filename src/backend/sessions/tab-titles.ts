// A session's name is its agent tab's title, both ways (ARCHITECTURE §2.5; pomade:E-033 titles and the
// unnamed mark). The backend keeps every agent tab as Pomade last told it, and:
//
// - **A rename** (`SessionData.rename`: the UI, the API, the command) retitles every tab bound to
//   the session — `agentTabs.setTitle(tabId, name)`, `null` for an unnamed session, which Pomade
//   draws as the agent's name in italics with the unnamed dot.
// - **The user renaming a tab** (`agentTab.changed`, `titleSource: "user"`) renames its session.
// - **A tab bound to a session** — its first session, a new one after `/clear` or `/fork`, the one
//   an in-session `/resume` adopts, a resume in a new tab, and every tab Pomade lists that the
//   backend did not know (restored at Pomade's start) — takes the session's name, or the unnamed
//   mark. Two cases keep the user's title instead and name the session with it: a tab the user
//   named before its first session, and a listed tab with a title of the user's bound to an unnamed
//   session (named by hand before the app ran).
//
// A tab waits for its session to have a record before either way is applied: a new session's record
// comes a moment after its transcript, and an existing one's while the stores are being read. A
// tab already showing what it should is left alone.

import type { AgentTabChange, AgentTabInfo } from "pomade-kit/protocol";

import type { SessionData } from "./session-data.ts";

/** Retitle an agent tab; `null` marks its session unnamed. */
export type SetTabTitle = (tabId: string, title: string | null) => Promise<void>;

export interface TabTitlesOptions {
  sessions: Pick<SessionData, "get" | "rename" | "onChange" | "onNameChange">;
  log: (line: string) => void;
}

export interface TabTitles {
  /** Pomade is connected (`setTitle` reaches it), or not (`null`: every tab is forgotten). */
  connect(setTitle: SetTabTitle | null): void;
  /** Every agent tab, as Pomade lists them now. */
  list(tabs: readonly AgentTabInfo[]): void;
  /** One agent tab as it is now, and what changed (`agentTab.changed`). */
  changed(tab: AgentTabInfo, changes: readonly AgentTabChange[]): void;
  stop(): void;
}

/** What a tab waits for its session's record to do. */
interface Pending {
  sessionId: string;
  /** Show the session's name (`show`); name the session with the tab's title unless it has a name
   *  (`adopt`); name the session with the tab's title (`user`). */
  action: "show" | "adopt" | "user";
  title: string;
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The tab shows `name` (`null`: the unnamed mark). */
function shows(tab: AgentTabInfo, name: string | null): boolean {
  return name === null ? tab.unnamed : !tab.unnamed && tab.titleSource !== "default" && tab.title === name;
}

export function startTabTitles({ sessions, log }: TabTitlesOptions): TabTitles {
  let setTitle: SetTabTitle | null = null;
  const tabs = new Map<string, AgentTabInfo>();
  const pending = new Map<string, Pending>();

  const show = (tab: AgentTabInfo, name: string | null): void => {
    if (setTitle === null || shows(tab, name)) return;
    // Held as asked until Pomade's `agentTab.changed` tells how it stands.
    tabs.set(tab.tabId, name === null ? { ...tab, titleSource: "default", unnamed: true } : { ...tab, title: name, titleSource: "app", unnamed: false });
    setTitle(tab.tabId, name).catch((err: unknown) => log(`sessions: could not retitle agent tab ${tab.tabId}: ${message(err)}`));
  };

  const rename = (sessionId: string, name: string): void => {
    sessions.rename(sessionId, name).catch((err: unknown) => log(`sessions: could not name session ${sessionId} after its tab: ${message(err)}`));
  };

  /** Do what the tab waits for once its session has a record; give up on one that cannot be used. */
  const settle = (tabId: string): void => {
    const wait = pending.get(tabId);
    const tab = tabs.get(tabId);
    if (wait === undefined || tab === undefined) return;
    const session = sessions.get(wait.sessionId);
    if (session?.recordProblem) {
      pending.delete(tabId);
      return;
    }
    const record = session?.record;
    if (record === null || record === undefined) return;
    pending.delete(tabId);
    const name = record.name ?? null;
    if (wait.action === "user" ? wait.title !== name : wait.action === "adopt" && name === null) rename(wait.sessionId, wait.title);
    else if (wait.action !== "user") show(tab, name);
  };

  const wait = (tab: AgentTabInfo, action: Pending["action"]): void => {
    if (tab.sessionId === null) {
      pending.delete(tab.tabId);
      return;
    }
    pending.set(tab.tabId, { sessionId: tab.sessionId, action, title: tab.title });
    settle(tab.tabId);
  };

  /** A tab bound to its session now; `before` is the tab as the backend knew it, if it did. */
  const bound = (tab: AgentTabInfo, before: AgentTabInfo | undefined): void => {
    const userTitle = tab.titleSource === "user";
    // Named by the user before its first session, or listed with the user's title: the title can name the session.
    wait(tab, userTitle && (before === undefined || before.sessionId === null) ? "adopt" : "show");
  };

  const forget = (tabId: string): void => {
    tabs.delete(tabId);
    pending.delete(tabId);
  };

  const unsubscribeNames = sessions.onNameChange((id, name) => {
    for (const tab of tabs.values()) {
      if (tab.sessionId !== id) continue;
      pending.delete(tab.tabId);
      show(tab, name);
    }
  });
  const unsubscribeSessions = sessions.onChange(() => {
    for (const tabId of [...pending.keys()]) settle(tabId);
  });

  return {
    connect(next) {
      setTitle = next;
      if (next === null) for (const tabId of [...tabs.keys()]) forget(tabId);
    },

    list(listed) {
      const ids = new Set(listed.map((tab) => tab.tabId));
      for (const tabId of [...tabs.keys()]) if (!ids.has(tabId)) forget(tabId);
      for (const tab of listed) {
        const before = tabs.get(tab.tabId);
        tabs.set(tab.tabId, tab);
        if (before === undefined || before.sessionId !== tab.sessionId) bound(tab, before);
      }
    },

    changed(tab, changes) {
      if (changes.includes("closed")) {
        forget(tab.tabId);
        return;
      }
      const before = tabs.get(tab.tabId);
      tabs.set(tab.tabId, tab);
      if (changes.includes("session") || changes.includes("opened") || before === undefined) {
        bound(tab, before);
      } else if (changes.includes("title") && tab.titleSource === "user" && tab.sessionId !== null) {
        wait(tab, "user");
      }
    },

    stop() {
      unsubscribeNames();
      unsubscribeSessions();
      setTitle = null;
      tabs.clear();
      pending.clear();
    },
  };
}
