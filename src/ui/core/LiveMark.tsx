// The live-state mark: a spinner while Working, a red dot for Needs you, a grey dot for Idle,
// nothing for Closed. Round, so it never reads as a status's square. Every surface that shows a
// live state uses it — Live now's rows, the Sessions tab's.

import type { ReactElement } from "react";
import type { SessionLiveState } from "pomade-kit/protocol";

import { LIVE_LABELS } from "./live.ts";
import styles from "./LiveMark.module.css";

export function LiveMark({ state, title }: { state: SessionLiveState; title?: string }): ReactElement {
  return <span className={styles.mark} data-state={state} data-testid="live-mark" role="img" aria-label={LIVE_LABELS[state]} title={title ?? LIVE_LABELS[state]} />;
}
