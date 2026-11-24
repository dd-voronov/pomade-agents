// A context menu: entries (items, section heads, separators) in a raised box over a transparent
// scrim, placed at a point (a right-click) or under an element (a ⋯ button) and kept inside the
// window. The first item takes focus; ↑ ↓ move between items, Enter or a click runs one and closes
// the menu, Esc or a click outside closes it.

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";

import { CheckIcon } from "./icons.tsx";
import styles from "./Menu.module.css";

export type MenuEntry =
  | { kind: "head"; label: string }
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
      run: () => void;
    };

/** Where the menu opens: at a point, or under (else over) an element's box. */
export type MenuAnchor = { x: number; y: number } | DOMRect;

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
}

export function Menu({ entries, anchor, onClose, label, testId = "menu" }: MenuProps): ReactElement {
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
    if (placed) box.current?.querySelector<HTMLButtonElement>("[role^='menuitem']")?.focus();
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
    const items = [...(box.current?.querySelectorAll<HTMLButtonElement>("[role^='menuitem']") ?? [])];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape" || event.key === "Tab") onClose();
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
        className={styles.menu}
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
                <div key={i} className={styles.head} data-testid={`${testId}-head`}>
                  {entry.label}
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
                  onClick={() => {
                    onClose();
                    entry.run();
                  }}
                >
                  <span className={styles.glyph}>{entry.checked === true ? <CheckIcon size={14} /> : entry.glyph}</span>
                  <span className={styles.label}>{entry.label}</span>
                  {entry.trail !== undefined && <span className={styles.trail}>{entry.trail}</span>}
                </button>
              );
          }
        })}
      </div>
    </>
  );
}
