// The Roster tab: the route decides the state. `roster` is the list of agents (`list/`); `roster/new`
// is the New agent page and `roster/<agent>/<tab>` an agent's page.

import { useMemo, type ReactElement } from "react";
import type { HostClient } from "pomade-kit/sdk";

import { NEW_AGENT_ROUTE, agentPageOf, agentRoute, isNewAgentRoute } from "../core/routes.ts";
import { AgentPage } from "./agent-page/AgentPage.tsx";
import type { RosterActions } from "./list/actions.ts";
import { RosterList } from "./list/RosterList.tsx";
import { NewAgentPage } from "./new-agent/NewAgentPage.tsx";

export function RosterTab({ host, route, navigate }: { host: HostClient; route: string; navigate: (route: string) => void }): ReactElement {
  const actions = useMemo<RosterActions>(
    () => ({
      openAgent: (agent) => navigate(agentRoute(agent, "overview")),
      openProjects: (agent) => navigate(agentRoute(agent, "projects")),
      newAgent: () => navigate(NEW_AGENT_ROUTE),
    }),
    [navigate],
  );
  if (isNewAgentRoute(route)) return <NewAgentPage host={host} navigate={navigate} />;
  const page = agentPageOf(route);
  if (page !== null) return <AgentPage host={host} agent={page.agent} tab={page.tab} navigate={navigate} />;
  return <RosterList host={host} actions={actions} />;
}
