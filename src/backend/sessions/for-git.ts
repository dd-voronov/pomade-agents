// The two answers git asks this app (DESIGN §5 "The sessions contract", `pomade-kit/protocol`
// agent-sessions): which sessions worked in a repository or worktree (`sessions.forRepo`) and what
// runs in a folder now (`sessions.liveIn`). Every folder is compared absolute with symlinks
// resolved, the caller's and the recorded ones alike.
//
// `forRepo` lists only sessions it can answer in full: a start folder, both activity times and a
// usable record — the status is the user's, so a session without its record has none to give.

import type { LiveSession, RepoSession, SessionsForRepoParams, SessionsLiveInParams, SessionsLiveInResult } from "pomade-kit/protocol";

import type { Session } from "../../shared/sessions.ts";
import type { RealPath } from "../core/real-paths.ts";
import { isInside } from "./attribution.ts";
import type { LiveEntry } from "./live-state.ts";

/** The sessions whose start folder is `folder` or inside it and, with `branch`, on that branch; newest activity first. */
export async function repoSessions(sessions: readonly Session[], { folder, branch }: SessionsForRepoParams, real: RealPath): Promise<RepoSession[]> {
  const root = await real(folder);
  const answerable = sessions.filter((s) => s.summary.cwd !== null && (branch === undefined || s.summary.branch === branch));
  const out = await Promise.all(
    answerable.map(async (s): Promise<RepoSession | null> => {
      const { cwd, startedAt, lastActiveAt } = s.summary;
      if (cwd === null || startedAt === null || lastActiveAt === null || s.record === null) return null;
      const at = await real(cwd);
      if (!isInside(root, at)) return null;
      return {
        id: s.id,
        agent: s.summary.agent,
        name: s.record.name ?? null,
        status: s.record.status,
        live: s.live,
        cwd: at,
        branch: s.summary.branch,
        project: s.attribution.projects[0] ?? null,
        startedAt,
        lastActiveAt,
      };
    }),
  );
  return out.filter((s) => s !== null).sort((a, b) => Date.parse(b.lastActiveAt) - Date.parse(a.lastActiveAt));
}

/** What runs at or below `folder` now: one `LiveSession` per live entry whose folder is known. */
export async function liveSessions(entries: readonly LiveEntry[], { folder }: SessionsLiveInParams, real: RealPath): Promise<SessionsLiveInResult> {
  const root = await real(folder);
  const out = await Promise.all(
    entries.map(async (e): Promise<LiveSession | null> => {
      if (e.cwd === null) return null;
      const at = await real(e.cwd);
      return isInside(root, at) ? { sessionId: e.sessionId, agent: e.agent, cwd: at, source: e.source, job: e.job } : null;
    }),
  );
  const sessions = out.filter((s) => s !== null);
  return { live: sessions.length > 0, sessions };
}
