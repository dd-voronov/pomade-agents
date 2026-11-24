import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AgentRunFinished, AgentRunStarted } from "../../shared/runner-events.ts";
import type { Session, SessionsChanged } from "../../shared/sessions.ts";
import { testSession, testSummary } from "../../shared/test-sessions.ts";
import { liveSessions } from "./for-git.ts";
import { createLiveState, type LiveState } from "./live-state.ts";
import { PLACE_AFTER_MS, startRunnerRuns, type RunnerRuns } from "./runner-runs.ts";

const START = "2026-11-21T03:00:00.000Z";
const later = (ms: number): string => new Date(Date.parse(START) + ms).toISOString();

const claudeRun = (patch: Partial<AgentRunStarted> = {}): AgentRunStarted => ({
  job: "nightly-review",
  name: "Nightly review",
  run: "r1",
  kind: "agent",
  folder: "Projects/alpha",
  project: "alpha",
  trigger: "schedule",
  sessionId: "s-claude",
  agent: "claude",
  mode: "auto",
  cwd: "/ws/Projects/alpha",
  startedByRunner: true,
  startedAt: START,
  ...patch,
});
const codexRun = (patch: Partial<AgentRunStarted> = {}): AgentRunStarted => claudeRun({ job: "codex-pass", name: "Codex pass", sessionId: null, agent: "codex", ...patch });
const finished = (run: AgentRunStarted, patch: Partial<AgentRunFinished> = {}): AgentRunFinished => ({ ...run, result: "done", exitCode: 0, ...patch });

const codexSession = (id: string, startedAt: string, cwd = "/ws/link/alpha"): Session =>
  testSession({ id, summary: testSummary({ id, provider: "codex", agent: "codex", cwd, startedAt, lastActiveAt: startedAt }) });

/** Microtasks and the folder lookups behind placing settle. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
};

describe("Runner's runs", () => {
  let live: LiveState;
  let held: Session[];
  let listeners: Set<(changed: SessionsChanged) => void>;
  let marks: [string, string][];
  let ends: [string, string][];
  let lines: string[];
  let runs: RunnerRuns;
  const realPath = (path: string): Promise<string> => Promise.resolve(path.replace("/ws/link/", "/ws/Projects/"));

  const putSessions = (...sessions: Session[]): void => {
    held.push(...sessions);
    for (const listener of listeners) listener({ epoch: "e", revision: held.length });
  };
  const liveIn = (folder: string) => liveSessions(live.entries(), { folder }, realPath);

  beforeEach(() => {
    live = createLiveState(() => new Date(START));
    held = [];
    listeners = new Set();
    marks = [];
    ends = [];
    lines = [];
    runs = startRunnerRuns({
      live,
      sessions: {
        list: () => held,
        onChange(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        markStartedByRunner: (id, job) => marks.push([id, job]),
      },
      events: { runFinished: (id, job) => ends.push([id, job]) },
      realPath,
      log: (line) => lines.push(line),
    });
  });

  afterEach(() => runs.stop());

  it("lists a running agent run in liveIn with its job, marks its session, and makes the session Working", async () => {
    runs.started(claudeRun());
    expect(await liveIn("/ws/Projects")).toEqual({
      live: true,
      sessions: [{ sessionId: "s-claude", agent: "claude", cwd: "/ws/Projects/alpha", source: "run", job: "Nightly review" }],
    });
    expect(await liveIn("/ws/Projects/beta")).toEqual({ live: false, sessions: [] });
    expect(live.ofSession("s-claude").live).toBe("working");
    expect(marks).toEqual([["s-claude", "Nightly review"]]);
  });

  it("drops a finished run from liveIn and ends its session with its job", async () => {
    runs.started(claudeRun());
    runs.finished(finished(claudeRun(), { result: "failed", exitCode: 1 }));
    expect(await liveIn("/ws")).toEqual({ live: false, sessions: [] });
    expect(live.ofSession("s-claude").live).toBe("closed");
    expect(ends).toEqual([["s-claude", "Nightly review"]]);
  });

  it("changes nothing for a script, service or git run, and logs a malformed agent run once per event", async () => {
    for (const kind of ["script", "service", "git"]) {
      const other = { job: "j", name: "J", run: "r", kind, folder: "", project: null, trigger: "manual" };
      runs.started(other);
      runs.finished({ ...other, result: "done", exitCode: 0 });
    }
    expect(lines).toEqual([]);
    const { cwd: _cwd, ...noCwd } = claudeRun();
    runs.started(noCwd);
    runs.finished({ ...finished(claudeRun()), startedAt: "now" });
    expect(live.entries()).toEqual([]);
    expect(await liveIn("/")).toEqual({ live: false, sessions: [] });
    expect([marks, ends]).toEqual([[], []]);
    expect(lines).toEqual([
      "runner: a run.started is not an agent run the app can place (its cwd is missing or not valid); ignored",
      "runner: a run.finished is not an agent run the app can place (its startedAt is missing or not valid); ignored",
    ]);
  });

  it("places a run without a session id by its folder and start once its session appears, skipping one a tab or another run holds", async () => {
    live.put("tab", "t1", { sessionId: "user-own", agent: "codex", cwd: "/ws/Projects/alpha", projectId: "alpha", state: "idle", job: null });
    putSessions(codexSession("too-early", later(-10_000)), codexSession("user-own", later(1000)));
    runs.started(codexRun());
    await settle();
    expect(live.entries().find((e) => e.source === "run")).toMatchObject({ sessionId: null, job: "Codex pass" });
    expect(await liveIn("/ws/Projects/alpha")).toMatchObject({ sessions: [{ sessionId: "user-own" }, { sessionId: null, source: "run", job: "Codex pass" }] });

    putSessions(codexSession("elsewhere", later(2000), "/ws/Projects/beta"), codexSession("too-late", later(PLACE_AFTER_MS + 1)), codexSession("its-own", later(3000)));
    await settle();
    expect(live.entries().find((e) => e.source === "run")?.sessionId).toBe("its-own");
    expect(live.ofSession("its-own").live).toBe("working");
    expect(marks).toEqual([["its-own", "Codex pass"]]);

    // A second run in the same folder takes the next session, never the first run's.
    putSessions(codexSession("second", later(4000)));
    runs.started(codexRun({ run: "r2", startedAt: later(2500) }));
    await settle();
    expect(live.entries().filter((e) => e.source === "run").map((e) => e.sessionId)).toEqual(["its-own", "second"]);

    runs.finished(finished(codexRun()));
    expect(ends).toEqual([["its-own", "Codex pass"]]);
  });

  it("ends the session the run finished names over the one it placed, places one at the end, and publishes nothing with none", async () => {
    putSessions(codexSession("guessed", later(1000)));
    runs.started(codexRun());
    await settle();
    runs.finished(finished(codexRun(), { sessionId: "runner-found" }));
    expect(ends).toEqual([["runner-found", "Codex pass"]]);
    expect(marks).toEqual([
      ["guessed", "Codex pass"],
      ["runner-found", "Codex pass"],
    ]);

    // A run the app never heard start (it started while the connection was down).
    putSessions(codexSession("unheard", later(PLACE_AFTER_MS * 2)));
    runs.finished(finished(codexRun({ run: "r3", startedAt: later(PLACE_AFTER_MS * 2 - 1000) })));
    await settle();
    expect(ends.at(-1)).toEqual(["unheard", "Codex pass"]);

    runs.finished(finished(codexRun({ run: "r4", startedAt: later(PLACE_AFTER_MS * 10) })));
    await settle();
    expect(ends).toHaveLength(2);
    expect(lines).toEqual(["runner: run r4 of job codex-pass finished with no session known; session.closed not published"]);
  });

  it("lets go of every run when told to: nothing live, nothing published", async () => {
    runs.started(claudeRun());
    runs.started(codexRun());
    runs.drop();
    expect(live.entries()).toEqual([]);
    expect(live.ofSession("s-claude").live).toBe("closed");
    putSessions(codexSession("late", later(1000)));
    await settle();
    expect([ends, marks]).toEqual([[], [["s-claude", "Nightly review"]]]);
  });
});
