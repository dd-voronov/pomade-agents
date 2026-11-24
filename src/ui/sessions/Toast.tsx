// The toast at the bottom of the tab: what a change did, with Undo, or why it was not done.

import type { ReactElement } from "react";

import type { Toast as ToastData } from "./useToast.ts";
import styles from "./Toast.module.css";

export function Toast({ toast }: { toast: ToastData }): ReactElement {
  return (
    <div className={styles.toast} role="status" title={toast.title} data-testid="toast" data-undo={toast.undo === null ? undefined : ""}>
      <span className={styles.text} data-testid="toast-text">
        {toast.text}
      </span>
      {toast.undo !== null && (
        <button type="button" className={styles.undo} data-testid="toast-undo" onClick={toast.undo}>
          Undo
        </button>
      )}
    </div>
  );
}
