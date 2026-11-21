// Events B and C (DESIGN §6, docs/CONTRACTS.md "Published events"), built from the session as the
// app knows it when the event goes out.
//
// - **C `session.statusChanged`** — every status change `changeStatus` makes goes through the
//   status window (`status-window.ts`) and is published once it stood for `STATUS_WINDOW_MS`.
// - **B `session.closed`** — from Pomade's `agentTab.exited`: an agent process in a tab ended,
//   with the session bound to the tab then. `quit` (Pomade quit or closed the workspace and will
//   resume the session at its next launch) is a pause, not an end, and an exit with no session
//   bound has no session to tell of: neither publishes. A session the app does not know yet (its
//   transcript is still being read) is waited for up to `CLOSED_WAIT_MS`.
//
// `stop` publishes the pending status changes and resolves once they are sent.

import type { AgentTabExitedPayload } from "pomade-kit/protocol";

import {
  SESSION_CLOSED_EVENT,
  SESSION_STATUS_CHANGED_EVENT,
  type SessionClosedEvent,
  type SessionClosedReason,
  type SessionEventBase,
  type StatusChangedEvent,
} from "../../shared/session-events.ts";
import type { Session } from "../../shared/sessions.ts";
import type { RealPath } from "../core/real-paths.ts";
import type { ProjectPlace } from "./attribution.ts";
import type { SessionData } from "./session-data.ts";
import { REAL_TIMERS, createStatusWindow, type SettledStatus, type Timers } from "./status-window.ts";

/** How long a closed session the app does not know yet is waited for. */
export const CLOSED_WAIT_MS = 5000;

/** Publishes one of the app's own events; rejects when it could not. */
export type Publish = (name: string, payload: SessionClosedEvent | StatusChangedEvent) => Promise<void>;

export interface SessionEventsOptions {
  sessions: Pick<SessionData, "get" | "projects" | "onChange" | "onStatusChange">;
  publish: Publish;
  realPath: RealPath;
  windowMs: number;
  now: () => Date;
  log: (line: string) => void;
  timers?: Timers;
}

export interface SessionEvents {
  /** Pomade's `agentTab.exited`. */
  tabExited(exited: AgentTabExitedPayload): void;
  /** Publish the pending status changes, stop listening; resolves once they are sent. */
  stop(): Promise<void>;
}

const CLOSING_REASONS: Partial<Record<AgentTabExitedPayload["reason"], SessionClosedReason>> = { exit: "exit", "tab-closed": "tab-closed", crash: "crash" };

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The payload every event carries, for a session with a usable record; `null` without one. */
export async function eventBase(session: Session, projects: readonly ProjectPlace[] | null, at: string, real: RealPath): Promise<SessionEventBase | null> {
  const { record, summary } = session;
  if (record === null) return null;
  const projectId = session.attribution.projects[0];
  // Pomade's projects are known once it is reached, and events go out only then; the record's root
  // stands in for a project not listed yet.
  const root = projects?.find((p) => p.id === projectId)?.root ?? record.projectRoot ?? "";
  return {
    sessionId: session.id,
    provider: summary.provider,
    agent: summary.agent,
    project: projectId === undefined ? null : { id: projectId, root },
    cwd: summary.cwd === null ? null : await real(summary.cwd),
    transcript: summary.transcript,
    name: record.name ?? null,
    status: record.status,
    startedByRunner: record.startedByRunner !== undefined,
    job: record.startedByRunner?.job ?? null,
    at,
  };
}

export function startSessionEvents(options: SessionEventsOptions): SessionEvents {
  const { sessions, publish, realPath, now, log } = options;
  const timers = options.timers ?? REAL_TIMERS;
  const sending = new Set<Promise<void>>();

  const send = (name: string, build: () => Promise<SessionClosedEvent | StatusChangedEvent | null>): void => {
    const task = build()
      .then((payload) => (payload === null ? undefined : publish(name, payload)))
      .catch((err: unknown) => log(`events: could not publish ${name}: ${message(err)}`))
      .finally(() => sending.delete(task));
    sending.add(task);
  };

  // ── C ────────────────────────────────────────────────────────────────────

  const statusChanged = ({ id, from, to, at }: SettledStatus): void => {
    send(SESSION_STATUS_CHANGED_EVENT, async () => {
      const session = sessions.get(id);
      const base = session === undefined ? null : await eventBase(session, sessions.projects(), at, realPath);
      if (base === null) {
        log(`events: session ${id} changed status but is not known with a record; ${SESSION_STATUS_CHANGED_EVENT} not published`);
        return null;
      }
      return { ...base, status: to, from, to };
    });
  };
  const window = createStatusWindow({ windowMs: options.windowMs, settled: statusChanged, timers });
  const unsubscribeStatus = sessions.onStatusChange(({ id, from, to, at }) => window.changed(id, from, to, at));

  // ── B ────────────────────────────────────────────────────────────────────

  /** Exits whose session is not known yet: session id → what to publish once it is. */
  const waiting = new Map<string, { reason: SessionClosedReason; at: string; timer: unknown }>();

  const closed = (id: string, reason: SessionClosedReason, at: string): boolean => {
    const session = sessions.get(id);
    if (session === undefined || session.record === null) return false;
    send(SESSION_CLOSED_EVENT, async () => {
      const base = await eventBase(session, sessions.projects(), at, realPath);
      return base === null ? null : { ...base, reason };
    });
    return true;
  };

  const unsubscribeSessions = sessions.onChange(() => {
    for (const [id, { reason, at, timer }] of [...waiting]) {
      if (!closed(id, reason, at)) continue;
      timers.clear(timer);
      waiting.delete(id);
    }
  });

  return {
    tabExited({ sessionId, reason }) {
      const closing = CLOSING_REASONS[reason];
      if (sessionId === null || closing === undefined) return;
      const at = now().toISOString();
      if (closed(sessionId, closing, at)) return;
      const held = waiting.get(sessionId);
      if (held !== undefined) timers.clear(held.timer);
      const timer = timers.set(() => {
        waiting.delete(sessionId);
        log(`events: session ${sessionId} ended but is not known with a record; ${SESSION_CLOSED_EVENT} not published`);
      }, CLOSED_WAIT_MS);
      waiting.set(sessionId, { reason: closing, at, timer });
    },

    async stop() {
      unsubscribeStatus();
      unsubscribeSessions();
      for (const { timer } of waiting.values()) timers.clear(timer);
      waiting.clear();
      window.flush();
      await Promise.all([...sending]);
    },
  };
}
