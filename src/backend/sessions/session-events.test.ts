import type { AgentTabExitedPayload } from "pomade-kit/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_CLOSED_EVENT, SESSION_STATUS_CHANGED_EVENT, isSessionClosedEvent, isStatusChangedEvent } from "../../shared/session-events.ts";
import type { Session, SessionsChanged } from "../../shared/sessions.ts";
import { testSession, testSummary } from "../../shared/test-sessions.ts";
import type { ProjectPlace } from "./attribution.ts";
import type { StatusChange } from "./session-data.ts";
import { CLOSED_WAIT_MS, startSessionEvents, type SessionEvents } from "./session-events.ts";

const WINDOW = 5000;
const NOW = "2026-11-21T10:00:00.000Z";
const PROJECTS: ProjectPlace[] = [{ id: "alpha", root: "Projects/alpha", folder: "/ws/Projects/alpha" }];

/** The session data as the events see it. */
function fakeSessions() {
  const held = new Map<string, Session>();
  const changeListeners = new Set<(changed: SessionsChanged) => void>();
  const statusListeners = new Set<(change: StatusChange) => void>();
  return {
    get: (id: string) => held.get(id),
    projects: () => PROJECTS,
    onChange(listener: (changed: SessionsChanged) => void) {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
    onStatusChange(listener: (change: StatusChange) => void) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    put(session: Session) {
      held.set(session.id, session);
      for (const listener of changeListeners) listener({ epoch: "e", revision: 1 });
    },
    status(change: StatusChange) {
      for (const listener of statusListeners) listener(change);
    },
  };
}

const inAlpha = (id: string, patch: Partial<Session> = {}): Session =>
  testSession({
    id,
    summary: testSummary({ id, cwd: "/ws/link/alpha", transcript: `/home/.claude/projects/-ws/${id}.jsonl` }),
    record: { id, provider: "claude-code", agent: "claude", status: "active", name: "Grill", project: "alpha", projectRoot: "Projects/alpha" },
    attribution: { projects: ["alpha"], by: "folder", sharedFolder: false },
    ...patch,
  });

const exited = (sessionId: string | null, reason: AgentTabExitedPayload["reason"]): AgentTabExitedPayload => ({ tabId: "t1", projectId: "alpha", agentId: "claude", sessionId, reason });

describe("the session events", () => {
  let sessions: ReturnType<typeof fakeSessions>;
  let published: { name: string; payload: unknown }[];
  let lines: string[];
  let events: SessionEvents;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    sessions = fakeSessions();
    published = [];
    lines = [];
    events = startSessionEvents({
      sessions,
      publish: (name, payload) => {
        published.push({ name, payload });
        return Promise.resolve();
      },
      realPath: (path) => Promise.resolve(path.replace("/ws/link/", "/ws/Projects/")),
      windowMs: WINDOW,
      now: () => new Date(),
      log: (line) => lines.push(line),
    });
  });

  afterEach(async () => {
    await events.stop();
    vi.useRealTimers();
  });

  it("publishes C with the common payload once the change stood for the window", async () => {
    sessions.put(inAlpha("a", { record: { ...inAlpha("a").record!, status: "done" } }));
    sessions.status({ id: "a", from: "active", to: "done", at: NOW });
    await vi.advanceTimersByTimeAsync(WINDOW - 1);
    expect(published).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(published).toEqual([
      {
        name: SESSION_STATUS_CHANGED_EVENT,
        payload: {
          sessionId: "a",
          provider: "claude-code",
          agent: "claude",
          project: { id: "alpha", root: "Projects/alpha" },
          cwd: "/ws/Projects/alpha",
          transcript: "/home/.claude/projects/-ws/a.jsonl",
          name: "Grill",
          status: "done",
          startedByRunner: false,
          job: null,
          at: NOW,
          from: "active",
          to: "done",
        },
      },
    ]);
    expect(isStatusChangedEvent(published[0]?.payload)).toBe(true);
  });

  it("publishes no C for a change taken back, one per session for a bulk change, and the pending ones on stop", async () => {
    for (const id of ["a", "b", "c", "d"]) sessions.put(inAlpha(id));
    sessions.status({ id: "a", from: "active", to: "done", at: NOW });
    sessions.status({ id: "a", from: "done", to: "active", at: NOW });
    for (const id of ["b", "c", "d"]) sessions.status({ id, from: "active", to: "on-hold", at: NOW });
    await vi.advanceTimersByTimeAsync(WINDOW);
    expect(published.map((p) => [p.name, (p.payload as { sessionId: string }).sessionId])).toEqual([
      [SESSION_STATUS_CHANGED_EVENT, "b"],
      [SESSION_STATUS_CHANGED_EVENT, "c"],
      [SESSION_STATUS_CHANGED_EVENT, "d"],
    ]);

    sessions.status({ id: "a", from: "active", to: "done", at: NOW });
    await events.stop();
    expect(published.at(-1)?.payload).toMatchObject({ sessionId: "a", from: "active", to: "done", status: "done" });
  });

  it("marks a session Runner started, and places a Workspace session in no project", async () => {
    const base = inAlpha("r");
    sessions.put({ ...base, record: { ...base.record!, startedByRunner: { job: "Morning summary" } }, attribution: { projects: [], by: "workspace", sharedFolder: false } });
    events.tabExited(exited("r", "exit"));
    await vi.advanceTimersByTimeAsync(0);
    expect(published[0]?.payload).toMatchObject({ startedByRunner: true, job: "Morning summary", project: null, reason: "exit" });
    expect(isSessionClosedEvent(published[0]?.payload)).toBe(true);
  });

  it("publishes B at once for exit, tab-closed and crash, and nothing for quit or a tab with no session", async () => {
    sessions.put(inAlpha("a"));
    for (const reason of ["exit", "tab-closed", "crash", "quit"] as const) events.tabExited(exited("a", reason));
    events.tabExited(exited(null, "exit"));
    await vi.advanceTimersByTimeAsync(0);
    expect(published.map((p) => [p.name, (p.payload as { reason: string }).reason])).toEqual([
      [SESSION_CLOSED_EVENT, "exit"],
      [SESSION_CLOSED_EVENT, "tab-closed"],
      [SESSION_CLOSED_EVENT, "crash"],
    ]);
    expect(published[0]?.payload).toMatchObject({ sessionId: "a", status: "active", at: NOW, project: { id: "alpha", root: "Projects/alpha" } });
  });

  it("waits for a closed session it does not know yet, and gives up after a while", async () => {
    events.tabExited(exited("late", "exit"));
    events.tabExited(exited("never", "crash"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(published).toEqual([]);
    sessions.put(inAlpha("late"));
    await vi.advanceTimersByTimeAsync(0);
    expect(published.map((p) => (p.payload as { sessionId: string; at: string }).sessionId)).toEqual(["late"]);
    expect(published[0]?.payload).toMatchObject({ at: NOW });
    await vi.advanceTimersByTimeAsync(CLOSED_WAIT_MS);
    sessions.put(inAlpha("never"));
    await vi.advanceTimersByTimeAsync(0);
    expect(published).toHaveLength(1);
    expect(lines.join("\n")).toContain("session never ended but is not known with a record");
  });

  it("logs a publish that fails and goes on", async () => {
    await events.stop();
    events = startSessionEvents({
      sessions,
      publish: () => Promise.reject(new Error("Pomade is not connected")),
      realPath: (path) => Promise.resolve(path),
      windowMs: WINDOW,
      now: () => new Date(),
      log: (line) => lines.push(line),
    });
    sessions.put(inAlpha("a"));
    events.tabExited(exited("a", "exit"));
    await vi.advanceTimersByTimeAsync(0);
    expect(lines.join("\n")).toContain(`could not publish ${SESSION_CLOSED_EVENT}: Pomade is not connected`);
  });
});
