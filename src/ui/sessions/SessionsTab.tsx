// The Sessions tab: the header (the scope, its session count and ~$ sum), then the table of the
// scope's sessions — or a state page while the stores are read, or when the scope has none. The
// scope is the project the tab was opened in (`welcome.project`); a tab keeps it.

import type { ReactElement } from "react";
import { WORKSPACE_PROJECT_ID } from "pomade-kit/protocol";
import type { HostClient } from "pomade-kit/sdk";

import { SessionsIcon } from "../core/icons.tsx";
import { StatePage } from "../core/StatePage.tsx";
import { useNow } from "../core/useNow.ts";
import { useProjectNames } from "../core/useProjectNames.ts";
import { SessionsTable } from "./SessionsTable.tsx";
import { formatHeaderSum, groupByStatus, totalCost } from "./table-model.ts";
import styles from "./SessionsTab.module.css";
import { useSessions } from "./useSessions.ts";

/** Relative times ("5m") are renewed this often. */
const CLOCK_MS = 30_000;

const NO_NAMES: ReadonlyMap<string, string> = new Map();

export function SessionsTab({ host }: { host: HostClient }): ReactElement {
  const copy = useSessions(host);
  const names = useProjectNames(host) ?? NO_NAMES;
  const now = useNow(CLOCK_MS);
  const scope = host.welcome.project;
  const workspace = scope.id === WORKSPACE_PROJECT_ID;
  const scopeName = workspace ? "Workspace · all projects" : (names.get(scope.id) ?? scope.name);

  const groups = groupByStatus(copy?.byId.values() ?? [], scope.id);
  const count = groups.active.length + groups["on-hold"].length + groups.done.length + groups["done-skip"].length;

  let body: ReactElement;
  if (copy === null) {
    body = (
      <StatePage icon={<SessionsIcon size={20} />} title="Reading the session stores…" testId="sessions-reading">
        The agents' sessions show here once their stores are read.
      </StatePage>
    );
  } else if (count === 0) {
    body = (
      <StatePage icon={<SessionsIcon size={20} />} title={`No sessions in ${workspace ? "the Workspace" : scopeName} yet`} testId="sessions-empty">
        {copy.indexing
          ? "The agents' session stores are still being read."
          : "Start an agent from the + menu. Its session shows up here within a couple of seconds, as Active."}
      </StatePage>
    );
  } else {
    body = <SessionsTable groups={groups} workspace={workspace} names={names} byId={copy.byId} now={now} />;
  }

  return (
    <div className={styles.tab}>
      <header className={styles.head}>
        <h1 className={styles.title}>Sessions</h1>
        <span className={styles.scope} data-testid="sessions-scope">
          {scopeName}
        </span>
        {copy !== null && (
          <span
            className={styles.sum}
            title="Done–skip/Failed is left out of the total"
            data-testid="sessions-count"
            data-count={count}
            data-revision={copy.since.revision}
            data-indexing={copy.indexing ? "" : undefined}
          >
            {copy.indexing && <span className={styles.indexing}>Indexing… </span>}
            {formatHeaderSum(count, totalCost(groups))}
          </span>
        )}
      </header>
      {copy?.recordsOff != null && (
        <p className={styles.recordsOff} data-testid="sessions-records-off">
          {copy.recordsOff}
        </p>
      )}
      {body}
    </div>
  );
}
