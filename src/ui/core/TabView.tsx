// The app's wide tab: a bar that switches between Sessions and the Roster, and the view below it.
// Pomade keeps one tab per app in a project (HOST-API §4 `tabs.openApp`), so both views live in
// it; switching is the tab navigating by itself (`navigate`, `tabs.setRoute`): the view changes at
// once and Pomade remembers the route.

import type { ReactElement, ReactNode } from "react";

import { GearIcon, RosterIcon, SessionsIcon } from "./icons.tsx";
import { ROSTER_ROUTE, SESSIONS_ROUTE, SETTINGS_ROUTE, type View } from "./routes.ts";
import styles from "./TabView.module.css";

type TabViewName = Exclude<View, "live-now">;

const VIEWS: readonly { view: TabViewName; route: string; label: string; icon: ReactElement }[] = [
  { view: "sessions", route: SESSIONS_ROUTE, label: "Sessions", icon: <SessionsIcon /> },
  { view: "roster", route: ROSTER_ROUTE, label: "Roster", icon: <RosterIcon /> },
];

export function TabView({ view, navigate, children }: { view: TabViewName; navigate: (route: string) => void; children: ReactNode }): ReactElement {
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
              onClick={() => navigate(v.route)}
            >
              {v.icon}
              {v.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={styles.gear}
          aria-label="Settings"
          title="Settings — skill folders"
          aria-current={view === "settings" ? "page" : undefined}
          data-testid="view-settings"
          onClick={() => navigate(SETTINGS_ROUTE)}
        >
          <GearIcon />
        </button>
      </nav>
      <main className={styles.view}>{children}</main>
    </div>
  );
}
