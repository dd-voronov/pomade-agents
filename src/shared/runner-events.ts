// The events the app subscribes to from Runner (ARCHITECTURE §6 "Subscribed", docs/CONTRACTS.md
// "Subscribed events"): `pomade-runner:run.started` and `pomade-runner:run.finished`, live only.
// The app follows only agent runs (`kind: "agent"`) that carry the agent-run fields; `readRunEvent`
// sorts a payload that crossed the bus into one of those, another kind of run (script, service,
// git — not the app's), or a payload the app cannot use.

import { SESSION_ID_PATTERN } from "pomade-kit/protocol";

/** The app that publishes them. */
export const RUNNER_APP_ID = "pomade-runner";

/** A run's session started: payload `AgentRunStarted` for an agent run. */
export const RUN_STARTED_EVENT = `${RUNNER_APP_ID}:run.started`;

/** A run that started ended: payload `AgentRunFinished` for an agent run. */
export const RUN_FINISHED_EVENT = `${RUNNER_APP_ID}:run.finished`;

/** `run.started` of an agent run. */
export type AgentRunStarted = {
  /** The job's id. */
  job: string;
  /** The job's name: what `startedByRunner.job` and `LiveSession.job` hold. */
  name: string;
  /** The run's id, within its job. */
  run: string;
  kind: "agent";
  /** Workspace-relative. */
  folder: string;
  /** The stable project id; `null` for a workspace job. */
  project: string | null;
  trigger: string;
  /** The session's id; `null` while Runner does not know it (Codex). */
  sessionId: string | null;
  /** Roster id. */
  agent: string;
  mode: string;
  /** Where the agent runs: absolute, symlinks resolved. */
  cwd: string;
  startedByRunner: true;
  /** When the run's session started, ISO 8601 with a zone. */
  startedAt: string;
  /** The run's session in Runner's keeper — what its attached terminal shows
   *  (`tabs.openAttached({ session: { app: "pomade-runner", session: terminal } })`). Optional: a
   *  run without it, or with one that is not a keeper session id, has no terminal the app can open. */
  terminal?: string | null;
};

/** `run.finished` of an agent run: `sessionId` is the one Runner found by then, else `null`. */
export type AgentRunFinished = AgentRunStarted & {
  /** `done` · `failed` · `stopped-by-you`. */
  result: string;
  exitCode: number | null;
};

/** What a payload is: an agent run, another kind of run, or not a run the app can use (`problem`). */
export type RunEventRead<T> = { agent: T } | { other: true } | { problem: string };

type Shape = Record<string, unknown>;

const isObject = (v: unknown): v is Shape => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string" && v !== "";
const isTime = (v: unknown): boolean => typeof v === "string" && /(Z|[+-]\d{2}:\d{2})$/.test(v) && !Number.isNaN(Date.parse(v));

/** The first field of an agent run that is missing or not valid; `null` when every one is. */
function badField(v: Shape, finished: boolean): string | null {
  const checks: [string, boolean][] = [
    ["job", isText(v.job)],
    ["name", isText(v.name)],
    ["run", isText(v.run)],
    ["folder", typeof v.folder === "string"],
    ["project", v.project === null || isText(v.project)],
    ["trigger", typeof v.trigger === "string"],
    ["sessionId", v.sessionId === null || isText(v.sessionId)],
    ["agent", isText(v.agent)],
    ["mode", isText(v.mode)],
    ["cwd", typeof v.cwd === "string" && v.cwd.startsWith("/")],
    ["startedByRunner", v.startedByRunner === true],
    ["startedAt", isTime(v.startedAt)],
  ];
  if (finished) checks.push(["result", isText(v.result)], ["exitCode", v.exitCode === null || Number.isInteger(v.exitCode)]);
  return checks.find(([, ok]) => !ok)?.[0] ?? null;
}

function read<T>(value: unknown, finished: boolean): RunEventRead<T> {
  if (!isObject(value) || !isText(value.kind)) return { problem: "it is not a run: no kind" };
  if (value.kind !== "agent") return { other: true };
  const bad = badField(value, finished);
  return bad === null ? { agent: value as T } : { problem: `its ${bad} is missing or not valid` };
}

export function readRunStarted(value: unknown): RunEventRead<AgentRunStarted> {
  return read(value, false);
}

export function readRunFinished(value: unknown): RunEventRead<AgentRunFinished> {
  return read(value, true);
}

/** The keeper session a run's attached terminal shows; `null` when the payload names none usable. */
export function runTerminal(run: Pick<AgentRunStarted, "terminal">): string | null {
  const { terminal } = run;
  return typeof terminal === "string" && SESSION_ID_PATTERN.test(terminal) ? terminal : null;
}
