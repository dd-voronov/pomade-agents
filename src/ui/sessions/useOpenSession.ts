// Open / Resume (`sessions.open` through Pomade's broker): Pomade switches to the session's agent
// tab, its run's terminal or a new agent tab. The session the backend answers — Active after a
// resume — is taken into the UI's copy at once; the toast says what was done, or why nothing was.

import { useCallback } from "react";
import type { HostClient } from "pomade-kit/sdk";

import { SESSIONS_OPEN_METHOD, isSessionsOpenResult, type Session, type SessionsOpenParams } from "../../shared/sessions.ts";
import { notOpenedText, openedText } from "./open-model.ts";
import type { Toasts } from "./useToast.ts";

/** A resume waits for Pomade to start the agent's tab. */
const ANSWER_TIMEOUT_MS = 10_000;

export function useOpenSession(
  host: HostClient,
  update: (sessions: readonly Session[]) => void,
  names: ReadonlyMap<string, string>,
  { show }: Pick<Toasts, "show">,
): (session: Session) => void {
  return useCallback(
    (session) => {
      const open = async (): Promise<void> => {
        const params: SessionsOpenParams = { id: session.id };
        try {
          const answer = await host.apps.call(host.welcome.appId, SESSIONS_OPEN_METHOD, params, { timeoutMs: ANSWER_TIMEOUT_MS });
          if (!isSessionsOpenResult(answer)) throw new Error("the backend's answer was malformed");
          update([answer.session]);
          show(openedText(session, answer, names), null);
        } catch (err) {
          const failed = notOpenedText(err);
          show(failed.text, null, failed.reason);
        }
      };
      void open();
    },
    [host, update, names, show],
  );
}
