import { describe, expect, it } from "vitest";

import { RUN_FINISHED_EVENT, RUN_STARTED_EVENT, readRunFinished, readRunStarted, runTerminal, type AgentRunFinished, type AgentRunStarted } from "./runner-events.ts";

const STARTED: AgentRunStarted = {
  job: "nightly-review",
  name: "Nightly review",
  run: "2026-11-21T03:00:00Z",
  kind: "agent",
  folder: "Projects/alpha",
  project: "alpha",
  trigger: "schedule",
  sessionId: "5b0e8f52-3c1d-4a7e-9f21-6d8c0b4a7e13",
  agent: "claude",
  mode: "auto",
  cwd: "/ws/Projects/alpha",
  startedByRunner: true,
  startedAt: "2026-11-21T03:00:01.250Z",
};
const FINISHED: AgentRunFinished = { ...STARTED, result: "done", exitCode: 0 };

describe("Runner's run events", () => {
  it("are Runner's run.started and run.finished", () => {
    expect([RUN_STARTED_EVENT, RUN_FINISHED_EVENT]).toEqual(["pomade-runner:run.started", "pomade-runner:run.finished"]);
  });

  it("read an agent run with its fields, a Codex run with no session id yet, and extra fields", () => {
    expect(readRunStarted(STARTED)).toEqual({ agent: STARTED });
    expect(readRunStarted({ ...STARTED, sessionId: null, project: null, extra: 1 })).toMatchObject({ agent: { sessionId: null } });
    expect(readRunStarted({ ...STARTED, startedAt: "2026-11-21T04:00:01+01:00" })).toHaveProperty("agent");
    expect(readRunFinished(FINISHED)).toEqual({ agent: FINISHED });
    expect(readRunFinished({ ...FINISHED, result: "stopped-by-you", exitCode: null })).toHaveProperty("agent");
  });

  it("name the run's attached terminal when the payload carries a keeper session id, else none", () => {
    expect(runTerminal({ terminal: "run:nightly-review:20261121-030000-a1b2c3" })).toBe("run:nightly-review:20261121-030000-a1b2c3");
    expect(runTerminal({})).toBeNull();
    expect(runTerminal({ terminal: null })).toBeNull();
    expect(runTerminal({ terminal: "" })).toBeNull();
    expect(runTerminal({ terminal: "has space" })).toBeNull();
    expect(readRunStarted({ ...STARTED, terminal: "has space" })).toHaveProperty("agent");
  });

  it("set apart the runs that are not the app's: script, service and git runs", () => {
    for (const kind of ["script", "service", "git"]) {
      expect(readRunStarted({ job: "j", name: "J", run: "r", kind, folder: "", project: null, trigger: "manual" })).toEqual({ other: true });
      expect(readRunFinished({ job: "j", name: "J", run: "r", kind, folder: "", project: null, trigger: "manual", result: "done", exitCode: 0 })).toEqual({ other: true });
    }
  });

  it.each<[string, Record<string, unknown>]>([
    ["job", { job: "" }],
    ["name", { name: 3 }],
    ["run", { run: undefined }],
    ["folder", { folder: null }],
    ["project", { project: "" }],
    ["trigger", { trigger: undefined }],
    ["sessionId", { sessionId: "" }],
    ["agent", { agent: undefined }],
    ["mode", { mode: undefined }],
    ["cwd", { cwd: "Projects/alpha" }],
    ["startedByRunner", { startedByRunner: undefined }],
    ["startedAt", { startedAt: "2026-11-21T03:00:01" }],
    ["startedAt", { startedAt: "yesterday Z" }],
  ])("refuse an agent run whose %s is missing or not valid", (field, patch) => {
    expect(readRunStarted({ ...STARTED, ...patch })).toEqual({ problem: `its ${field} is missing or not valid` });
    expect(readRunFinished({ ...FINISHED, ...patch })).toEqual({ problem: `its ${field} is missing or not valid` });
  });

  it("refuse a run finished without how it ended, and anything that is not a run", () => {
    expect(readRunFinished({ ...FINISHED, result: undefined })).toEqual({ problem: "its result is missing or not valid" });
    expect(readRunFinished({ ...FINISHED, exitCode: 1.5 })).toEqual({ problem: "its exitCode is missing or not valid" });
    expect(readRunFinished(STARTED)).toEqual({ problem: "its result is missing or not valid" });
    for (const value of [null, "run", [], {}, { kind: "" }]) expect(readRunStarted(value)).toEqual({ problem: "it is not a run: no kind" });
  });
});
