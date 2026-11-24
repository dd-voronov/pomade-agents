// The Live now panel's rows and the Agents icon's badge (DESIGN §2.8; docs/CONTRACTS.md "Live
// now"), from the live state the backend already keeps: one row per live agent tab, with its
// session's name and first message and the agent's roster name, and one per Runner agent run while
// it runs, with its job and its attached terminal (`runner-runs.ts`). The backend keeps the badge — the
// number of Needs you rows — because it runs from Pomade's start, while the panel's frame exists
// only once its icon was shown.
//
// Rows are built again whenever the live entries, the sessions or the roster change; a different
// answer is a new revision, which `onChange` hears and `liveNow.changed` tells the frames.

import { randomUUID } from "node:crypto";

import type { LiveNowAnswer, LiveNowChanged, LiveRow } from "../../shared/live-now.ts";
import { liveRowKey, needsYouCount } from "../../shared/live-now.ts";
import type { Roster } from "../roster/roster.ts";
import type { LiveEntry, LiveState } from "./live-state.ts";
import { runOfKey } from "./runner-runs.ts";
import type { SessionData } from "./session-data.ts";

export interface LiveNowOptions {
  live: Pick<LiveState, "entries" | "onEntries">;
  sessions: Pick<SessionData, "get" | "onChange">;
  roster: Pick<Roster, "answer" | "onChange">;
}

export interface LiveNow {
  answer(): LiveNowAnswer;
  /** The Needs you rows now. */
  needsYou(): number;
  /** Called with the new revision whenever the answer changes; returns an unsubscribe function. */
  onChange(listener: (changed: LiveNowChanged) => void): () => void;
  stop(): void;
}

/** A first message as one line. */
const oneLine = (text: string): string | null => text.replace(/\s+/g, " ").trim() || null;

export function startLiveNow({ live, sessions, roster }: LiveNowOptions): LiveNow {
  const epoch = randomUUID();
  let revision = 0;
  let rows: LiveRow[] = [];
  let held = "[]";
  const listeners = new Set<(changed: LiveNowChanged) => void>();

  const rowOf = (entry: LiveEntry, names: ReadonlyMap<string, string>): LiveRow => {
    const agentName = names.get(entry.agent) ?? entry.agent;
    if (entry.source === "run") {
      return {
        kind: "run",
        ...runOfKey(entry.key),
        name: entry.job ?? "",
        project: entry.projectId,
        sessionId: entry.sessionId,
        agent: entry.agent,
        agentName,
        state: "working",
        since: entry.since,
        terminal: entry.terminal,
      };
    }
    const session = entry.sessionId === null ? undefined : sessions.get(entry.sessionId);
    const first = session?.summary.firstMessage?.text;
    return {
      kind: "tab",
      tabId: entry.key,
      project: entry.projectId,
      sessionId: entry.sessionId,
      agent: entry.agent,
      agentName,
      state: entry.state,
      since: entry.since,
      name: session?.record?.name ?? null,
      firstMessage: first === undefined ? null : oneLine(first),
    };
  };

  const build = (): void => {
    const names = new Map(roster.answer().agents.map((agent) => [agent.id, agent.name]));
    const next = live
      .entries()
      .map((entry) => rowOf(entry, names))
      .map((row) => [liveRowKey(row), row] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, row]) => row);
    const json = JSON.stringify(next);
    if (json === held) return;
    held = json;
    rows = next;
    revision += 1;
    for (const listener of listeners) listener({ epoch, revision });
  };

  const unsubscribe = [live.onEntries(build), sessions.onChange(() => build()), roster.onChange(() => build())];
  build();

  return {
    answer: () => ({ epoch, revision, rows }),
    needsYou: () => needsYouCount(rows),
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop() {
      for (const off of unsubscribe) off();
      listeners.clear();
    },
  };
}

/** Sets the Agents icon's badge through the connection that is up. */
export type SetBadge = (count: number) => Promise<void>;

export interface LiveBadge {
  /** A new connection: Pomade shows no badge of the app's now (a restarted Pomade, a restarted app). */
  connected(set: SetBadge): void;
  disconnected(): void;
  /** Pomade finished starting (`pomade.ready`): set the badge again — a window that came up after
   *  the backend's first badge has not seen it. */
  ready(): void;
  stop(): void;
}

/** The badge kept at `needsYou()` while a connection is up: set when it changes, cleared at 0. */
export function keepBadge(liveNow: Pick<LiveNow, "needsYou" | "onChange">, log: (line: string) => void): LiveBadge {
  let set: SetBadge | null = null;
  /** What Pomade shows now. */
  let shown = 0;

  const send = (count: number): void => {
    if (set === null) return;
    shown = count;
    set(count).catch((err: unknown) => log(`could not set the badge: ${err instanceof Error ? err.message : String(err)}`));
  };
  const follow = (): void => {
    const count = liveNow.needsYou();
    if (count !== shown) send(count);
  };
  const unsubscribe = liveNow.onChange(follow);

  return {
    connected(next) {
      set = next;
      shown = 0;
      follow();
    },
    disconnected() {
      set = null;
    },
    ready() {
      const count = liveNow.needsYou();
      if (count > 0) send(count);
    },
    stop() {
      unsubscribe();
      set = null;
    },
  };
}
