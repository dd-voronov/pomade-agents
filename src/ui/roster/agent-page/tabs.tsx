// The agent page's tabs in the order the page shows them: each one's label and the file that
// renders it. A ticket that builds a tab replaces that tab's file and leaves this one alone.

import type { ReactElement } from "react";

import type { AgentTab } from "../../core/routes.ts";
import type { AgentContext } from "./agent-context.ts";
import { MemoryTab } from "./MemoryTab.tsx";
import { ModelTab } from "./ModelTab.tsx";
import { OverviewTab } from "./OverviewTab.tsx";
import { PermissionsTab } from "./PermissionsTab.tsx";
import { ProjectsTab } from "./ProjectsTab.tsx";
import { AgentSessionsTab } from "./AgentSessionsTab.tsx";
import { SkillsTab } from "./SkillsTab.tsx";

export const AGENT_TAB_VIEWS: Record<AgentTab, { label: string; View: (props: { context: AgentContext }) => ReactElement }> = {
  overview: { label: "Overview", View: OverviewTab },
  skills: { label: "Skills", View: SkillsTab },
  projects: { label: "Projects", View: ProjectsTab },
  model: { label: "Model & modes", View: ModelTab },
  permissions: { label: "Permissions", View: PermissionsTab },
  memory: { label: "Memory", View: MemoryTab },
  sessions: { label: "Sessions", View: AgentSessionsTab },
};
