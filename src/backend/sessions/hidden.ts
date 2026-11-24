// Why the Sessions tab hides a session (DESIGN §2.7), decided from its summary — the one place the
// rules live. A session that holds no message of the user's and no answer from the agent — a file
// a `/clear` wrote and nothing after it — is `empty`. The first message or answer makes it shown.

import type { HiddenReason, SessionSummary } from "../../shared/sessions.ts";

/** Why the Sessions tab hides the session; `null`: it shows. */
export function hiddenReason(summary: SessionSummary): HiddenReason | null {
  if (summary.firstMessage === null && summary.lastMessage === null && summary.lastAnswer === null) return "empty";
  return null;
}
