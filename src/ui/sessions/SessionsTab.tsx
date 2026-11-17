import { Fragment, type ReactElement } from "react";
import type { HostClient } from "pomade-kit/sdk";
import { SESSION_STATUSES, type SessionStatus } from "pomade-kit/protocol";

import { SessionsIcon } from "../core/icons.tsx";
import { StatePage } from "../core/StatePage.tsx";
import { countByStatus } from "./sessions-copy.ts";
import styles from "./SessionsTab.module.css";
import { useSessions } from "./useSessions.ts";

const STATUS_LABELS: Record<SessionStatus, string> = {
  active: "Active",
  "on-hold": "On hold",
  done: "Done",
  "done-skip": "Done–skip/Failed",
};

function plural(n: number): string {
  return n === 1 ? "1 session" : `${n} sessions`;
}

export function SessionsTab({ host }: { host: HostClient }): ReactElement {
  const copy = useSessions(host);
  const count = copy?.byId.size ?? 0;
  const counts = countByStatus(copy?.byId.values() ?? []);
  return (
    <StatePage icon={<SessionsIcon size={20} />} title="Sessions" testId="sessions-empty">
      <span
        data-testid="sessions-count"
        data-count={copy === null ? undefined : count}
        data-revision={copy?.since.revision}
        data-indexing={copy?.indexing ? "" : undefined}
      >
        {copy === null ? "Reading the agents' session stores…" : `${plural(count)} indexed${copy.indexing ? " so far" : ""}.`}
      </span>{" "}
      {copy !== null && (
        <>
          <span data-testid="sessions-by-status">
            {SESSION_STATUSES.map((status, i) => (
              <Fragment key={status}>
                {i > 0 && " · "}
                <span className={styles.status} data-testid={`sessions-status-${status}`} data-count={counts[status]}>
                  {STATUS_LABELS[status]} {counts[status]}
                </span>
              </Fragment>
            ))}
            .
          </span>{" "}
          {copy.recordsOff !== null && (
            <>
              <span data-testid="sessions-records-off">{copy.recordsOff}</span>{" "}
            </>
          )}
        </>
      )}
      The table of sessions by status isn't built yet.
    </StatePage>
  );
}
