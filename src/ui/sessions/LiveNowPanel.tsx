// The Live now panel — what the Agents strip icon fills Pomade's side panel with. Its two buttons
// open or focus the app's wide tab at Sessions and at the Roster.

import type { ReactElement } from "react";
import type { HostClient } from "pomade-kit/sdk";

import { BackendStatus } from "../core/BackendStatus.tsx";
import { LiveIcon, RosterIcon, SessionsIcon } from "../core/icons.tsx";
import { openTab } from "../core/openTab.ts";
import { ROSTER_ROUTE, SESSIONS_ROUTE } from "../core/routes.ts";
import { StatePage } from "../core/StatePage.tsx";
import styles from "./LiveNowPanel.module.css";

export function LiveNowPanel({ host }: { host: HostClient }): ReactElement {
  return (
    <div className={styles.panel} data-testid="live-now-panel">
      <nav className={styles.actions} aria-label="Agents tabs">
        <button type="button" className={styles.action} data-testid="open-sessions" onClick={() => openTab(host, SESSIONS_ROUTE)}>
          <SessionsIcon />
          Sessions
        </button>
        <button type="button" className={styles.action} data-testid="open-roster" onClick={() => openTab(host, ROSTER_ROUTE)}>
          <RosterIcon />
          Roster
        </button>
      </nav>
      <StatePage icon={<LiveIcon />} title="Live now" size="compact" testId="live-now-empty">
        Running agent sessions will be listed here, grouped by project. This panel isn't built yet.
      </StatePage>
      <BackendStatus host={host} />
    </div>
  );
}
