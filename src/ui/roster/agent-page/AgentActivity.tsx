// The agent's activity facts of the Overview, from the work-session counts (`sessions.agentCounts`,
// ARCHITECTURE §2.9): when it was last active, and this week's work sessions and their ~$. "—" shows until
// the counts have been answered; an agent with no work session was never active and has no week.

import type { ReactElement } from "react";

import { formatAgo, formatMoney, formatStamp } from "../../sessions/table-model.ts";
import { noCounts } from "../agent-counts-model.ts";
import type { AgentContext } from "./agent-context.ts";
import styles from "./page.module.css";

const WEEK_TITLE = "Work sessions this week, and their cost";

export function LastActive({ context }: { context: AgentContext }): ReactElement {
  const { counts, now, entry } = context;
  if (counts === null) {
    return (
      <span className={styles.dash} data-testid="agent-last-active">
        —
      </span>
    );
  }
  const { lastActiveAt } = counts.byAgent.get(entry.id) ?? noCounts(entry.id);
  if (lastActiveAt === null) {
    return (
      <span className={styles.dash} data-testid="agent-last-active">
        never
      </span>
    );
  }
  return (
    <span title={formatStamp(lastActiveAt, now)} data-testid="agent-last-active">
      {formatAgo(lastActiveAt, now)}
    </span>
  );
}

export function ThisWeek({ context }: { context: AgentContext }): ReactElement {
  const { counts, entry } = context;
  if (counts === null) {
    return (
      <span className={styles.dash} data-testid="agent-this-week">
        —
      </span>
    );
  }
  const { week } = counts.byAgent.get(entry.id) ?? noCounts(entry.id);
  if (week.sessions === 0) {
    return (
      <span className={styles.dash} data-testid="agent-this-week">
        no sessions
      </span>
    );
  }
  const sessions = `${week.sessions} ${week.sessions === 1 ? "session" : "sessions"}`;
  return (
    <span title={WEEK_TITLE} data-testid="agent-this-week">
      {week.costUsd === null ? sessions : `${sessions} · ${formatMoney(week.costUsd)}`}
    </span>
  );
}
