// The bulk bar (DESIGN §2.7 "Selecting several"): while rows are checked it takes the toolbar's
// place — "N selected", Set status with the four statuses, Clear. Bulk sets no note. Another bulk
// action is one more control before the spacer.

import type { ReactElement } from "react";
import { SESSION_STATUSES, type SessionStatus } from "pomade-kit/protocol";

import { Checkbox } from "./Checkbox.tsx";
import { StatusMark } from "./StatusGroup.tsx";
import { STATUS_LABELS, STATUS_SHORT_LABELS } from "./table-model.ts";
import styles from "./BulkBar.module.css";

export interface BulkBarProps {
  count: number;
  onSetStatus: (status: SessionStatus) => void;
  onClear: () => void;
}

export function BulkBar({ count, onSetStatus, onClear }: BulkBarProps): ReactElement {
  return (
    <div className={styles.bar} role="toolbar" aria-label="Checked sessions" data-testid="bulk-bar">
      <Checkbox checked label="Clear the checks" testId="bulk-clear-box" onToggle={onClear} />
      <span className={styles.count} data-testid="bulk-count">
        {count} selected
      </span>
      <span className={styles.label}>Set status</span>
      {SESSION_STATUSES.map((status) => (
        <button
          key={status}
          type="button"
          className={styles.button}
          title={`Set ${count === 1 ? "the checked session" : `the ${count} checked sessions`} to ${STATUS_LABELS[status]}`}
          data-testid={`bulk-status-${status}`}
          onClick={() => onSetStatus(status)}
        >
          <StatusMark status={status} />
          <span className={styles.buttonLabel}>{STATUS_SHORT_LABELS[status]}</span>
        </button>
      ))}
      <span className={styles.spacer} />
      <button type="button" className={styles.button} title="Clear the checks (Esc)" data-testid="bulk-clear" onClick={onClear}>
        Clear
      </button>
    </div>
  );
}
