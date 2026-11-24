// A context menu: entries (items, section heads, separators) in a raised box over a transparent
// scrim, placed at a point (a right-click) or under an element (a ⋯ button) and kept inside the
// window. The first item takes focus; ↑ ↓ move between items, Enter or a click runs one and closes
// the menu, Esc or a click outside closes it. A menu with a search field (a long list to pick from)
// focuses the field instead: typing filters, ↓ moves to the items, Enter runs the first one.

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";

import { CheckIcon, SearchIcon } from "./icons.tsx";
import styles from "./Menu.module.css";

export type MenuEntry =
  | {
      kind: "head";
      label: string;
      /** A path as the head: monospace, as written (not upper case). */
      mono?: boolean;
    }
  | { kind: "separator" }
  | {
      kind: "item";
      /** Tells the item apart in tests: `menu-item-<id>`. */
      id: string;
      label: string;
      /** Shown before the label; a checked item shows a tick instead. */
      glyph?: ReactNode;
      checked?: boolean;
      /** A key or a count after the label. */
      trail?: string;
      /** A second, fainter line under the label (a description), cut to one line. */
      detail?: string;
      /** Shown dimmed and not run; keys skip it. `why` is its tooltip. */
      disabled?: { why: string };
      run: () => void;
    }
  /** A search field at the top; the caller filters the entries by its value. */
  | { kind: "search"; value: string; placeholder: string; onChange: (value: string) => void }
  /** A faint line of text, such as why a list is empty. */
  | { kind: "note"; text: string };

/** Where the menu opens: at a point, or under (else over) an element's box. */
export type MenuAnchor = { x: number; y: number } | DOMRect;

/** The items keys move between: a disabled one takes no focus. */
const ENABLED_ITEM = "[role^='menuitem']:not(:disabled)";
/** The search field, when the menu has one. */
const SEARCH = "input[type='search']";

/** Keeps this much room to the window's edges. */
const EDGE = 8;
/** The gap between an element and the menu under it. */
const GAP = 4;

function place(anchor: MenuAnchor, width: number, height: number): { left: number; top: number } {
  const box = "width" in anchor ? anchor : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
  const below = "width" in anchor ? box.bottom + GAP : box.bottom;
  let left = box.left;
  let top = below;
  if (left + width > window.innerWidth - EDGE) left = Math.max(EDGE, box.right - width);
  if (top + height > window.innerHeight - EDGE) top = Math.max(EDGE, box.top - height - ("width" in anchor ? GAP : 0));
  return { left, top };
}

export interface MenuProps {
  entries: readonly MenuEntry[];
  anchor: MenuAnchor;
  onClose: () => void;
  label: string;
  testId?: string;
  /** A wider box, for items with a description. */
  wide?: boolean;
}

export function Menu({ entries, anchor, onClose, label, testId = "menu", wide = false }: MenuProps): ReactElement {
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const menu = box.current;
    if (menu === null) return;
    setAt(place(anchor, menu.offsetWidth, menu.offsetHeight));
  }, [anchor]);

  // Once placed (a hidden box takes no focus), the first item takes focus.
  const placed = at !== null;
  useLayoutEffect(() => {
    if (placed) (box.current?.querySelector<HTMLElement>(SEARCH) ?? box.current?.querySelector<HTMLButtonElement>(ENABLED_ITEM))?.focus();
  }, [placed]);

  useLayoutEffect(() => {
    const close = (): void => onClose();
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [onClose]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const items = [...(box.current?.querySelectorAll<HTMLButtonElement>(ENABLED_ITEM) ?? [])];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const inSearch = event.target instanceof HTMLInputElement;
    if (event.key === "Escape" || event.key === "Tab") onClose();
    else if (inSearch && event.key === "ArrowDown") items[0]?.focus();
    else if (inSearch && event.key === "Enter") items[0]?.click();
    else if (inSearch) return;
    else if (event.key === "ArrowDown") items[(index + 1) % items.length]?.focus();
    else if (event.key === "ArrowUp") items[(index - 1 + items.length) % items.length]?.focus();
    else if (event.key === "Home") items[0]?.focus();
    else if (event.key === "End") items[items.length - 1]?.focus();
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <>
      <div
        className={styles.scrim}
        data-testid={`${testId}-scrim`}
        onMouseDown={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        ref={box}
        className={wide ? `${styles.menu} ${styles.wide}` : styles.menu}
        role="menu"
        aria-label={label}
        data-testid={testId}
        style={at === null ? { visibility: "hidden", left: 0, top: 0 } : at}
        onKeyDown={onKeyDown}
        onContextMenu={(event) => event.preventDefault()}
      >
        {entries.map((entry, i) => {
          switch (entry.kind) {
            case "head":
              return (
                <div key={i} className={entry.mono === true ? `${styles.head} ${styles.mono}` : styles.head} data-testid={`${testId}-head`}>
                  {entry.label}
                </div>
              );
            case "search":
              return (
                <div key={i} className={styles.search}>
                  <SearchIcon size={14} />
                  <input
                    type="search"
                    value={entry.value}
                    placeholder={entry.placeholder}
                    aria-label={entry.placeholder}
                    autoComplete="off"
                    spellCheck={false}
                    data-testid={`${testId}-search`}
                    onChange={(event) => entry.onChange(event.target.value)}
                  />
                </div>
              );
            case "note":
              return (
                <div key={i} className={styles.note} data-testid={`${testId}-note`}>
                  {entry.text}
                </div>
              );
            case "separator":
              return <div key={i} className={styles.separator} role="separator" />;
            case "item":
              return (
                <button
                  key={i}
                  type="button"
                  role={entry.checked === undefined ? "menuitem" : "menuitemradio"}
                  aria-checked={entry.checked}
                  className={styles.item}
                  data-testid={`menu-item-${entry.id}`}
                  disabled={entry.disabled !== undefined}
                  title={entry.disabled?.why}
                  onClick={() => {
                    onClose();
                    entry.run();
                  }}
                >
                  <span className={styles.glyph}>{entry.checked === true ? <CheckIcon size={14} /> : entry.glyph}</span>
                  {entry.detail === undefined ? (
                    <span className={styles.label}>{entry.label}</span>
                  ) : (
                    <span className={`${styles.label} ${styles.twoLines}`}>
                      <span className={styles.labelMain}>{entry.label}</span>
                      <span className={styles.detail}>{entry.detail}</span>
                    </span>
                  )}
                  {entry.trail !== undefined && <span className={styles.trail}>{entry.trail}</span>}
                </button>
              );
          }
        })}
      </div>
    </>
  );
}
