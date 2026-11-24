// Open / Resume as the Sessions tab shows it (DESIGN §2.1, §2.7), as pure functions: what the
// action does for a session and its label, the hint under the panel's button, and what the toast
// says once `sessions.open` answered or refused.

import { WORKSPACE_PROJECT_ID } from "pomade-kit/protocol";
import { HostError } from "pomade-kit/sdk";

import type { Session, SessionsOpenResult } from "../../shared/sessions.ts";
import { toastName } from "./check-model.ts";
import { failureText, type FailureText } from "./detail-model.ts";
import { statusOf } from "./table-model.ts";

/** What Open / Resume does: focus the session's agent tab, open its Runner run's terminal, or resume it in a new agent tab. */
export type OpenKind = SessionsOpenResult["opened"];

/** What Open / Resume would do for `session` now. A session live with no agent tab runs as a Runner run. */
export function openKind(session: Session): OpenKind {
  if (session.tab !== null) return "tab";
  return session.live === "closed" ? "resumed" : "run";
}

export const OPEN_LABELS: Record<OpenKind, string> = {
  tab: "Open tab",
  run: "Open run terminal",
  resumed: "Resume",
};

export const OPEN_TOOLTIPS: Record<OpenKind, string> = {
  tab: "Switch to the agent tab this session runs in (Enter)",
  run: "Open the terminal of the Runner run this session runs in (Enter)",
  resumed: "Resume the session in a new agent tab in its project (Enter)",
};

/** The hint under the panel's button: a resume sets a status other than Active back to Active; a
 *  session with no messages has nothing to resume. */
export function openHint(session: Session): string | null {
  if (openKind(session) !== "resumed") return null;
  if (session.hidden === "empty") return "It holds no messages, so there is nothing to resume.";
  return statusOf(session) !== "active" ? "Resume sets the status back to Active." : null;
}

/** What the toast says once `sessions.open` did `result` for `before` (the session as it was). */
export function openedText(before: Session, result: SessionsOpenResult, names: ReadonlyMap<string, string>): string {
  const name = toastName(result.session);
  switch (result.opened) {
    case "tab":
      return `Focused the open tab “${name}”`;
    case "run":
      return `Opened the terminal of the run “${result.session.record?.startedByRunner?.job ?? name}”`;
    case "resumed": {
      const project = result.session.attribution.projects[0] ?? WORKSPACE_PROJECT_ID;
      const where = project === WORKSPACE_PROJECT_ID ? "the Workspace" : (names.get(project) ?? project);
      const activated = statusOf(before) !== "active" && statusOf(result.session) === "active";
      return `Resumed in a new agent tab in ${where}${activated ? " · status set to Active" : ""}`;
    }
  }
}

/** What the toast says when `sessions.open` was refused: the backend's plain words for a refusal of
 *  the session — what follows " — " (Pomade's own words) only on hover — or plain words for a
 *  backend that did not answer. */
export function notOpenedText(error: unknown): FailureText {
  const own = error instanceof HostError && error.code !== "app-absent" && error.code !== "app-not-responding" ? error.message.trim() : "";
  if (own === "") return failureText("open", error);
  const plain = own.split(" — ")[0] ?? own;
  return { text: `The session was not opened. ${/[.!?]$/.test(plain) ? plain : `${plain}.`}`, reason: own };
}
