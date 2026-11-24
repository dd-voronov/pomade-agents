import type { AgentTabInfo } from "pomade-kit/protocol";
import { describe, expect, it } from "vitest";

import type { RosterChanged, RosterEntry } from "../../shared/roster.ts";
import type { SessionsChanged, Session } from "../../shared/sessions.ts";
import { testSession, testSummary } from "../../shared/test-sessions.ts";
import { keepBadge, startLiveNow } from "./live-now.ts";
import { createLiveState, followTabs } from "./live-state.ts";

const T0 = "2026-11-24T10:00:00.000Z";

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

const entry = (id: string, name: string): RosterEntry => ({ id, name, profile: null, problem: null, orphan: false, configDir: null, model: null, effort: null });

function setup() {
  const live = createLiveState(() => new Date(T0));
  const tabs = followTabs(live);
  const sessions = new Map<string, Session>();
  const sessionListeners = new Set<(changed: SessionsChanged) => void>();
  let agents = [entry("claude", "Claude Code"), entry("claude-pm", "PM")];
  const rosterListeners = new Set<(changed: RosterChanged) => void>();
  const liveNow = startLiveNow({
    live,
    sessions: {
      get: (id) => sessions.get(id),
      onChange(listener) {
        sessionListeners.add(listener);
        return () => sessionListeners.delete(listener);
      },
    },
    roster: {
      answer: () => ({ epoch: "r", revision: 1, agents, profilesOff: null }),
      onChange(listener) {
        rosterListeners.add(listener);
        return () => rosterListeners.delete(listener);
      },
    },
  });
  const revisions: number[] = [];
  liveNow.onChange(({ revision }) => revisions.push(revision));
  return {
    live,
    tabs,
    liveNow,
    revisions,
    putSession(session: Session) {
      sessions.set(session.id, session);
      for (const listener of sessionListeners) listener({ epoch: "s", revision: 1 });
    },
    setAgents(next: RosterEntry[]) {
      agents = next;
      for (const listener of rosterListeners) listener({ epoch: "r", revision: 2 });
    },
  };
}

describe("Live now", () => {
  it("answers one row per live agent tab: its project, session, state since when, and what the panel shows of the session", () => {
    const { tabs, liveNow, putSession } = setup();
    putSession(testSession({ id: "s1", record: { id: "s1", provider: "claude-code", agent: "claude", status: "active", name: "G4 tickets" } }));
    putSession(testSession({ id: "s2", summary: testSummary({ id: "s2", firstMessage: { text: "  why does the\n panel flicker ", at: null } }), record: null }));
    tabs.list([
      tab({ tabId: "t1", sessionId: "s1", state: "needs-you" }),
      tab({ tabId: "t2", sessionId: "s2", projectId: "beta", agentId: "claude-pm", state: "working" }),
      tab({ tabId: "t3", projectId: "__workspace__" }),
      tab({ tabId: "t4", sessionId: "s1", state: "exited" }),
    ]);
    expect(liveNow.answer().rows).toEqual([
      { kind: "tab", tabId: "t1", project: "alpha", sessionId: "s1", agent: "claude", agentName: "Claude Code", state: "needs-you", since: T0, name: "G4 tickets", firstMessage: null },
      { kind: "tab", tabId: "t2", project: "beta", sessionId: "s2", agent: "claude-pm", agentName: "PM", state: "working", since: T0, name: null, firstMessage: "why does the panel flicker" },
      { kind: "tab", tabId: "t3", project: "__workspace__", sessionId: null, agent: "claude", agentName: "Claude Code", state: "idle", since: T0, name: null, firstMessage: null },
    ]);
    expect(liveNow.needsYou()).toBe(1);
  });

  it("answers a row per Runner agent run while it runs: its job, run, project, agent, attached terminal — never Needs you", () => {
    const { live, liveNow, revisions } = setup();
    live.put("run", "nightly/review\0r1", { sessionId: "s9", agent: "claude-pm", cwd: "/w", projectId: "alpha", state: "working", job: "Nightly review", terminal: "run:nightly.review:r1" });
    live.put("run", "j\0r2", { sessionId: null, agent: "codex", cwd: "/w", projectId: "__workspace__", state: "working", job: "Triage", terminal: null });
    expect(liveNow.answer().rows).toEqual([
      { kind: "run", job: "j", run: "r2", name: "Triage", project: "__workspace__", sessionId: null, agent: "codex", agentName: "codex", state: "working", since: T0, terminal: null },
      { kind: "run", job: "nightly/review", run: "r1", name: "Nightly review", project: "alpha", sessionId: "s9", agent: "claude-pm", agentName: "PM", state: "working", since: T0, terminal: "run:nightly.review:r1" },
    ]);
    expect(liveNow.needsYou()).toBe(0);
    const before = revisions.length;
    live.put("run", "j\0r2", null);
    expect(liveNow.answer().rows.map((row) => row.kind === "run" && row.run)).toEqual(["r1"]);
    expect(revisions.length).toBe(before + 1);
  });

  it("is a new revision whenever the answer changes — a tab, a session's name, the roster — and only then", () => {
    const { tabs, liveNow, revisions, putSession, setAgents } = setup();
    const first = liveNow.answer().revision;
    tabs.list([tab({ tabId: "t1", sessionId: "s1" })]);
    putSession(testSession({ id: "s1", record: { id: "s1", provider: "claude-code", agent: "claude", status: "active", name: "Named" } }));
    expect(liveNow.answer().rows[0]?.name).toBe("Named");
    putSession(testSession({ id: "s1", record: { id: "s1", provider: "claude-code", agent: "claude", status: "done", name: "Named" } }));
    putSession(testSession({ id: "other" }));
    tabs.changed(tab({ tabId: "t1", sessionId: "s1", title: "Renamed" }), false);
    setAgents([entry("claude", "Claude")]);
    expect(liveNow.answer().rows[0]?.agentName).toBe("Claude");
    expect(revisions).toEqual([first + 1, first + 2, first + 3]);
    expect(liveNow.answer().revision).toBe(first + 3);
  });

  it("keeps the badge at the Needs you rows while connected: set on a change, cleared at none, set again when Pomade is ready", async () => {
    const { tabs, liveNow } = setup();
    const set: number[] = [];
    const badge = keepBadge(liveNow, () => undefined);
    tabs.list([tab({ tabId: "t1", state: "needs-you" })]);
    expect(set).toEqual([]);

    badge.connected((count) => {
      set.push(count);
      return Promise.resolve();
    });
    expect(set).toEqual([1]);
    tabs.list([tab({ tabId: "t1", state: "needs-you" }), tab({ tabId: "t2", state: "needs-you" })]);
    tabs.changed(tab({ tabId: "t2", state: "working" }), false);
    tabs.changed(tab({ tabId: "t2", state: "idle" }), false);
    badge.ready();
    tabs.changed(tab({ tabId: "t1", state: "working" }), false);
    badge.ready();
    expect(set).toEqual([1, 2, 1, 1, 0]);

    badge.disconnected();
    tabs.changed(tab({ tabId: "t1", state: "needs-you" }), false);
    expect(set).toEqual([1, 2, 1, 1, 0]);
    // A new connection: Pomade shows none of the app's badges.
    badge.connected((count) => {
      set.push(count);
      return Promise.reject(new Error("gone"));
    });
    expect(set).toEqual([1, 2, 1, 1, 0, 1]);
    await Promise.resolve();
  });
});
