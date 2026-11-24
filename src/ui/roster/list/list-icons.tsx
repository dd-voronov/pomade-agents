// The Roster's own glyphs, in the app's stroke language (`core/icons.tsx`): 16px grid, 1.2px strokes.

import type { ReactElement, ReactNode } from "react";

function Glyph({ size, children }: { size: number; children: ReactNode }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <g stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round">
        {children}
      </g>
    </svg>
  );
}

/** Four tiles — the cards view. */
export function GridIcon({ size = 14 }: { size?: number }): ReactElement {
  return (
    <Glyph size={size}>
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
    </Glyph>
  );
}

/** Dotted lines — the list view. */
export function ListIcon({ size = 14 }: { size?: number }): ReactElement {
  return (
    <Glyph size={size}>
      <path d="M5.5 4h8M5.5 8h8M5.5 12h8" />
      <circle cx="2.75" cy="4" r=".6" fill="currentColor" />
      <circle cx="2.75" cy="8" r=".6" fill="currentColor" />
      <circle cx="2.75" cy="12" r=".6" fill="currentColor" />
    </Glyph>
  );
}

/** A plus — New agent. */
export function PlusIcon({ size = 14 }: { size?: number }): ReactElement {
  return (
    <Glyph size={size}>
      <path d="M8 3.5v9M3.5 8h9" />
    </Glyph>
  );
}

/** Two links of a chain — Re-link. */
export function LinkIcon({ size = 14 }: { size?: number }): ReactElement {
  return (
    <Glyph size={size}>
      <path d="M6.75 9.25l2.5-2.5" />
      <path d="M8.75 4.75l.9-.9a2.3 2.3 0 0 1 3.25 3.25l-.9.9M7.25 11.25l-.9.9a2.3 2.3 0 0 1-3.25-3.25l.9-.9" />
    </Glyph>
  );
}
