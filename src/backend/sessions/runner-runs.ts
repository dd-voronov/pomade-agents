// Runner's agent runs in the session data (DESIGN §2.4, §5, §6; docs/CONTRACTS.md "Subscribed
// events"), from its `run.started` / `run.finished` — the app never calls Runner (PLATFORM rule 4).
//
// - **Run started** — the run is a live entry (`source: "run"`, Working, the job's name, its
//   attached terminal when the payload names it), so `sessions.liveIn` lists it, Live now shows it
//   and its session is live; the session's record gets
//   `startedByRunner: { job }`. A run without a session id (Codex, until Runner finds it) is placed
//   by its start: the earliest session of its agent started exactly in its folder from
//   `PLACE_BEFORE_MS` before its `startedAt` to `PLACE_AFTER_MS` after, not run by another run and
//   not bound to an agent tab — tried again whenever the sessions change, until it is placed or
//   finishes.
// - **Run finished** — the live entry goes, and event B goes out for the run's session: the one
//   the payload names, else the one the app placed, else one placed now. No session: nothing is
//   published (logged).
// - Other kinds of run (script, service, git) are not the app's and are ignored; a payload that
//   claims an agent run without its fields is logged and ignored.
//
// Runs live in memory only: they are gone when the backend stops, and `drop` lets go of every run
// when the connection to Pomade ends — no run finished is heard while it is down.

import { WORKSPACE_PROJECT_ID } from "pomade-kit/protocol";

import { readRunFinished, readRunStarted, runTerminal, type AgentRunStarted } from "../../shared/runner-events.ts";
import type { RealPath } from "../core/real-paths.ts";
import { foundSessions } from "./for-runner.ts";
import type { LiveFacts, LiveState } from "./live-state.ts";
import type { SessionData } from "./session-data.ts";
import type { SessionEvents } from "./session-events.ts";

/** How long before a run's `startedAt` its session may have started (clocks and rounding). */
export const PLACE_BEFORE_MS = 5_000;
/** How long after a run's `startedAt` its session may have started. */
export const PLACE_AFTER_MS = 60_000;

export interface RunnerRunsOptions {
  live: Pick<LiveState, "put" | "entries">;
  sessions: Pick<SessionData, "list" | "onChange" | "markStartedByRunner">;
  events: Pick<SessionEvents, "runFinished">;
  realPath: RealPath;
  log: (line: string) => void;
}

export interface RunnerRuns {
  /** Runner's `run.started`, as it crossed the bus. */
  started(payload: unknown): void;
  /** Runner's `run.finished`, as it crossed the bus. */
  finished(payload: unknown): void;
  /** Let go of every run: no live entries, nothing published. */
  drop(): void;
  stop(): void;
}

interface Run {
  started: AgentRunStarted;
  /** The session it runs; `null` while not known. */
  sessionId: string | null;
}

/** A run's live entry key: its job's id and its run id. */
export const runKey = (job: string, run: string): string => `${job}\0${run}`;

/** The job's id and the run id a run's live entry key names. */
export function runOfKey(key: string): { job: string; run: string } {
  const at = key.lastIndexOf("\0");
  return { job: key.slice(0, at), run: key.slice(at + 1) };
}

const entryOf = ({ started, sessionId }: Run): LiveFacts => ({
  sessionId,
  agent: started.agent,
  cwd: started.cwd,
  projectId: started.project ?? WORKSPACE_PROJECT_ID,
  state: "working",
  job: started.name,
  terminal: runTerminal(started),
});

export function startRunnerRuns({ live, sessions, events, realPath, log }: RunnerRunsOptions): RunnerRuns {
  const runs = new Map<string, Run>();

  /** The session a run without an id started, by its folder, agent and start; `null`: none yet. */
  const placeOf = async (run: AgentRunStarted, taken: ReadonlySet<string>): Promise<string | null> => {
    const at = Date.parse(run.startedAt);
    const found = await foundSessions(
      sessions.list(),
      { cwd: run.cwd, startedFrom: new Date(at - PLACE_BEFORE_MS).toISOString(), startedTo: new Date(at + PLACE_AFTER_MS).toISOString(), agent: run.agent },
      realPath,
    );
    return found.find((s) => !taken.has(s.id))?.id ?? null;
  };

  /** Sessions a run runs or a tab is bound to: never another run's. */
  const takenNow = (): Set<string> => new Set(live.entries().flatMap((e) => (e.sessionId === null ? [] : [e.sessionId])));

  /** Placing is in flight; `true`: asked again meanwhile. */
  let placing: boolean | null = null;
  const placeAll = (): void => {
    if (placing !== null) {
      placing = true;
      return;
    }
    if (![...runs.values()].some((r) => r.sessionId === null)) return;
    placing = false;
    void (async () => {
      for (const [key, run] of runs) {
        if (run.sessionId !== null) continue;
        const id = await placeOf(run.started, takenNow());
        // Placing is one pass at a time; a run started again or finished meanwhile is another object or gone.
        if (id === null || runs.get(key) !== run) continue;
        run.sessionId = id;
        live.put("run", key, entryOf(run));
        sessions.markStartedByRunner(id, run.started.name);
      }
    })()
      .catch((err: unknown) => log(`runner: could not place a run: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => {
        const again = placing === true;
        placing = null;
        if (again) placeAll();
      });
  };

  const unsubscribe = sessions.onChange(() => placeAll());

  const malformed = (event: string, problem: string): void => log(`runner: a ${event} is not an agent run the app can place (${problem}); ignored`);

  return {
    started(payload) {
      const read = readRunStarted(payload);
      if ("other" in read) return;
      if ("problem" in read) {
        malformed("run.started", read.problem);
        return;
      }
      const started = read.agent;
      const key = runKey(started.job, started.run);
      const run: Run = { started, sessionId: started.sessionId };
      runs.set(key, run);
      live.put("run", key, entryOf(run));
      if (run.sessionId !== null) sessions.markStartedByRunner(run.sessionId, started.name);
      else placeAll();
    },

    finished(payload) {
      const read = readRunFinished(payload);
      if ("other" in read) return;
      if ("problem" in read) {
        malformed("run.finished", read.problem);
        return;
      }
      const finished = read.agent;
      const key = runKey(finished.job, finished.run);
      const held = runs.get(key);
      runs.delete(key);
      live.put("run", key, null);
      const close = (sessionId: string | null): void => {
        if (sessionId === null) {
          log(`runner: run ${finished.run} of job ${finished.job} finished with no session known; session.closed not published`);
          return;
        }
        sessions.markStartedByRunner(sessionId, finished.name);
        events.runFinished(sessionId, finished.name);
      };
      const known = finished.sessionId ?? held?.sessionId ?? null;
      if (known !== null) {
        close(known);
        return;
      }
      placeOf(finished, takenNow()).then(close, (err: unknown) => {
        log(`runner: could not place run ${finished.run} of job ${finished.job}: ${err instanceof Error ? err.message : String(err)}`);
        close(null);
      });
    },

    drop() {
      for (const key of runs.keys()) live.put("run", key, null);
      runs.clear();
    },

    stop() {
      unsubscribe();
      runs.clear();
    },
  };
}
