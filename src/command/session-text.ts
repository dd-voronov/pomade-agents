// `pomade-agents show` without `--json`: a session as a few plain lines for a person — no colour,
// times in UTC, messages cut to one line. Scripts read `--json` instead; this text may change.

import type { SessionLiveState, SessionStatus } from "pomade-kit/protocol";

import { contextPercent, type Session, type TimedText } from "../shared/sessions.ts";

export const STATUS_WORDS: Record<SessionStatus, string> = {
  active: "Active",
  "on-hold": "On hold",
  done: "Done",
  "done-skip": "Done–skip/Failed",
};

export const LIVE_WORDS: Record<SessionLiveState, string> = {
  working: "Working",
  "needs-you": "Needs you",
  idle: "Idle",
  closed: "Closed",
};

/** A message is cut to this many characters on its one line. */
export const MESSAGE_SHOWN = 100;

const LABEL_WIDTH = 14;
const COUNT = new Intl.NumberFormat("en-US");
const MONEY = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** `2026-11-17 10:05 UTC`; the ISO text as it is when it does not parse. */
export function utcStamp(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return iso;
  return `${new Date(time).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** A message on one line: whitespace runs as one space, cut with "…" past `MESSAGE_SHOWN`. */
export function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MESSAGE_SHOWN ? `${flat.slice(0, MESSAGE_SHOWN - 1)}…` : flat;
}

function message(value: TimedText | null): string | null {
  if (value === null) return null;
  return `"${oneLine(value.text)}"${value.at === null ? "" : ` (${utcStamp(value.at)})`}`;
}

function statusLine(session: Session): string {
  const { record } = session;
  if (record === null) return session.recordProblem === null ? "— no record yet" : `— its record cannot be read: ${session.recordProblem}`;
  return record.note === undefined ? STATUS_WORDS[record.status] : `${STATUS_WORDS[record.status]} — ${record.note}`;
}

function liveLine(session: Session): string {
  return session.liveSince === null ? LIVE_WORDS[session.live] : `${LIVE_WORDS[session.live]} since ${utcStamp(session.liveSince)}`;
}

function projectLine(session: Session, projectNames: ReadonlyMap<string, string>): string {
  const { projects, sharedFolder } = session.attribution;
  if (projects.length === 0) return "Workspace";
  const named = projects.map((id) => {
    const name = projectNames.get(id);
    return name === undefined ? id : `${name} (${id})`;
  });
  return `${named.join(", ")}${sharedFolder ? " — shared folder" : ""}`;
}

function agentLine(session: Session): string {
  const { agent, provider, model, effort } = session.summary;
  const runs = [model, effort].filter((part) => part !== null).join(" ");
  return [agent, provider, runs].filter((part) => part !== "").join(" · ");
}

function tokensLine(session: Session): string {
  const { input, output, cacheRead, cacheWrite } = session.summary.tokens;
  return `${COUNT.format(input)} in · ${COUNT.format(output)} out · ${COUNT.format(cacheRead)} cache read · ${COUNT.format(cacheWrite)} cache write`;
}

/** The session as lines of `label  value`, its name first. `projectNames`: project id → name, as
 *  Pomade names them now; a project missing from it shows by id. */
export function sessionText(session: Session, projectNames: ReadonlyMap<string, string>): string {
  const { summary, record } = session;
  const rows: [string, string | null][] = [
    ["status", statusLine(session)],
    ["live", liveLine(session)],
    ["agent", agentLine(session)],
    ["project", projectLine(session, projectNames)],
    ["folder", summary.cwd],
    ["branch", summary.branch],
    ["started", summary.startedAt === null ? null : utcStamp(summary.startedAt)],
    ["last active", summary.lastActiveAt === null ? null : utcStamp(summary.lastActiveAt)],
    ["first message", message(summary.firstMessage)],
    ["last message", message(summary.lastMessage)],
    ["last answer", message(summary.lastAnswer)],
    ["tokens", tokensLine(session)],
    ["cost", summary.costUsd === null ? "— a model it ran is not in the price table" : `~$${MONEY.format(summary.costUsd)} est.`],
    ["context", summary.context === null ? null : `${contextPercent(summary.context)}% of ${COUNT.format(summary.context.window)}`],
    ["runner job", record?.startedByRunner?.job ?? null],
    ["transcript", summary.transcript],
    ["id", session.id],
  ];
  const name = record?.name ?? "Unnamed session";
  const lines = rows.flatMap(([label, value]) => (value === null ? [] : [`${label.padEnd(LABEL_WIDTH)}${value}`]));
  return `${name}\n${lines.join("\n")}\n`;
}
