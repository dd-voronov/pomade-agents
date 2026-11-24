// An agent's role line, edited where it is shown (DESIGN §3.3, §3.4): a click, or Enter on the focused
// line, turns it into a field; Enter or leaving the field saves, Esc drops the change. Hovering and
// editing only paint — the line keeps its box (the field lies over the text, which stays in the
// layout and takes the typed text), so nothing around it moves. Used by the agent page and the
// Roster's cards and rows.

import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";

import { ROLE_MAX } from "../../../shared/roster.ts";
import { PencilIcon } from "../../core/icons.tsx";
import { oneLine, roleToSave } from "./profile-edit-model.ts";
import styles from "./RoleLine.module.css";

export interface RoleLineProps {
  /** The saved role line; `undefined`: none. */
  role: string | undefined;
  /** A line that cannot be edited (no usable `agent.yaml`, an orphan, no workspace) is only shown. */
  editable: boolean;
  /** Save the role (`null` removes it); resolves `true` when it was saved. */
  onSave: (role: string | null) => Promise<boolean>;
  /** Show at most this many lines, cut with "…"; the whole line otherwise. */
  lines?: number;
  testId: string;
}

export function RoleLine({ role, editable, onSave, lines, testId }: RoleLineProps): ReactElement {
  const [draft, setDraft] = useState<string | null>(null);
  /** What was sent and has not been answered yet: shown in place of the saved role meanwhile. */
  const [sent, setSent] = useState<string | null | undefined>(undefined);
  const field = useRef<HTMLTextAreaElement>(null);
  const editing = draft !== null;

  useEffect(() => {
    if (editing) field.current?.focus();
  }, [editing]);

  const shown = editing ? oneLine(draft) : sent === undefined ? role : (sent ?? undefined);

  const finish = (save: boolean): void => {
    if (draft === null) return;
    setDraft(null);
    if (!save) return;
    const next = roleToSave(draft, role);
    if (next === undefined) return;
    setSent(next);
    void onSave(next).finally(() => setSent(undefined));
  };

  const text =
    shown === undefined || shown === "" ? (
      <span className={styles.none}>{editing ? "​" : "No role line"}</span>
    ) : (
      <>
        {shown}
        {editing ? "​" : ""}
      </>
    );

  return (
    <div className={styles.root} data-editable={editable ? "" : undefined} data-editing={editing ? "" : undefined} data-testid={testId}>
      <button
        type="button"
        className={styles.display}
        disabled={!editable}
        tabIndex={editing ? -1 : 0}
        title={editable && !editing ? "Click to edit — saved to agent.yaml" : undefined}
        style={lines === undefined ? undefined : ({ "--lines": lines } as CSSProperties)}
        data-lines={lines === undefined ? undefined : ""}
        data-testid={`${testId}-text`}
        onClick={() => setDraft(role ?? "")}
      >
        <span className={styles.text}>{text}</span>
        {editable && <PencilIcon size={12} />}
      </button>
      {editing && (
        <textarea
          ref={field}
          className={styles.field}
          value={draft}
          rows={1}
          maxLength={ROLE_MAX}
          placeholder="One line: what it is for"
          aria-label="Role line"
          data-testid={`${testId}-field`}
          onChange={(event) => setDraft(event.target.value.replace(/[\r\n]+/g, " "))}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              finish(true);
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              finish(false);
            }
          }}
          onBlur={() => finish(true)}
        />
      )}
    </div>
  );
}
