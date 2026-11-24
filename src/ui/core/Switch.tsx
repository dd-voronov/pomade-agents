// An on/off switch: a small track with a knob, `role="switch"`. A locked switch shows its state
// and takes no clicks; its tooltip says why.

import type { ReactElement } from "react";

import styles from "./Switch.module.css";

export interface SwitchProps {
  on: boolean;
  /** Called with the new state; absent or with `disabled`, the switch is locked. */
  onChange?: (on: boolean) => void;
  disabled?: boolean;
  /** The tooltip. */
  title: string;
  label: string;
  testId?: string;
}

export function Switch({ on, onChange, disabled = false, title, label, testId }: SwitchProps): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={styles.switch}
      disabled={disabled || onChange === undefined}
      title={title}
      data-testid={testId}
      onClick={() => onChange?.(!on)}
    />
  );
}
