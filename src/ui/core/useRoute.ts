import { useCallback, useEffect, useState } from "react";
import type { HostClient } from "pomade-kit/sdk";

export interface FrameRoute {
  /** The frame's current route: the one it was opened at, then every route Pomade navigates it to
   *  and every route the app navigates to by itself. */
  route: string;
  /** The app navigates its own tab: the view moves at once and Pomade records the route for the tab
   *  (`tabs.setRoute`), so a reload and a restart open it there. Pomade sends no `route.changed` back. */
  navigate: (route: string) => void;
}

export function useRoute(host: HostClient): FrameRoute {
  const [route, setRoute] = useState(host.welcome.route);
  useEffect(() => host.onRouteChange(setRoute), [host]);
  const navigate = useCallback(
    (next: string) => {
      setRoute(next);
      host.tabs.setRoute(next).catch((err: unknown) => {
        console.error(`Agents: could not record the tab's route "${next}"`, err);
      });
    },
    [host],
  );
  return { route, navigate };
}
