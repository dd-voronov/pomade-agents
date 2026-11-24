// An agent's tags, edited where they are shown (DESIGN §3.3, §3.4): × on a tag removes it, "+ tag"
// takes a field where Enter or a comma adds the tag, leaving the field adds what is typed, Esc drops
// it. Every change saves the whole list at once. The × and the add button have their room in every
// state, and the field is the add button's size, so hovering and adding never move a tag. Used by
// the agent page and the Roster's cards.

import { useEffect, useRef, useState, type ReactElement } from "react";

import { TAG_MAX } from "../../../shared/roster.ts";
import { CloseIcon, PlusIcon } from "../../core/icons.tsx";
import { withTags, withoutTag } from "./profile-edit-model.ts";
import styles from "./TagList.module.css";

export interface TagListProps {
  tags: readonly string[];
  /** A list that cannot be edited is only shown, and says "No tags" when empty. */
  editable: boolean;
  /** Save the whole list; resolves `true` when it was saved. */
  onSave: (tags: readonly string[]) => Promise<boolean>;
  /** `always`: the add button shows; `hover`: it shows while the list is hovered or has focus. */
  add?: "always" | "hover";
  testId: string;
}

export function TagList({ tags, editable, onSave, add = "always", testId }: TagListProps): ReactElement {
  const [entry, setEntry] = useState<string | null>(null);
  /** The list sent and not yet answered: shown in place of the saved one meanwhile. */
  const [sent, setSent] = useState<readonly string[] | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const adding = entry !== null;

  useEffect(() => {
    if (adding) field.current?.focus();
  }, [adding]);

  const shown = sent ?? tags;

  const save = (next: readonly string[]): void => {
    setSent(next);
    void onSave(next).finally(() => setSent((current) => (current === next ? null : current)));
  };

  /** Add what is typed; the field stays open for the next tag when `keepOpen`. */
  const commit = (keepOpen: boolean): void => {
    if (entry === null) return;
    const next = withTags(shown, entry);
    setEntry(keepOpen ? "" : null);
    if (next !== shown) save(next);
  };

  if (!editable && shown.length === 0) {
    return (
      <div className={styles.tags} data-testid={testId}>
        <span className={styles.none}>No tags</span>
      </div>
    );
  }

  return (
    <div className={styles.tags} data-add={add} data-testid={testId}>
      {shown.map((tag) => (
        <span key={tag} className={styles.tag} data-testid={`${testId}-tag`}>
          {tag}
          {editable && (
            <button type="button" className={styles.remove} aria-label={`Remove tag ${tag}`} title="Remove tag" data-testid={`${testId}-remove`} onClick={() => save(withoutTag(shown, tag))}>
              <CloseIcon size={10} />
            </button>
          )}
        </span>
      ))}
      {editable &&
        (adding ? (
          <input
            ref={field}
            className={styles.field}
            value={entry}
            maxLength={TAG_MAX * 4}
            placeholder="tag"
            aria-label="New tag"
            data-testid={`${testId}-field`}
            onChange={(event) => {
              const typed = event.target.value;
              if (typed.includes(",")) {
                // A comma ends the tag, as Enter does.
                const next = withTags(shown, typed);
                setEntry("");
                if (next !== shown) save(next);
              } else setEntry(typed);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit(true);
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setEntry(null);
              }
            }}
            onBlur={() => commit(false)}
          />
        ) : (
          <button type="button" className={styles.add} data-testid={`${testId}-add`} onClick={() => setEntry("")}>
            <PlusIcon size={12} />
            tag
          </button>
        ))}
    </div>
  );
}
