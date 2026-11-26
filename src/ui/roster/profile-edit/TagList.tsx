// An agent's tags, edited where they are shown (ARCHITECTURE §3.3, §3.4): × on a tag removes it, "+ tag"
// takes a field where Enter or a comma adds the tag, leaving the field adds what is typed, Esc drops
// it. Every change saves the whole list at once. The × and the add button have their room in every
// state, and the field is the add button's size, so hovering and adding never move a tag. Used by
// the agent page and the Roster's cards. On a card the list keeps to one row (`oneRow`): the tags that
// do not fit fade out at its end, the whole list is the tooltip, and "+ tag" stays after them.

import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";

import { TAGS_MAX, TAG_MAX } from "../../../shared/roster.ts";
import { CloseIcon, PlusIcon } from "../../core/icons.tsx";
import { tagsFull, withTags, withoutTag } from "./profile-edit-model.ts";
import styles from "./TagList.module.css";

export interface TagListProps {
  tags: readonly string[];
  /** A list that cannot be edited is only shown, and says "No tags" when empty. */
  editable: boolean;
  /** Save the whole list; resolves `true` when it was saved. */
  onSave: (tags: readonly string[]) => Promise<boolean>;
  /** `always`: the add button shows; `hover`: it shows while the list is hovered or has focus. */
  add?: "always" | "hover";
  /** One row, always: the room never grows, so nothing under the list moves. */
  oneRow?: boolean;
  testId: string;
}

export function TagList({ tags, editable, onSave, add = "always", oneRow = false, testId }: TagListProps): ReactElement {
  const [entry, setEntry] = useState<string | null>(null);
  /** The list sent and not yet answered: shown in place of the saved one meanwhile. */
  const [sent, setSent] = useState<readonly string[] | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const row = useRef<HTMLDivElement>(null);
  /** One row's tags do not all fit: they fade out at its end. */
  const [cut, setCut] = useState(false);
  const adding = entry !== null;

  useEffect(() => {
    if (adding) field.current?.focus();
  }, [adding]);

  const shown = sent ?? tags;

  useLayoutEffect(() => {
    const el = row.current;
    if (!oneRow || el === null) return;
    const measure = (): void => setCut(el.scrollWidth > el.clientWidth + 0.5);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [oneRow, shown]);

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
      <div className={styles.tags} data-one-row={oneRow ? "" : undefined} data-testid={testId}>
        <span className={styles.none}>No tags</span>
      </div>
    );
  }

  const chips = shown.map((tag) => (
        <span key={tag} className={styles.tag} data-testid={`${testId}-tag`}>
          {tag}
          {editable && (
            <button type="button" className={styles.remove} aria-label={`Remove tag ${tag}`} title="Remove tag" data-testid={`${testId}-remove`} onClick={() => save(withoutTag(shown, tag))}>
              <CloseIcon size={10} />
            </button>
          )}
        </span>
      ));
  const addOrField =
    editable &&
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
          <button type="button" className={styles.add} disabled={tagsFull(shown)} title={tagsFull(shown) ? `At most ${TAGS_MAX} tags` : undefined} data-testid={`${testId}-add`} onClick={() => setEntry("")}>
            <PlusIcon size={12} />
            tag
          </button>
        ));

  return (
    <div className={styles.tags} data-add={add} data-one-row={oneRow ? "" : undefined} data-testid={testId}>
      {oneRow ? (
        <div ref={row} className={styles.row} data-cut={cut ? "" : undefined} title={cut ? shown.join(", ") : undefined}>
          {chips}
        </div>
      ) : (
        chips
      )}
      {addOrField}
    </div>
  );
}
