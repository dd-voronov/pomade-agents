// A message block that shows its first `lines` lines; when the text is longer, "Show more" expands
// it in place and "Show less" clamps it again. Whether it is longer is measured, so it holds at
// every width. The clamp is on the text inside the padded block, so no part of a hidden line shows
// in the padding.

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";

import styles from "./DetailPanel.module.css";

export interface ClampedTextProps {
  text: string;
  lines: number;
  /** "user": the user's message; "agent": the agent's answer, marked with the accent. */
  from: "user" | "agent";
  testId: string;
}

export function ClampedText({ text, lines, from, testId }: ClampedTextProps): ReactElement {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || expanded) return;
    const measure = (): void => setOverflows(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, text]);

  return (
    <>
      <div className={styles.message} data-from={from}>
        <p ref={ref} className={styles.text} data-clamped={expanded ? undefined : ""} style={{ "--lines": lines } as CSSProperties} data-testid={testId}>
          {text}
        </p>
      </div>
      {(overflows || expanded) && (
        <button type="button" className={`${styles.link} ${styles.more}`} aria-expanded={expanded} data-testid={`${testId}-more`} onClick={() => setExpanded((e) => !e)}>
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </>
  );
}
