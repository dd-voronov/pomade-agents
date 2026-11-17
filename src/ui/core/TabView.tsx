// The app's wide tab: a bar that switches between Sessions and the Roster, and the view below it.
// Pomade keeps one tab per app in a project (HOST-API §4 `tabs.openApp`), so both views live in
// it; switching asks Pomade to navigate the tab, which then remembers the route.

import type { ReactElement, ReactNode } from "react";
import type { HostClient } from "pomade-kit/sdk";

import { RosterIcon, SessionsIcon } from "./icons.tsx";
import { openTab } from "./openTab.ts";
import { ROSTER_ROUTE, SESSIONS_ROUTE, type View } from "./routes.ts";
import styles from "./TabView.module.css";

type TabViewName = Exclude<View, "live-now">;

const VIEWS: readonly { view: TabViewName; route: string; label: string; icon: ReactElement }[] = [
  { view: "sessions", route: SESSIONS_ROUTE, label: "Sessions", icon: <SessionsIcon /> },
  { view: "roster", route: ROSTER_ROUTE, label: "Roster", icon: <RosterIcon /> },
];

export function TabView({ host, view, children }: { host: HostClient; view: TabViewName; children: ReactNode }): ReactElement {
  return (
    <div className={styles.tab}>
      <nav className={styles.bar} aria-label="Agents views">
        <div className={styles.switch}>
          {VIEWS.map((v) => (
            <button
              key={v.view}
              type="button"
              className={styles.item}
              aria-current={v.view === view ? "page" : undefined}
              data-testid={`view-${v.view}`}
              onClick={() => openTab(host, v.route)}
            >
              {v.icon}
              {v.label}
            </button>
          ))}
        </div>
      </nav>
      <main className={styles.view}>{children}</main>
    </div>
  );
}
