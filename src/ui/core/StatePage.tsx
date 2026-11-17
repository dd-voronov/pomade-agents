// A surface with nothing to list: a glyph, a title and one or two plain sentences, centred. Every
// empty and unavailable state of the app is this one shape.

import type { ReactElement, ReactNode } from "react";

import styles from "./StatePage.module.css";

export interface StatePageProps {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  /** `warning` tints the glyph: the app cannot work here. Default `neutral`. */
  tone?: "neutral" | "warning";
  /** `compact` fits the side panel's width. Default `regular`. */
  size?: "regular" | "compact";
  testId: string;
}

export function StatePage({ icon, title, children, tone = "neutral", size = "regular", testId }: StatePageProps): ReactElement {
  return (
    <section className={styles.page} data-size={size} data-testid={testId}>
      <div className={styles.glyph} data-tone={tone}>
        {icon}
      </div>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.text}>{children}</p>
    </section>
  );
}
