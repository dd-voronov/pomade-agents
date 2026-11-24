import { WORKSPACE_PROJECT_ID } from "pomade-kit/protocol";
import { describe, expect, it } from "vitest";

import { testSession, testSummary } from "../../../shared/test-sessions.ts";
import type { Session } from "../../../shared/sessions.ts";
import { SESSIONS_SHOWN, agentSessions } from "./agent-sessions-model.ts";

const session = (id: string, agent: string, projects: string[], at: string, over: Partial<Session> = {}): Session =>
  testSession({ id, summary: testSummary({ id, agent, lastActiveAt: at }), attribution: { projects, by: "folder", sharedFolder: false }, ...over });

const NAMES = new Map([
  ["p1", "Pomade"],
  ["p2", "Agents"],
]);

describe("agentSessions", () => {
  const all = [
    session("a", "claude-libra", ["p1"], "2026-11-20T10:00:00.000Z"),
    session("b", "claude-libra", ["p2"], "2026-11-22T10:00:00.000Z"),
    session("c", "claude-libra", [], "2026-11-21T10:00:00.000Z"),
    session("d", "claude-coder", ["p1"], "2026-11-23T10:00:00.000Z"),
    session("e", "claude-libra", ["p1"], "2026-11-24T10:00:00.000Z", { hidden: "empty" }),
  ];

  it("lists the agent's sessions of every project, newest first, hidden ones left out", () => {
    const { rows, total } = agentSessions(all, "claude-libra", null, NAMES);
    expect(rows.map((s) => s.id)).toEqual(["b", "c", "a"]);
    expect(total).toBe(3);
  });

  it("lists one project's sessions, the Workspace's for the Workspace bucket", () => {
    expect(agentSessions(all, "claude-libra", "p1", NAMES).rows.map((s) => s.id)).toEqual(["a"]);
    expect(agentSessions(all, "claude-libra", WORKSPACE_PROJECT_ID, NAMES).rows.map((s) => s.id)).toEqual(["c"]);
    expect(agentSessions(all, "claude-libra", "p2", NAMES).total).toBe(1);
  });

  it("offers the projects the agent has sessions in, with counts that ignore the chosen project", () => {
    const { projects } = agentSessions(all, "claude-libra", "p1", NAMES);
    expect(projects.all).toBe(3);
    expect(projects.options.map((o) => [o.key, o.label, o.count])).toEqual([
      ["p1", "Pomade", 1],
      ["p2", "Agents", 1],
      [WORKSPACE_PROJECT_ID, "Workspace (no project)", 1],
    ]);
  });

  it("cuts the rows to the latest, and counts them all", () => {
    const many = Array.from({ length: SESSIONS_SHOWN + 5 }, (_, i) => session(`s${i}`, "x", ["p1"], new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString()));
    const { rows, total } = agentSessions(many, "x", null, NAMES);
    expect(rows).toHaveLength(SESSIONS_SHOWN);
    expect(total).toBe(SESSIONS_SHOWN + 5);
    expect(rows[0]?.id).toBe(`s${SESSIONS_SHOWN + 4}`);
  });
});
