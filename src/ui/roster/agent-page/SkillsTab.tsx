// Skills: the agent's skills, switched on and off — built by T-023. This file is that ticket's.

import type { ReactElement } from "react";

import type { AgentContext } from "./agent-context.ts";
import { Section } from "./Section.tsx";
import styles from "./page.module.css";

export function SkillsTab({ context }: { context: AgentContext }): ReactElement {
  void context;
  return (
    <Section title="Skills" testId="agent-skills">
      <div className={styles.block}>
        <p className={styles.none}>The agent’s skills will be managed here. This tab is not built yet.</p>
      </div>
    </Section>
  );
}
