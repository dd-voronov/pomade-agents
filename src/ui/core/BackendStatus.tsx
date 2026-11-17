// One quiet line saying whether the app's background part answers, in the words of Pomade's own
// strip tooltip ("Background: running").

import type { ReactElement } from "react";
import type { HostClient } from "pomade-kit/sdk";

import styles from "./BackendStatus.module.css";
import { useBackendInfo, type BackendState } from "./useBackendInfo.ts";

const LABEL: Record<BackendState["status"], string> = {
  checking: "Background: connecting…",
  running: "Background: running",
  down: "Background: not answering",
};

export function BackendStatus({ host }: { host: HostClient }): ReactElement {
  const state = useBackendInfo(host);
  return (
    <footer
      className={styles.status}
      data-testid="backend-status"
      data-status={state.status}
      title={state.status === "down" ? `Pomade's answer: ${state.reason}` : undefined}
    >
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.label}>{LABEL[state.status]}</span>
      {state.status === "running" && (
        <span className={styles.version} data-testid="backend-version">
          v{state.info.version}
        </span>
      )}
    </footer>
  );
}
