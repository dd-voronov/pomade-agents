// One section of a tab: its heading, an optional button at the right of the heading, and the body.

import type { ReactElement, ReactNode } from "react";

import styles from "./page.module.css";

export function Section({ title, action, testId, children }: { title: string; action?: ReactNode; testId: string; children: ReactNode }): ReactElement {
  return (
    <section className={styles.section} data-testid={testId}>
      <div className={styles.sectionHead}>
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
