// The Sessions tab's toolbar (DESIGN §2.7 "Both layouts"): the search field, the filter buttons —
// Project (the Workspace's tab only), Agent, Folder — each opening its menu, and while a search or
// filter is on, "Clear" and the match count. The bulk bar takes its row while rows are checked.
//
// Keys in the search field: Esc clears it, then leaves it; ↓ leaves it for the first row.

import type { KeyboardEvent, ReactElement, ReactNode, RefObject } from "react";

import { CaretIcon, CloseIcon, FolderIcon, SearchIcon } from "../core/icons.tsx";
import { matchCount, type FilterKind } from "./search-model.ts";
import styles from "./Toolbar.module.css";

export interface ToolbarProps {
  searchRef: RefObject<HTMLInputElement>;
  query: string;
  onQuery: (query: string) => void;
  /** ↓ in the search field: go to the first row. */
  onLeaveDown: () => void;
  /** The Workspace's tab: a Project filter too. */
  workspace: boolean;
  /** What each filter is set to, as its button names it; `null`: off. */
  labels: Record<FilterKind, string | null>;
  /** The filter whose menu is open. */
  openFilter: FilterKind | null;
  onOpenFilter: (kind: FilterKind, anchor: DOMRect) => void;
  /** The match count while a search or filter is on; `null` otherwise. */
  matches: number | null;
  onClear: () => void;
}

const FILTER_NAMES: Record<FilterKind, string> = { project: "Project", agent: "Agent", folder: "Folder" };
const FILTER_TOOLTIPS: Record<FilterKind, string> = {
  project: "Show one project's sessions",
  agent: "Show one agent's sessions",
  folder: "Show the sessions started in one folder",
};

export function Toolbar({ searchRef, query, onQuery, onLeaveDown, workspace, labels, openFilter, onOpenFilter, matches, onClear }: ToolbarProps): ReactElement {
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (query !== "") onQuery("");
      else event.currentTarget.blur();
    } else if (event.key === "ArrowDown" && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      event.currentTarget.blur();
      onLeaveDown();
    }
  };

  const filter = (kind: FilterKind, icon?: ReactNode): ReactElement => {
    const label = labels[kind];
    return (
      <button
        type="button"
        className={styles.button}
        title={label === null ? FILTER_TOOLTIPS[kind] : `${FILTER_NAMES[kind]}: ${label}`}
        aria-haspopup="menu"
        aria-expanded={openFilter === kind}
        data-on={label === null ? undefined : ""}
        data-testid={`filter-${kind}`}
        onClick={(event) => onOpenFilter(kind, event.currentTarget.getBoundingClientRect())}
      >
        {icon}
        <span className={styles.buttonLabel}>{label ?? FILTER_NAMES[kind]}</span>
        <span className={styles.caret}>
          <CaretIcon size={12} />
        </span>
      </button>
    );
  };

  return (
    <div className={styles.bar} role="search" data-testid="sessions-toolbar">
      <label className={styles.search}>
        <span className={styles.glyph}>
          <SearchIcon size={14} />
        </span>
        <input
          ref={searchRef}
          className={styles.field}
          type="text"
          value={query}
          placeholder="Search names, messages and notes"
          aria-label="Search the sessions"
          title="Search names, messages and notes (/)"
          spellCheck={false}
          autoComplete="off"
          data-testid="search-field"
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {query !== "" && (
          <button
            type="button"
            className={styles.clearSearch}
            title="Clear the search"
            aria-label="Clear the search"
            data-testid="search-clear"
            onClick={() => {
              onQuery("");
              searchRef.current?.focus();
            }}
          >
            <CloseIcon size={12} />
          </button>
        )}
      </label>
      {workspace && filter("project")}
      {filter("agent")}
      {filter("folder", <FolderIcon size={14} />)}
      {matches !== null && (
        <>
          <button type="button" className={styles.link} title="Clear the search and every filter" data-testid="filters-clear" onClick={onClear}>
            Clear
          </button>
          <span className={styles.spacer} />
          <span className={styles.count} data-testid="match-count">
            {matchCount(matches)}
          </span>
        </>
      )}
    </div>
  );
}
