import { describe, expect, it } from "vitest";
import type { SessionStatus } from "pomade-kit/protocol";

import type { Session } from "./sessions.ts";
import { testSession, testSummary } from "./test-sessions.ts";
import { agentCounts, isAgentCountsAnswer, isWorkSession, type AgentCountsParams } from "./work-sessions.ts";

const WINDOWS: AgentCountsParams = { weekFrom: "2026-11-23T00:00:00.000Z", projectsFrom: "2026-08-26T00:00:00.000Z" };

const session = (
  id: string,
  opts: { agent?: string; status?: SessionStatus | null; projects?: string[]; at?: string | null; started?: string | null; cost?: number | null } = {},
): Session => {
  const agent = opts.agent ?? "claude";
  return testSession({
    id,
    summary: testSummary({ id, agent, lastActiveAt: opts.at === undefined ? "2026-11-24T10:00:00.000Z" : opts.at, startedAt: opts.started ?? null, costUsd: opts.cost ?? null }),
    record: opts.status === null ? null : { id, provider: "claude-code", agent, status: opts.status ?? "active" },
    attribution: { projects: opts.projects ?? [], by: "folder", sharedFolder: (opts.projects ?? []).length > 1 },
  });
};

describe("the work-session rule", () => {
  it("counts every status but Done–skip/Failed, and a session without a record yet", () => {
    expect(isWorkSession(session("a", { status: "active" }))).toBe(true);
    expect(isWorkSession(session("h", { status: "on-hold" }))).toBe(true);
    expect(isWorkSession(session("d", { status: "done" }))).toBe(true);
    expect(isWorkSession(session("s", { status: "done-skip" }))).toBe(false);
    expect(isWorkSession(session("n", { status: null }))).toBe(true);
  });

  it("counts a hidden (empty) session", () => {
    const empty: Session = { ...session("e"), hidden: "empty" };
    expect(isWorkSession(empty)).toBe(true);
  });
});

describe("agent counts", () => {
  it("per agent: last active, this week's work sessions and ~$; per project: the window's count and the last session", () => {
    const counts = agentCounts(
      [
        session("a1", { projects: ["alpha"], at: "2026-11-24T10:00:00.000Z", cost: 1.5 }),
        session("a2", { projects: ["alpha"], at: "2026-11-20T10:00:00.000Z", cost: 2 }),
        session("b1", { projects: ["beta"], at: "2026-11-23T09:00:00.000Z", cost: null }),
        session("old", { projects: ["gamma"], at: "2026-05-01T10:00:00.000Z", cost: 9 }),
        session("w", { projects: [], at: "2026-11-23T00:00:00.000Z", cost: 0.5 }),
        session("x", { agent: "claude-coder", projects: ["beta"], at: "2026-10-01T10:00:00.000Z", cost: 3 }),
      ],
      WINDOWS,
    );
    expect(counts).toEqual([
      {
        agent: "claude",
        lastActiveAt: "2026-11-24T10:00:00.000Z",
        week: { sessions: 3, costUsd: 2 },
        projects: [
          { project: "alpha", sessions: 2, lastAt: "2026-11-24T10:00:00.000Z" },
          { project: "beta", sessions: 1, lastAt: "2026-11-23T09:00:00.000Z" },
          { project: "__workspace__", sessions: 1, lastAt: "2026-11-23T00:00:00.000Z" },
          { project: "gamma", sessions: 0, lastAt: "2026-05-01T10:00:00.000Z" },
        ],
      },
      {
        agent: "claude-coder",
        lastActiveAt: "2026-10-01T10:00:00.000Z",
        week: { sessions: 0, costUsd: null },
        projects: [{ project: "beta", sessions: 1, lastAt: "2026-10-01T10:00:00.000Z" }],
      },
    ]);
  });

  it("a Skip/Failed session leaves every count and sum, and comes back with another status", () => {
    const kept = session("a1", { projects: ["alpha"], cost: 1 });
    const skipped = agentCounts([kept, session("a2", { projects: ["alpha"], cost: 2, status: "done-skip" })], WINDOWS);
    expect(skipped[0]?.week).toEqual({ sessions: 1, costUsd: 1 });
    expect(skipped[0]?.projects).toEqual([{ project: "alpha", sessions: 1, lastAt: "2026-11-24T10:00:00.000Z" }]);
    expect(agentCounts([session("s", { status: "done-skip", cost: 5 })], WINDOWS)).toEqual([]);
    const back = agentCounts([kept, session("a2", { projects: ["alpha"], cost: 2, status: "done" })], WINDOWS);
    expect(back[0]?.week).toEqual({ sessions: 2, costUsd: 3 });
    expect(back[0]?.projects[0]?.sessions).toBe(2);
  });

  it("a session moved to another project counts there, and no longer where it was", () => {
    const before = agentCounts([session("a1", { projects: ["alpha"] }), session("m", { projects: ["alpha"] })], WINDOWS);
    expect(before[0]?.projects.map((p) => [p.project, p.sessions])).toEqual([["alpha", 2]]);
    const after = agentCounts([session("a1", { projects: ["alpha"] }), session("m", { projects: ["beta"] })], WINDOWS);
    expect(after[0]?.projects.map((p) => [p.project, p.sessions])).toEqual([
      ["alpha", 1],
      ["beta", 1],
    ]);
  });

  it("a shared-folder session counts in each of its projects; the agent's week counts it once", () => {
    const [claude] = agentCounts([session("s", { projects: ["alpha", "twin"], cost: 1 })], WINDOWS);
    expect(claude?.week).toEqual({ sessions: 1, costUsd: 1 });
    expect(claude?.projects.map((p) => p.project).sort()).toEqual(["alpha", "twin"]);
  });

  it("times: the last activity, else the start; a session with neither counts in no window and leaves times null", () => {
    const [started] = agentCounts([session("s", { at: null, started: "2026-11-23T08:00:00.000Z" })], WINDOWS);
    expect(started?.lastActiveAt).toBe("2026-11-23T08:00:00.000Z");
    expect(started?.week.sessions).toBe(1);
    const [timeless] = agentCounts([session("t", { at: null, started: null })], WINDOWS);
    expect(timeless).toEqual({ agent: "claude", lastActiveAt: null, week: { sessions: 0, costUsd: null }, projects: [{ project: "__workspace__", sessions: 0, lastAt: null }] });
  });

  it("the windows include their start", () => {
    const [claude] = agentCounts([session("edge", { at: WINDOWS.weekFrom, projects: ["alpha"] })], { weekFrom: WINDOWS.weekFrom, projectsFrom: WINDOWS.weekFrom });
    expect(claude?.week.sessions).toBe(1);
    expect(claude?.projects[0]?.sessions).toBe(1);
  });

  it("checks an answer", () => {
    const agents = agentCounts([session("a", { projects: ["alpha"], cost: 1 })], WINDOWS);
    expect(isAgentCountsAnswer({ epoch: "e", revision: 3, indexing: false, agents })).toBe(true);
    expect(isAgentCountsAnswer({ epoch: "e", revision: 3, indexing: false, agents: [] })).toBe(true);
    expect(isAgentCountsAnswer({ epoch: "e", revision: -1, indexing: false, agents })).toBe(false);
    expect(isAgentCountsAnswer({ epoch: "e", revision: 3, indexing: false, agents: [{ ...agents[0], week: { sessions: 1 } }] })).toBe(false);
    expect(isAgentCountsAnswer({ epoch: "e", revision: 3, indexing: false, agents: [{ ...agents[0], projects: [{ project: "", sessions: 1, lastAt: null }] }] })).toBe(false);
  });
});
