// Which view a frame renders. One bundle serves every surface: the panel is Live now, and a tab
// renders the view its route names (HOST-API §3: `welcome.surface` and `welcome.route`).

import type { Surface } from "pomade-kit/sdk";

/** The Sessions tab's route — also the route Pomade's History icon opens (HOST-API §4 `apps`). */
export const SESSIONS_ROUTE = "sessions";
export const ROSTER_ROUTE = "roster";

export type View = "live-now" | "sessions" | "roster" | "settings";

/** A tab at any route other than the Roster's shows Sessions, the app's default view. */
export function viewFor(surface: Surface, route: string): View {
  if (surface === "panel") return "live-now";
  if (route.split("/")[0] === SETTINGS_ROUTE) return "settings";
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

/** The app's own Settings page (DESIGN §3.8), opened by the gear of the tab's bar. */
export const SETTINGS_ROUTE = "settings";

/** The New agent page's route (DESIGN §3.6). It wins over `roster/<agent>`: `new` never names an
 *  agent (`agent-name.ts`). */
export const NEW_AGENT_ROUTE = `${ROSTER_ROUTE}/new`;

export function isNewAgentRoute(route: string): boolean {
  return route === NEW_AGENT_ROUTE;
}

/** The tabs of an agent's page, in the order the page shows them. */
export const AGENT_TABS = ["overview", "skills", "projects", "model", "permissions", "memory", "sessions"] as const;
export type AgentTab = (typeof AGENT_TABS)[number];

/** The route of an agent's page on `tab`: `roster/<agent>/<tab>`, the agent's id URI-encoded. */
export function agentRoute(agent: string, tab: AgentTab = "overview"): string {
  return `${ROSTER_ROUTE}/${encodeURIComponent(agent)}/${tab}`;
}

/** The agent and tab an agent-page route names; `null` for the Roster itself and for `roster/new…`, since `new` never names an agent.
 *  A route with no tab, or one this build does not know, opens Overview. */
export function agentPageOf(route: string): { agent: string; tab: AgentTab } | null {
  const [head, id, tab, ...rest] = route.split("/");
  if (head !== ROSTER_ROUTE || id === undefined || id === "" || rest.length > 0) return null;
  if (id === "new") return null;
  let agent: string;
  try {
    agent = decodeURIComponent(id);
  } catch {
    return null;
  }
  return { agent, tab: AGENT_TABS.find((known) => known === tab) ?? "overview" };
}

/** What the Sessions tab opens with: the agent and the project its filters start on. */
export type SessionsPreset = { agent?: string; project?: string };

/** The Sessions route with filters preset: `sessions?agent=<id>&project=<id>`; the plain route for none. */
export function sessionsFilterRoute(preset: SessionsPreset): string {
  const query = new URLSearchParams();
  if (preset.agent !== undefined) query.set("agent", preset.agent);
  if (preset.project !== undefined) query.set("project", preset.project);
  const text = query.toString();
  return text === "" ? SESSIONS_ROUTE : `${SESSIONS_ROUTE}?${text}`;
}

/** The filters a Sessions route presets; `null` for a route that presets none. */
export function sessionsPresetOf(route: string): SessionsPreset | null {
  const prefix = `${SESSIONS_ROUTE}?`;
  if (!route.startsWith(prefix)) return null;
  const query = new URLSearchParams(route.slice(prefix.length));
  const agent = query.get("agent");
  const project = query.get("project");
  if (agent === null && project === null) return null;
  return { ...(agent === null ? {} : { agent }), ...(project === null ? {} : { project }) };
}
