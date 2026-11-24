// A row's checkbox, the table header's select-all and the bulk bar's clear: a 14 px box with a tick
// (or a dash when only some rows are checked). A click on it never reaches the row under it.

import type { MouseEvent, ReactElement } from "react";

import { CheckIcon, MixedIcon } from "../core/icons.tsx";
import styles from "./Checkbox.module.css";

export interface CheckboxProps {
  checked: boolean | "mixed";
  label: string;
  onToggle: (event: MouseEvent<HTMLButtonElement>) => void;
  testId: string;
  className?: string | undefined;
}

export function Checkbox({ checked, label, onToggle, testId, className }: CheckboxProps): ReactElement {
  return (
    <button
      type="button"
      role="checkbox"
      className={className === undefined ? styles.box : `${styles.box} ${className}`}
      aria-checked={checked}
      aria-label={label}
      title={label}
      // Rows check with Space and the bulk bar has Clear: the boxes stay out of the Tab order.
      tabIndex={-1}
      draggable={false}
      data-testid={testId}
      // Shift+click checks a range: no text selection along with it.
      onMouseDown={(event) => {
        if (event.shiftKey) event.preventDefault();
      }}
      onClick={(event) => {
        event.stopPropagation();
        onToggle(event);
      }}
    >
      {checked === "mixed" ? <MixedIcon size={10} stroke={2.2} /> : <CheckIcon size={10} stroke={2.2} />}
    </button>
  );
}
