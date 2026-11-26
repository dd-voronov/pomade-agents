// `sessions.find` (ARCHITECTURE §5): the sessions started in one folder within a time window — how
// Runner finds the session a launch produced when it could not set its id (Codex). The folder is
// compared exactly, both absolute with symlinks resolved; times as instants, both ends included.

import type { FoundSession, Session, SessionsFindParams } from "../../shared/sessions.ts";
import type { RealPath } from "../core/real-paths.ts";

/** The sessions started in `cwd` between `startedFrom` and `startedTo`, by `agent` when given; earliest start first. */
export async function foundSessions(sessions: readonly Session[], { cwd, startedFrom, startedTo, agent }: SessionsFindParams, real: RealPath): Promise<FoundSession[]> {
  const folder = await real(cwd);
  const from = Date.parse(startedFrom);
  const to = Date.parse(startedTo);
  const out = await Promise.all(
    sessions.map(async ({ id, summary }): Promise<{ found: FoundSession; at: number } | null> => {
      if (summary.cwd === null || summary.startedAt === null || summary.lastActiveAt === null) return null;
      if (agent !== undefined && summary.agent !== agent) return null;
      const at = Date.parse(summary.startedAt);
      if (!(at >= from && at <= to)) return null;
      const started = await real(summary.cwd);
      if (started !== folder) return null;
      return { found: { id, provider: summary.provider, agent: summary.agent, cwd: started, startedAt: summary.startedAt, lastActiveAt: summary.lastActiveAt }, at };
    }),
  );
  return out
    .filter((s) => s !== null)
    .sort((a, b) => a.at - b.at || (a.found.id < b.found.id ? -1 : 1))
    .map((s) => s.found);
}
