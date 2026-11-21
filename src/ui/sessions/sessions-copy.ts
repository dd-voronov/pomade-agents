// The UI's copy of the sessions: a whole answer replaces it, a delta answer updates it.

import type { Session, SessionsAnswer, SessionsSince } from "../../shared/sessions.ts";

export interface SessionsCopy {
  since: SessionsSince;
  /** By session id. */
  byId: ReadonlyMap<string, Session>;
  indexing: boolean;
  recordsOff: string | null;
}

export function applyAnswer(copy: SessionsCopy | null, answer: SessionsAnswer): SessionsCopy {
  const next = new Map(answer.full || copy === null ? [] : copy.byId);
  for (const id of answer.removed) next.delete(id);
  for (const session of answer.sessions) next.set(session.id, session);
  return { since: { epoch: answer.epoch, revision: answer.revision }, byId: next, indexing: answer.indexing, recordsOff: answer.recordsOff };
}

/** True when a change notice (or nothing yet) means the copy is behind. */
export function isBehind(copy: SessionsCopy | null, notice: SessionsSince): boolean {
  return copy === null || copy.since.epoch !== notice.epoch || copy.since.revision < notice.revision;
}
