// The Sessions tab's selected session is the tab's route (`sessions/<id>`), so a reload, a restart
// of Pomade and a link to the route all open it again. Selecting navigates the tab by itself
// (`useRoute`'s `navigate`, `tabs.setRoute`): the view changes at once and nothing comes back, so
// quick ↑ ↓ presses never step back. A route Pomade navigates the tab to selects what it names.

import { useCallback } from "react";

import { selectedSessionOf, sessionsRoute } from "../core/routes.ts";

export function useSelection(route: string, navigate: (route: string) => void): [string | null, (id: string | null) => void] {
  const selected = selectedSessionOf(route);
  const select = useCallback(
    (id: string | null) => {
      const next = sessionsRoute(id);
      if (next !== route) navigate(next);
    },
    [route, navigate],
  );
  return [selected, select];
}
