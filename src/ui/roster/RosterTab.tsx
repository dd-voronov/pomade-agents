import type { ReactElement } from "react";
import type { HostClient } from "pomade-kit/sdk";

import { RosterIcon } from "../core/icons.tsx";
import { agentPageOf, isNewAgentRoute } from "../core/routes.ts";
import { StatePage } from "../core/StatePage.tsx";
import { AgentPage } from "./agent-page/AgentPage.tsx";
import { NewAgentPage } from "./new-agent/NewAgentPage.tsx";

export function RosterTab({ host, route, navigate }: { host: HostClient; route: string; navigate: (route: string) => void }): ReactElement {
  if (isNewAgentRoute(route)) return <NewAgentPage host={host} navigate={navigate} />;
  const page = agentPageOf(route);
  if (page !== null) return <AgentPage host={host} agent={page.agent} tab={page.tab} navigate={navigate} />;
  return (
    <StatePage icon={<RosterIcon size={20} />} title="Roster" testId="roster-empty">
      Your agents will be listed here: what each one is for, its model, modes and skills. This view isn't built yet.
    </StatePage>
  );
}
