// The New agent page's own glyphs, in the stroke language of `core/icons.tsx`: 16 px grid, 1.2 px
// strokes, `currentColor`.

import type { ReactElement, ReactNode } from "react";

function Glyph({ size, className, children }: { size: number; className?: string | undefined; children: ReactNode }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}>
      <g stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round">
        {children}
      </g>
    </svg>
  );
}

/** A chevron pointing left — back to the Roster. */
export function BackGlyph({ size = 14 }: { size?: number }): ReactElement {
  return (
    <Glyph size={size}>
      <path d="M10 4L6 8l4 4" />
    </Glyph>
  );
}

/** An open ring that turns while something runs (the class spins it). */
export function SpinnerGlyph({ size = 14, className }: { size?: number; className?: string | undefined }): ReactElement {
  return (
    <Glyph size={size} className={className}>
      <path d="M8 2.5a5.5 5.5 0 1 1-5.5 5.5" />
    </Glyph>
  );
}

/** Two sheets — copy. */
export function CopyGlyph({ size = 14 }: { size?: number }): ReactElement {
  return (
    <Glyph size={size}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5V3.5c0-.55-.45-1-1-1h-6c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h2" />
    </Glyph>
  );
}
