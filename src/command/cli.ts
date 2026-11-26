// The `pomade-agents` command (ARCHITECTURE §7, CONTRACTS "Command"): what it prints and how it exits for
// the arguments it is given. It reads no file itself — every answer comes from the app's backend
// through Pomade's broker, so the command, the UI and other apps see one truth. Sub-commands are a
// table (`SUB_COMMANDS`); each parses its own options and fails with a `Failure`, which becomes one
// line on stderr and its exit status.

import type { JsonValue } from "pomade-kit/protocol";

import { SESSIONS_GET_METHOD, SESSIONS_OF_TAB_METHOD, isSessionsGetResult, isSessionsOfTabResult, type Session } from "../shared/sessions.ts";
import { sessionText } from "./session-text.ts";

export const COMMAND = "pomade-agents";

/** Where the session records are, under the workspace (ARCHITECTURE §4). */
export const RECORDS_FOLDER = "Apps/pomade-agents/sessions";

/** Exit statuses, one per way the command can fail; scripts branch on them. */
export const EXIT = {
  ok: 0,
  /** Anything else: Pomade refused the command, the command was not started by Pomade's shim, an
   *  answer that makes no sense. */
  failed: 1,
  usage: 2,
  pomadeClosed: 3,
  backendDown: 4,
  /** No `--session`, and not in a Pomade terminal (no `POMADE_TAB_ID`). */
  noTab: 5,
  /** The tab runs no agent session: a plain terminal, or an agent not prompted yet. */
  noSessionInTab: 6,
  unknownSession: 7,
} as const;

/** How long the backend has to answer one call. */
export const CALL_TIMEOUT_MS = 5000;

/** A call to the app's API failed: the broker's or the backend's error code and its words. */
export interface CallFailure {
  code: string;
  message: string;
}

/** The connection to Pomade, or why there is none. */
export type Link =
  | {
      status: "connected";
      /** Calls a method of the app's own API through the broker; rejects with a `CallFailure`. */
      call(method: string, params: JsonValue): Promise<unknown>;
      /** Project id → name, as Pomade names them now; empty when Pomade does not say. */
      projectNames(): Promise<ReadonlyMap<string, string>>;
      close(): void;
    }
  | { status: "not-running" }
  /** Pomade refused the hello: the key, or a version mismatch. */
  | { status: "refused"; reason: string }
  /** The command has no app identity to connect with: it was not started through Pomade's shim. */
  | { status: "no-identity"; reason: string };

export interface CommandDeps {
  out(text: string): void;
  err(text: string): void;
  /** The tab the command runs in (`POMADE_TAB_ID`); `null` outside Pomade's terminals. */
  tabId: string | null;
  /** The workspace root, with Pomade open or closed; `null` when none is recorded. */
  workspace(): string | null;
  connect(): Promise<Link>;
}

class Failure extends Error {
  readonly exit: number;

  constructor(exit: number, message: string) {
    super(message);
    this.exit = exit;
  }
}

const usageFailure = (problem: string, help: string): Failure => new Failure(EXIT.usage, `${problem}. Run "${COMMAND} ${help}--help" for usage.`);

export const SHOW_USAGE = `Usage: ${COMMAND} show [--session <id>] [--json]

Print a session: its name, status and note, live state, agent, project, start folder, times,
messages, tokens and ~$ cost, transcript.

  --session <id>  the session with this id (the provider's session id); without it, the
                  session of the agent tab this terminal runs in
  --json          the session as one JSON document, the shape the app's sessions.get answers
  --help          print this help

Exit status: 0 printed · 1 failed · 2 usage · 3 Pomade not running · 4 the app's backend not
answering · 5 not in a Pomade terminal and no --session · 6 the tab has no session ·
7 no such session.
`;

export const USAGE = `Usage: ${COMMAND} <command> [options]

Agent sessions as the Agents app keeps them, for agents and scripts.

Commands:
  show [--session <id>] [--json]   print a session — by default, the one of the agent tab
                                   this terminal runs in

Run "${COMMAND} <command> --help" for a command's options. The session records themselves are
files in <workspace>/${RECORDS_FOLDER}/; the pomade-agents-sessions skill describes them.
`;

interface ShowOptions {
  session: string | null;
  json: boolean;
  help: boolean;
}

export function parseShow(args: readonly string[]): ShowOptions {
  const options: ShowOptions = { session: null, json: false, help: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--session" || arg.startsWith("--session=")) {
      if (options.session !== null) throw usageFailure("--session is given twice", "show ");
      const value = arg === "--session" ? args[++i] : arg.slice("--session=".length);
      if (value === undefined || value === "" || value.startsWith("-")) throw usageFailure("--session needs a session id", "show ");
      options.session = value;
    } else if (arg.startsWith("-")) throw usageFailure(`unknown option ${arg}`, "show ");
    else throw usageFailure(`show takes no argument (got "${arg}")`, "show ");
  }
  return options;
}

type Connected = Extract<Link, { status: "connected" }>;

async function connected(deps: CommandDeps): Promise<Connected> {
  const link = await deps.connect();
  switch (link.status) {
    case "connected":
      return link;
    case "not-running": {
      const workspace = deps.workspace();
      const folder = workspace === null ? `<workspace>/${RECORDS_FOLDER}/` : `${workspace}/${RECORDS_FOLDER}/`;
      throw new Failure(EXIT.pomadeClosed, `Pomade is not running — open Pomade and run it again. The session records are files in ${folder} (the pomade-agents-sessions skill describes them).`);
    }
    case "refused":
      throw new Failure(EXIT.failed, `Pomade refused the command (${link.reason}) — install the Agents app again, or update Pomade.`);
    case "no-identity":
      throw new Failure(EXIT.failed, `not started through Pomade's command folder (${link.reason}) — run it in a Pomade terminal, or with Pomade's commands on PATH.`);
  }
}

const isCallFailure = (err: unknown): err is CallFailure =>
  typeof err === "object" && err !== null && typeof (err as CallFailure).code === "string" && typeof (err as CallFailure).message === "string";

/** A call's failure as the command says it: the broker's two "no backend" codes, else the backend's own words. */
function callFailure(err: unknown): Failure {
  if (!isCallFailure(err)) return new Failure(EXIT.failed, `the call failed: ${err instanceof Error ? err.message : String(err)}`);
  if (err.code === "app-absent" || err.code === "app-not-responding") {
    return new Failure(EXIT.backendDown, `the Agents app's background part is not answering (${err.code}: ${err.message}) — it runs while Pomade runs; Pomade restarts it, so try again in a moment.`);
  }
  return new Failure(EXIT.failed, `the Agents app refused the call (${err.code}: ${err.message}).`);
}

/** Calls the app's API; a failure becomes the command's — `notFound` words a `not-found` refusal. */
async function call(link: Connected, method: string, params: JsonValue, notFound?: () => Failure): Promise<unknown> {
  try {
    return await link.call(method, params);
  } catch (err) {
    if (notFound !== undefined && isCallFailure(err) && err.code === "not-found") throw notFound();
    throw callFailure(err);
  }
}

const unexpected = (method: string): Failure => new Failure(EXIT.failed, `the Agents app answered ${method} with something this command does not read — the app and the command are out of step; install the app again.`);

/** Which session a command acts on: the one `--session` names, or the one bound to the calling terminal's tab. */
type Target = { id: string } | { tabId: string };

function targetOf(session: string | null, tabId: string | null): Target {
  if (session !== null) return { id: session };
  if (tabId === null) throw new Failure(EXIT.noTab, "not in a Pomade terminal (POMADE_TAB_ID is not set) — name the session with --session <id>.");
  return { tabId };
}

async function sessionOf(link: Connected, target: Target): Promise<Session> {
  if ("id" in target) {
    const answer = await call(link, SESSIONS_GET_METHOD, { id: target.id }, () => new Failure(EXIT.unknownSession, `no session ${JSON.stringify(target.id)} — the app knows no transcript with this id.`));
    if (!isSessionsGetResult(answer)) throw unexpected(SESSIONS_GET_METHOD);
    return answer.session;
  }
  const answer = await call(link, SESSIONS_OF_TAB_METHOD, { tabId: target.tabId });
  if (!isSessionsOfTabResult(answer)) throw unexpected(SESSIONS_OF_TAB_METHOD);
  if (!answer.agentTab) throw new Failure(EXIT.noSessionInTab, "this terminal's tab runs no agent — it is not an agent tab. Run it in an agent's tab, or name the session with --session <id>.");
  if (answer.session === null) throw new Failure(EXIT.noSessionInTab, "the agent in this tab has no session yet — it starts one with its first prompt. Or name a session with --session <id>.");
  return answer.session;
}

async function show(args: readonly string[], deps: CommandDeps): Promise<number> {
  const options = parseShow(args);
  if (options.help) {
    deps.out(SHOW_USAGE);
    return EXIT.ok;
  }
  // Settled before connecting: a terminal outside Pomade fails the same with Pomade open or closed.
  const target = targetOf(options.session, deps.tabId);
  const link = await connected(deps);
  try {
    const session = await sessionOf(link, target);
    if (options.json) deps.out(`${JSON.stringify(session, null, 2)}\n`);
    else deps.out(sessionText(session, await link.projectNames()));
    return EXIT.ok;
  } finally {
    link.close();
  }
}

/** Each sub-command: its arguments after the name → its exit status. */
const SUB_COMMANDS: Readonly<Record<string, (args: readonly string[], deps: CommandDeps) => Promise<number>>> = { show };

export async function runCli(argv: readonly string[], deps: CommandDeps): Promise<number> {
  const [name, ...args] = argv;
  try {
    if (name === "--help" || name === "-h" || name === "help") {
      deps.out(USAGE);
      return EXIT.ok;
    }
    if (name === undefined) throw usageFailure("no command given", "");
    const sub = Object.hasOwn(SUB_COMMANDS, name) ? SUB_COMMANDS[name] : undefined;
    if (sub === undefined) throw usageFailure(name.startsWith("-") ? `unknown option ${name}` : `unknown command "${name}"`, "");
    return await sub(args, deps);
  } catch (err) {
    if (!(err instanceof Failure)) throw err;
    deps.err(`${COMMAND}: ${err.message}\n`);
    return err.exit;
  }
}
