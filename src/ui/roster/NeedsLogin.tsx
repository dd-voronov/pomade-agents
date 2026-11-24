// Needs login on screen, for the agent's page, the Roster's card and its list row: the chip, the
// notice that says what to do with **Copy setup prompt**, and the row's one-line form of it. Whether
// an agent needs login: `needs-login.ts`.

import { useEffect, useState, type ReactElement } from "react";

import { copyText } from "../core/clipboard.ts";
import { KeyIcon } from "../core/icons.tsx";
import { NEEDS_LOGIN_LABEL } from "./needs-login.ts";
import styles from "./NeedsLogin.module.css";

/** How long "Copied" shows after a copy. */
const COPIED_MS = 1500;

export function NeedsLoginChip({ testId = "needs-login-chip" }: { testId?: string }): ReactElement {
  return (
    <span className={styles.chip} title="Its first session asks for /login" data-testid={testId}>
      {NEEDS_LOGIN_LABEL}
    </span>
  );
}

/** Copying `prompt`: `copied` shows for a moment after `copy`. */
function useCopyPrompt(prompt: string): { copied: boolean; copy: () => void } {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  return { copied, copy: () => void copyText(prompt).then(() => setCopied(true)) };
}

/** "Log in with /login in its tab, then paste the setup prompt." and the link that copies `prompt`. */
export function NeedsLoginNotice({ prompt, testId = "needs-login-notice" }: { prompt: string; testId?: string }): ReactElement {
  const { copied, copy } = useCopyPrompt(prompt);
  return (
    <div className={styles.notice} data-testid={testId}>
      <KeyIcon size={14} />
      <span>
        Log in with <code>/login</code> in its tab, then paste the setup prompt.{" "}
        <button type="button" className={styles.link} title={prompt} data-testid={`${testId}-copy`} onClick={copy}>
          {copied ? "Copied" : "Copy setup prompt"}
        </button>
      </span>
    </div>
  );
}

/** The notice in one line, for a list row's second line: the instruction cuts with "…" as the row narrows
 *  and leaves only the link, which never shrinks. */
export function NeedsLoginLine({ prompt, testId = "needs-login-line" }: { prompt: string; testId?: string }): ReactElement {
  const { copied, copy } = useCopyPrompt(prompt);
  return (
    <span className={styles.line} data-testid={testId}>
      <span className={styles.lineText}>
        Log in with <code>/login</code> in its tab, then paste the setup prompt.
      </span>
      <button type="button" className={styles.link} title={`Log in with /login in its tab, then paste: ${prompt}`} data-testid={`${testId}-copy`} onClick={copy}>
        {copied ? "Copied" : "Copy setup prompt"}
      </button>
    </span>
  );
}
