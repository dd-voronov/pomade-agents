// Which agent tab each session is bound to (`Session.tab`; pomade:E-033): every agent tab Pomade
// lists (`agentTabs.list`, then every `agentTab.changed`; forgotten when the connection ends) and
// the session it names. A tab stays bound while Pomade lists it — an `exited` one too: a tab
// restored from an earlier run revives when it is focused, and a dead one shows why it died. Of
// several tabs bound to one session, a live one answers before an exited one, then the first
// listed.

import type { AgentTabInfo } from "pomade-kit/protocol";

import type { SessionTab } from "../../shared/sessions.ts";

export interface BoundTabs {
  /** Every agent tab, as Pomade lists them now. */
  list(tabs: readonly AgentTabInfo[]): void;
  /** One agent tab as it is now (`closed`: it left the list). */
  changed(tab: AgentTabInfo, closed: boolean): void;
  /** The tab bound to the session; `null` when none is. */
  ofSession(sessionId: string): SessionTab | null;
  /** Called with the sessions whose tab changed; returns an unsubscribe function. */
  onChange(listener: (sessionIds: string[]) => void): () => void;
}

const same = (a: SessionTab | null, b: SessionTab | null): boolean => a?.tabId === b?.tabId && a?.projectId === b?.projectId;

export function createBoundTabs(): BoundTabs {
  /** Tab id → the tab as last listed or changed, in listing order. */
  const tabs = new Map<string, AgentTabInfo>();
  const listeners = new Set<(sessionIds: string[]) => void>();

  const ofSession = (sessionId: string): SessionTab | null => {
    let best: AgentTabInfo | null = null;
    for (const tab of tabs.values()) {
      if (tab.sessionId !== sessionId) continue;
      if (best === null || (best.state === "exited" && tab.state !== "exited")) best = tab;
    }
    return best === null ? null : { tabId: best.tabId, projectId: best.projectId };
  };

  /** Apply `apply` to the tabs, then tell the listeners of each session whose tab it changed. */
  const change = (apply: () => void): void => {
    const sessions = (): string[] => [...tabs.values()].flatMap((tab) => (tab.sessionId === null ? [] : [tab.sessionId]));
    const before = new Map(sessions().map((id) => [id, ofSession(id)]));
    apply();
    for (const id of sessions()) if (!before.has(id)) before.set(id, null);
    const changed = [...before].filter(([id, was]) => !same(was, ofSession(id))).map(([id]) => id);
    if (changed.length > 0) for (const listener of listeners) listener(changed);
  };

  return {
    list(listed) {
      change(() => {
        tabs.clear();
        for (const tab of listed) tabs.set(tab.tabId, tab);
      });
    },

    changed(tab, closed) {
      change(() => {
        if (closed) tabs.delete(tab.tabId);
        else tabs.set(tab.tabId, tab);
      });
    },

    ofSession,

    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
