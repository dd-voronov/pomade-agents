// What runs now, and each session's live state (DESIGN §2.4, glossary "Live state"): detected,
// never set. One entry per live thing, from its live source; each source replaces or changes only
// its own entries. Agent tabs are a source (`agentTabs.list`, then every `agentTab.changed`;
// pomade:E-033): a tab is live while its state is `working`, `needs-you` or `idle`, and `exited`
// or gone means nothing runs there. Runner's agent runs are the other (`runner-runs.ts`): a run is
// Working from its run started to its run finished.
//
// A session's live state is that of the live entry bound to it — the most urgent when several are
// (needs-you, then working, then idle) — and Closed when none is. A tab bound to the session wins
// over a run of it: the tab sees the agent wait or ask, a run only that it runs. `since` is when the backend saw
// the session enter that state: a state already there when the backend first lists it is dated
// then, and a session never seen live this run is Closed since `null`.

import type { AgentTabInfo, SessionLiveState } from "pomade-kit/protocol";

/** A live source's kind, as `LiveSession.source` names it. */
export type LiveSourceKind = "tab" | "run";

/** One live thing: an agent running somewhere now. */
export interface LiveEntry {
  source: LiveSourceKind;
  /** The session it runs; `null` while none is bound (an agent tab not prompted yet). */
  sessionId: string | null;
  /** The agent's roster id. */
  agent: string;
  /** Where it runs: absolute, symlinks resolved; `null` while not known. */
  cwd: string | null;
  state: Exclude<SessionLiveState, "closed">;
  /** A run's job name; `null` for a tab. */
  job: string | null;
  /** When the backend saw it enter `state` with this session (ISO 8601). */
  since: string;
}

/** A session's live state and since when (ISO 8601; `null`: Closed, and never seen live this run). */
export interface SessionLive {
  live: SessionLiveState;
  liveSince: string | null;
}

export interface LiveState {
  /** Replace every entry of `source` with `entries`, by key (a tab's id). */
  replace(source: LiveSourceKind, entries: ReadonlyMap<string, Omit<LiveEntry, "since" | "source">>): void;
  /** Set (`entry`) or drop (`null`) one entry of `source`. */
  put(source: LiveSourceKind, key: string, entry: Omit<LiveEntry, "since" | "source"> | null): void;
  /** Every live entry now. */
  entries(): LiveEntry[];
  ofSession(sessionId: string): SessionLive;
  /** Called with the sessions whose live state changed; returns an unsubscribe function. */
  onChange(listener: (sessionIds: string[]) => void): () => void;
}

const URGENCY: Record<LiveEntry["state"], number> = { "needs-you": 3, working: 2, idle: 1 };

const CLOSED: SessionLive = { live: "closed", liveSince: null };

export function createLiveState(now: () => Date): LiveState {
  /** `<source>\0<key>` → entry. */
  const live = new Map<string, LiveEntry>();
  /** When each session that was live this run stopped being live. */
  const closedAt = new Map<string, string>();
  const listeners = new Set<(sessionIds: string[]) => void>();

  const closedOf = (sessionId: string): SessionLive => {
    const at = closedAt.get(sessionId);
    return at === undefined ? CLOSED : { live: "closed", liveSince: at };
  };

  const ofSession = (sessionId: string): SessionLive => {
    let best: LiveEntry | null = null;
    for (const entry of live.values()) {
      if (entry.sessionId !== sessionId) continue;
      const tabOverRun = best !== null && entry.source !== best.source ? entry.source === "tab" : null;
      if (best === null || (tabOverRun ?? URGENCY[entry.state] > URGENCY[best.state])) best = entry;
    }
    return best === null ? closedOf(sessionId) : { live: best.state, liveSince: best.since };
  };

  /** Apply `apply` to the entries, then date the sessions whose state it changed and tell the listeners. */
  const change = (apply: () => void): void => {
    const bound = (): string[] => [...live.values()].flatMap((entry) => (entry.sessionId === null ? [] : [entry.sessionId]));
    const before = new Map(bound().map((id) => [id, ofSession(id)]));
    apply();
    // A session bound only now was Closed before: `apply` leaves `closedAt` alone.
    for (const id of bound()) if (!before.has(id)) before.set(id, closedOf(id));
    const at = now().toISOString();
    const changed: string[] = [];
    for (const [id, was] of before) {
      const is = ofSession(id);
      if (is.live === "closed" && was.live !== "closed") closedAt.set(id, at);
      else if (is.live !== "closed") closedAt.delete(id);
      const after = ofSession(id);
      if (after.live !== was.live || after.liveSince !== was.liveSince) changed.push(id);
    }
    if (changed.length > 0) for (const listener of listeners) listener(changed);
  };

  /** The entry as it stands after a change: it keeps its `since` while its state and session stay. */
  const dated = (source: LiveSourceKind, key: string, next: Omit<LiveEntry, "since" | "source">, at: string): LiveEntry => {
    const held = live.get(`${source}\0${key}`);
    const since = held !== undefined && held.state === next.state && held.sessionId === next.sessionId ? held.since : at;
    return { ...next, source, since };
  };

  return {
    replace(source, entries) {
      change(() => {
        const at = now().toISOString();
        const next = new Map<string, LiveEntry>();
        for (const [key, entry] of entries) next.set(key, dated(source, key, entry, at));
        for (const key of [...live.keys()]) if (key.startsWith(`${source}\0`)) live.delete(key);
        for (const [key, entry] of next) live.set(`${source}\0${key}`, entry);
      });
    },

    put(source, key, entry) {
      change(() => {
        if (entry === null) live.delete(`${source}\0${key}`);
        else live.set(`${source}\0${key}`, dated(source, key, entry, now().toISOString()));
      });
    },

    entries: () => [...live.values()],

    ofSession,

    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** An agent tab as a live entry; `null` when no agent runs in it (`exited`). */
export function tabEntry(tab: AgentTabInfo): Omit<LiveEntry, "since" | "source"> | null {
  if (tab.state === "exited") return null;
  return { sessionId: tab.sessionId, agent: tab.agentId, cwd: tab.cwd, state: tab.state, job: null };
}

/** The agent tabs as a live source: a full listing, or one tab as it is now (`closed`: it left the list). */
export function followTabs(state: LiveState): { list(tabs: readonly AgentTabInfo[]): void; changed(tab: AgentTabInfo, closed: boolean): void } {
  return {
    list(tabs) {
      const entries = new Map<string, Omit<LiveEntry, "since" | "source">>();
      for (const tab of tabs) {
        const entry = tabEntry(tab);
        if (entry !== null) entries.set(tab.tabId, entry);
      }
      state.replace("tab", entries);
    },
    changed(tab, closed) {
      state.put("tab", tab.tabId, closed ? null : tabEntry(tab));
    },
  };
}
