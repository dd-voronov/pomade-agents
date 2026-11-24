// The search's marks in the texts the Sessions tab shows: the tab provides the search's pattern
// (`SearchPattern`), `Highlighted` marks its matches in a text, and `SearchSnippet` is the line a
// row adds for a match it does not show ("Agent: …").

import { createContext, useContext, type ReactElement } from "react";

import type { Session } from "../../shared/sessions.ts";
import { highlightParts, snippetOf } from "./search-model.ts";
import styles from "./Highlight.module.css";

/** The search's pattern; `null` while the search field is empty. */
export const SearchPattern = createContext<RegExp | null>(null);

/** `text` with the search's matches marked. */
export function Highlighted({ text }: { text: string }): ReactElement {
  const pattern = useContext(SearchPattern);
  if (pattern === null) return <>{text}</>;
  return (
    <>
      {highlightParts(text, pattern).map((part, i) =>
        part.match ? (
          <mark key={i} className={styles.match} data-testid="search-match">
            {part.text}
          </mark>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

/** The snippet line under a row whose match the row does not show; nothing otherwise. `className`
 *  lays the line out in the row, as its note line. */
export function SearchSnippet({ session, className }: { session: Session; className: string | undefined }): ReactElement | null {
  const pattern = useContext(SearchPattern);
  const snippet = pattern === null ? null : snippetOf(session, pattern);
  if (snippet === null) return null;
  return (
    <div className={[className, styles.snippet].filter(Boolean).join(" ")} data-testid="search-snippet">
      <b className={styles.label}>{snippet.label}:</b>
      <span title={snippet.text}>
        <Highlighted text={snippet.text} />
      </span>
    </div>
  );
}
