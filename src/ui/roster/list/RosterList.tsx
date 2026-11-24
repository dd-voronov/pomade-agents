// The Roster tab's list state (DESIGN §3.3): every agent as a card or a row — the built-ins first,
// then by id, hidden ones in a collapsible section at the end — over what the roster, the
// connections, the projects and the agents' counts say. A state page shows until all four have
// answered. The cards' and rows' actions (`commands/`) say what they did in the tab's toast.

import { useMemo, useState, type ReactElement } from "react";
import type { HostClient } from "pomade-kit/sdk";

import { ChevronIcon, RosterIcon, WarningIcon } from "../../core/icons.tsx";
import { StatePage } from "../../core/StatePage.tsx";
import { useBackendInfo } from "../../core/useBackendInfo.ts";
import { useNow } from "../../core/useNow.ts";
import { useProjects } from "../../core/useProjects.ts";
import { Toast } from "../../sessions/Toast.tsx";
import { useToast } from "../../sessions/useToast.ts";
import { rosterWindows, weekTotal } from "../agent-counts-model.ts";
import { useAgentCommands } from "../commands/useAgentCommands.ts";
import { useProfileEdit } from "../profile-edit/useProfileEdit.ts";
import { useAgentCounts } from "../useAgentCounts.ts";
import { useRoster } from "../useRoster.ts";
import type { RosterActions } from "./actions.ts";
import { AgentCard, type RosterTools } from "./AgentCard.tsx";
import { AgentList } from "./AgentList.tsx";
import { agentViews, sections, type AgentView, type RosterView } from "./roster-model.ts";
import { PlusIcon } from "./list-icons.tsx";
import { RosterHeader } from "./RosterHeader.tsx";
import { useRosterView } from "./useRosterView.ts";
import controls from "./controls.module.css";
import styles from "./RosterList.module.css";

/** Relative times ("5m") are renewed this often. */
const CLOCK_MS = 30_000;

const NO_PROJECTS = new Map();

function Agents({ section, agents, view, tools, now }: { section: "shown" | "hidden"; agents: readonly AgentView[]; view: RosterView; tools: RosterTools; now: Date }): ReactElement {
  if (view === "list") return <AgentList section={section} agents={agents} tools={tools} now={now} />;
  return (
    <div className={styles.cards} data-testid={`roster-cards-${section}`}>
      {agents.map((agent) => (
        <AgentCard key={agent.id} agent={agent} tools={tools} now={now} />
      ))}
    </div>
  );
}

function FirstAgent({ onNewAgent }: { onNewAgent: () => void }): ReactElement {
  return (
    <div className={styles.first} data-testid="roster-first-agent">
      <div className={styles.firstGlyph}>
        <RosterIcon size={16} />
      </div>
      <b>No folder agents yet</b>
      <p>A folder agent is a Claude Code with its own CLAUDE.md, skills and settings in Agents/&lt;name&gt;/ — a specialist you launch by name.</p>
      <button type="button" className={controls.primary} onClick={onNewAgent}>
        <PlusIcon />
        New agent
      </button>
    </div>
  );
}

export function RosterList({ host, actions }: { host: HostClient; actions: RosterActions }): ReactElement {
  const { answer, connections, patchProfile } = useRoster(host);
  const projects = useProjects(host);
  const now = useNow(CLOCK_MS);
  const counts = useAgentCounts(host, rosterWindows(now));
  const [view, setView] = useRosterView();
  const [hiddenOpen, setHiddenOpen] = useState(true);
  const { toast, show } = useToast();
  const backend = useBackendInfo(host);
  const info = backend.status === "running" ? backend.info : null;
  const roots = useMemo(() => ({ workspace: info?.workspace ?? null, workspaceReal: info?.workspaceReal ?? null }), [info?.workspace, info?.workspaceReal]);
  const commands = useAgentCommands(host, show, roots, patchProfile);
  const edit = useProfileEdit(host, show, patchProfile);
  const profilesOff = answer?.profilesOff ?? null;
  const dataDir = info?.dataDir ?? null;
  const tools = useMemo<RosterTools>(
    () => ({ actions, commands, edit, scope: { projects: projects ?? NO_PROJECTS, profilesOff, dataDir } }),
    [actions, commands, edit, projects, profilesOff, dataDir],
  );

  const names = useMemo(() => new Map([...(projects ?? [])].map(([id, p]) => [id, p.name])), [projects]);
  const agents = useMemo(
    () => (answer === null || connections === null || counts === null ? null : agentViews(answer, counts.byAgent, connections, names, counts)),
    [answer, connections, counts, names],
  );

  if (answer === null || projects === null || counts === null || agents === null) {
    return (
      <StatePage icon={<RosterIcon size={20} />} title="Reading the roster…" testId="roster-reading">
        The agents show here once the app's background part has read them.
      </StatePage>
    );
  }

  const { shown, hidden } = sections(agents);
  const noWorkspace = answer.profilesOff !== null;
  const week = weekTotal(agents.filter((a) => !a.orphan));
  const onlyBuiltins = !noWorkspace && agents.every((a) => a.builtin);
  const first = onlyBuiltins ? <FirstAgent onNewAgent={actions.newAgent} /> : null;

  return (
    <div className={styles.roster} data-testid="roster" data-view={view}>
      <RosterHeader agents={agents.length} week={week} indexing={counts.indexing} view={view} onView={setView} newDisabled={noWorkspace} onNewAgent={actions.newAgent} />
      {noWorkspace && (
        <div className={styles.banner} data-tone="warn" data-testid="roster-no-workspace">
          <WarningIcon size={14} />
          <span>
            <b>No workspace is open</b>, so no agent profiles are kept: the built-ins show with their defaults and can’t be edited. Open a workspace in Pomade to manage the roster.
          </span>
        </div>
      )}
      <div className={styles.body} data-testid="roster-body">
        <Agents section="shown" agents={shown} view={view} tools={tools} now={now} />
        {first !== null && <div className={styles.first1}>{first}</div>}
        {hidden.length > 0 && (
          <>
            <div className={styles.group}>
              <button type="button" className={styles.toggle} aria-expanded={hiddenOpen} data-testid="roster-hidden-toggle" onClick={() => setHiddenOpen(!hiddenOpen)}>
                <span className={styles.chevron}>
                  <ChevronIcon size={12} />
                </span>
                <span className={styles.groupTitle}>Hidden from the “+” menu</span>
                <span className={styles.groupCount} data-testid="roster-hidden-count">
                  {hidden.length}
                </span>
              </button>
            </div>
            {hiddenOpen && <Agents section="hidden" agents={hidden} view={view} tools={tools} now={now} />}
          </>
        )}
      </div>
      {toast !== null && <Toast toast={toast} />}
    </div>
  );
}

