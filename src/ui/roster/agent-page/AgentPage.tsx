// An agent's page (route `roster/<agent>/<tab>`, DESIGN §3.4): the header, the tab bar and the
// tab's body. The tab is the route, so a reload and a restart of Pomade open it again; ← Roster
// returns to the Roster. The roster comes from the backend's `roster.agents`; a page for an agent
// it does not hold says so.

import { useMemo, type ReactElement } from "react";
import type { HostClient } from "pomade-kit/sdk";

import { RosterIcon, UnpluggedIcon } from "../../core/icons.tsx";
import { StatePage } from "../../core/StatePage.tsx";
import { AGENT_TABS, agentRoute, type AgentTab } from "../../core/routes.ts";
import { useNow } from "../../core/useNow.ts";
import { useBackendInfo } from "../../core/useBackendInfo.ts";
import { useProjects } from "../../core/useProjects.ts";
import { Toast } from "../../sessions/Toast.tsx";
import { useToast, type Toast as ToastData } from "../../sessions/useToast.ts";
import { rosterWindows } from "../agent-counts-model.ts";
import { useAgentCounts } from "../useAgentCounts.ts";
import { useRoster } from "../useRoster.ts";
import { useProfileEdit } from "../profile-edit/useProfileEdit.ts";
import { useAgentCommands, type AgentCommands } from "../commands/useAgentCommands.ts";
import type { AgentContext } from "./agent-context.ts";
import { AgentHeader } from "./AgentHeader.tsx";
import type { WorkspaceRoots } from "./agent-model.ts";
import { useOpenFile } from "./open-file.ts";
import styles from "./page.module.css";
import { AGENT_TAB_VIEWS } from "./tabs.tsx";

const NO_PROJECTS = new Map();
/** Relative times ("5m") are renewed this often. */
const CLOCK_MS = 30_000;

export interface AgentPageProps {
  host: HostClient;
  agent: string;
  tab: AgentTab;
  /** The project the route filters the Sessions tab to; `null` for none. */
  project: string | null;
  navigate: (route: string) => void;
}

export function AgentPage({ host, agent, tab, project, navigate }: AgentPageProps): ReactElement {
  const { answer, connections, patchProfile } = useRoster(host);
  const backend = useBackendInfo(host);
  const projectList = useProjects(host);
  const projects = projectList ?? NO_PROJECTS;
  const now = useNow(CLOCK_MS);
  const counts = useAgentCounts(host, rosterWindows(now));
  const toasts = useToast();
  const { show } = toasts;
  const profileEdit = useProfileEdit(host, show, patchProfile);
  const info = backend.status === "running" ? backend.info : null;
  const roots = useMemo<WorkspaceRoots>(() => ({ workspace: info?.workspace ?? null, workspaceReal: info?.workspaceReal ?? null }), [info?.workspace, info?.workspaceReal]);
  const openFile = useOpenFile(host, roots, show);
  const commands = useAgentCommands(host, show, roots, patchProfile);
  const entry = answer?.agents.find((a) => a.id === agent);

  const context: AgentContext | null =
    answer === null || entry === undefined
      ? null
      : { host, entry, revision: answer.revision, profilesOff: answer.profilesOff, roots, dataDir: info?.dataDir ?? null, projects, projectsRead: projectList !== null, counts, now, show, openFile, profileEdit, sessionsProject: project, navigate };

  if (answer === null) {
    const down = backend.status === "down";
    return (
      <div className={styles.page} data-testid="agent-page" data-state="loading">
        <StatePage icon={down ? <UnpluggedIcon size={20} /> : <RosterIcon size={20} />} title={down ? "Background: not answering" : "Reading the roster"} tone={down ? "warning" : "neutral"} testId="agent-loading">
          {down ? "The app’s background part does not answer. The page opens when it does." : "Asking the app’s background part for its agents."}
        </StatePage>
      </div>
    );
  }
  if (context === null) {
    return (
      <div className={styles.page} data-testid="agent-page" data-state="missing">
        <StatePage icon={<RosterIcon size={20} />} title="No such agent" tone="warning" action={{ label: "Back to the Roster", run: () => navigate("roster"), testId: "agent-missing-back" }} testId="agent-missing">
          The roster has no agent called “{agent}”. It may have been renamed or removed.
        </StatePage>
      </div>
    );
  }

  return <LoadedPage context={context} tab={tab} toast={toasts.toast} commands={commands} connected={connections?.get(agent) ?? NO_CONNECTIONS} />;
}

const NO_CONNECTIONS: readonly string[] = [];

function LoadedPage({ context, tab, toast, commands, connected }: { context: AgentContext; tab: AgentTab; toast: ToastData | null; commands: AgentCommands; connected: readonly string[] }): ReactElement {
  const { entry, navigate } = context;
  const agent = entry.id;
  const { View } = AGENT_TAB_VIEWS[tab];
  return (
    <div className={styles.page} data-testid="agent-page" data-agent={agent} data-tab={tab}>
      <AgentHeader context={context} commands={commands} connected={connected}>
        <nav className={styles.tabs} role="tablist" aria-label={agent}>
          {AGENT_TABS.map((id) => (
            <button key={id} type="button" role="tab" className={styles.tab} aria-selected={id === tab} data-testid={`agent-tab-${id}`} onClick={() => id !== tab && navigate(agentRoute(agent, id))}>
              {AGENT_TAB_VIEWS[id].label}
            </button>
          ))}
        </nav>
      </AgentHeader>
      <div className={styles.body} data-testid="agent-body">
        <div className={styles.content}>
          <View context={context} />
        </div>
      </div>
      {toast !== null && <Toast toast={toast} />}
    </div>
  );
}
