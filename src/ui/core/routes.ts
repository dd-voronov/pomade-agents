// Which view a frame renders. One bundle serves every surface: the panel is Live now, and a tab
// renders the view its route names (HOST-API §3: `welcome.surface` and `welcome.route`).

import type { Surface } from "pomade-kit/sdk";

/** The Sessions tab's route — also the route Pomade's History icon opens (HOST-API §4 `apps`). */
export const SESSIONS_ROUTE = "sessions";
export const ROSTER_ROUTE = "roster";

export type View = "live-now" | "sessions" | "roster";

/** A tab at any route other than the Roster's shows Sessions, the app's default view. */
export function viewFor(surface: Surface, route: string): View {
  if (surface === "panel") return "live-now";
  return route.split("/")[0] === ROSTER_ROUTE ? "roster" : "sessions";
}

/** The Sessions tab's route with `id` selected (`sessions/<id>`), or with nothing selected (`sessions`). */
export function sessionsRoute(id: string | null): string {
  return id === null ? SESSIONS_ROUTE : `${SESSIONS_ROUTE}/${encodeURIComponent(id)}`;
}

/** The session a Sessions route selects; `null` for `sessions`, `""` and any other route. */
export function selectedSessionOf(route: string): string | null {
  const prefix = `${SESSIONS_ROUTE}/`;
  if (!route.startsWith(prefix)) return null;
  const rest = route.slice(prefix.length);
  if (rest === "" || rest.includes("/")) return null;
  try {
    return decodeURIComponent(rest);
  } catch {
    return null;
  }
}
