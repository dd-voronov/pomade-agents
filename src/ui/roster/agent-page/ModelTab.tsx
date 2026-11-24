// Model & modes: the default model and effort, and the launch modes — built by T-024. This file is that ticket's.

import type { ReactElement } from "react";

import type { AgentContext } from "./agent-context.ts";
import { Section } from "./Section.tsx";
import styles from "./page.module.css";

export function ModelTab({ context }: { context: AgentContext }): ReactElement {
  void context;
  return (
    <Section title="Model & modes" testId="agent-model">
      <div className={styles.block}>
        <p className={styles.none}>The agent’s model, effort and launch modes will be managed here. This tab is not built yet.</p>
      </div>
    </Section>
  );
}
