// The UI's copy of the session summaries: a whole answer replaces it, a delta answer updates it.

import type { SessionSummary, SessionsAnswer, SessionsSince } from "../../shared/sessions.ts";

export interface SummariesCopy {
  since: SessionsSince;
  /** By transcript path. */
  byTranscript: ReadonlyMap<string, SessionSummary>;
  indexing: boolean;
}

export function applyAnswer(copy: SummariesCopy | null, answer: SessionsAnswer): SummariesCopy {
  const next = new Map(answer.full || copy === null ? [] : copy.byTranscript);
  for (const path of answer.removed) next.delete(path);
  for (const summary of answer.summaries) next.set(summary.transcript, summary);
  return { since: { epoch: answer.epoch, revision: answer.revision }, byTranscript: next, indexing: answer.indexing };
}

/** True when a change notice (or nothing yet) means the copy is behind. */
export function isBehind(copy: SummariesCopy | null, notice: SessionsSince): boolean {
  return copy === null || copy.since.epoch !== notice.epoch || copy.since.revision < notice.revision;
}
