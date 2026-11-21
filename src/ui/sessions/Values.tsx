// How a session's values read wherever they show: "—" for what is not known (with why, as a
// tooltip), and the context meter — a bar with the percent, amber from 75 %, red from 90 %.

import type { ReactElement } from "react";

import type { Session } from "../../shared/sessions.ts";
import { contextMeter, unknownReason } from "./table-model.ts";
import styles from "./Values.module.css";

export function Unknown({ session }: { session: Session }): ReactElement {
  return (
    <span className={styles.dash} title={unknownReason(session)}>
      —
    </span>
  );
}

export function ContextMeter({ session }: { session: Session }): ReactElement {
  const context = session.summary.context;
  if (context === null) return <Unknown session={session} />;
  const { percent, level, fill } = contextMeter(context);
  return (
    <span className={styles.context} data-level={level} title={`Context ${percent}% full`}>
      <span className={styles.bar}>
        <span className={styles.fill} style={{ width: `${fill}%` }} />
      </span>
      <span className={styles.percent}>{percent}%</span>
    </span>
  );
}
