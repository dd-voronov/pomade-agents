// Projects: where the agent is offered and where it worked — built by T-034. This file is that ticket's.

import type { ReactElement } from "react";

import type { AgentContext } from "./agent-context.ts";
import { Section } from "./Section.tsx";
import styles from "./page.module.css";

export function ProjectsTab({ context }: { context: AgentContext }): ReactElement {
  void context;
  return (
    <Section title="Projects" testId="agent-projects">
      <div className={styles.block}>
        <p className={styles.none}>The projects this agent is connected to will be managed here. This tab is not built yet.</p>
      </div>
    </Section>
  );
}
