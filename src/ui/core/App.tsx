// The app shell: one bundle for every surface. What the handshake answered decides what renders —
// the "no Pomade host" state, a refusal, or the view the frame was opened for.

import type { ReactElement } from "react";
import type { ConnectResult, HostClient } from "pomade-kit/sdk";

import { RosterTab } from "../roster/RosterTab.tsx";
import { SettingsPage } from "../settings/SettingsPage.tsx";
import { LiveNowPanel } from "../sessions/LiveNowPanel.tsx";
import { SessionsTab } from "../sessions/SessionsTab.tsx";
import { viewFor } from "./routes.ts";
import { TabView } from "./TabView.tsx";
import { NoHost, Rejected } from "./Unavailable.tsx";
import { useRoute } from "./useRoute.ts";

function Hosted({ host }: { host: HostClient }): ReactElement {
  const { route, navigate } = useRoute(host);
  const view = viewFor(host.welcome.surface, route);
  if (view === "live-now") return <LiveNowPanel host={host} />;
  return (
    <TabView view={view} navigate={navigate}>
      {view === "settings" ? <SettingsPage host={host} /> : view === "roster" ? <RosterTab /> : <SessionsTab host={host} route={route} navigate={navigate} />}
    </TabView>
  );
}

export function App({ connection }: { connection: ConnectResult }): ReactElement {
  switch (connection.status) {
    case "no-host":
      return <NoHost />;
    case "rejected":
      return <Rejected reason={connection.reason} />;
    case "connected":
      return <Hosted host={connection.host} />;
  }
}
