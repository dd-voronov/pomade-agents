// The Sessions tab's selected session, kept in the tab's route (`sessions/<id>`), so a reload, a
// restart of Pomade and a link to the route all open it again. Selecting changes the view at once
// and asks Pomade to navigate the tab there (`tabs.openApp` in the tab's own project); the
// `route.changed` that answers each request is the tab catching up and is not applied again, so
// quick ↑ ↓ presses never step back. Any other route Pomade navigates the tab to selects what it names.

import { useCallback, useEffect, useRef, useState } from "react";
import type { HostClient } from "pomade-kit/sdk";

import { selectedSessionOf, sessionsRoute } from "../core/routes.ts";

export function useSelection(host: HostClient, route: string): [string | null, (id: string | null) => void] {
  const [selected, setSelected] = useState<string | null>(() => selectedSessionOf(route));
  /** Routes asked for and not yet heard back, oldest first. */
  const requested = useRef<string[]>([]);
  const shown = useRef(route);

  useEffect(() => {
    if (route === shown.current) return;
    shown.current = route;
    const at = requested.current.indexOf(route);
    if (at >= 0) {
      requested.current.splice(0, at + 1);
      return;
    }
    requested.current = [];
    setSelected(selectedSessionOf(route));
  }, [route]);

  const select = useCallback(
    (id: string | null) => {
      setSelected(id);
      const next = sessionsRoute(id);
      const last = requested.current.at(-1) ?? shown.current;
      if (next === last) return;
      requested.current.push(next);
      host.tabs.openApp({ route: next, projectId: host.welcome.project.id }).catch((err: unknown) => {
        requested.current = requested.current.filter((r) => r !== next);
        console.error(`Agents: could not keep the selection in the tab's route "${next}"`, err);
      });
    },
    [host],
  );

  return [selected, select];
}
