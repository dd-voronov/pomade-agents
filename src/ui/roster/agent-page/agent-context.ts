// What the agent's page hands each of its tabs: the agent as the roster answers it and what every
// tab needs to act — the host, the project names, a toast, opening a file in Pomade's editor, saving
// the profile. Each tab is one file that takes this and nothing else.

import type { ProjectRef } from "pomade-kit/protocol";
import type { HostClient } from "pomade-kit/sdk";

import type { RosterEntry } from "../../../shared/roster.ts";
import type { AgentCountsView } from "../useAgentCounts.ts";
import type { ShowToast } from "../../sessions/useToast.ts";
import type { ProfileEdit } from "../profile-edit/useProfileEdit.ts";
import type { WorkspaceRoots } from "./agent-model.ts";

export interface AgentContext {
  host: HostClient;
  entry: RosterEntry;
  /** The roster's revision: a read of the agent's files is asked again when it changes. */
  revision: number;
  /** Why no profiles are kept (no workspace is open); `null` while they are. */
  profilesOff: string | null;
  roots: WorkspaceRoots;
  /** `<workspace>/Apps/pomade-agents`, absolute; `null` without a workspace. */
  dataDir: string | null;
  /** Pomade's projects by stable id; empty until Pomade has answered. */
  projects: ReadonlyMap<string, ProjectRef>;
  /** Each agent's work-session counts (this week, last active, per project); `null` until the first answer. */
  counts: AgentCountsView | null;
  /** The current time, renewed every 30 s: relative times stay true. */
  now: Date;
  show: ShowToast;
  /** Open an absolute path in Pomade's editor. */
  openFile: (absolute: string) => void;
  profileEdit: ProfileEdit;
  /** Move this tab to a route (`tabs.setRoute`). */
  navigate: (route: string) => void;
}
