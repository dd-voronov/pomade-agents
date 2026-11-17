// Glyphs in Pomade's stroke language: 16px grid, 1.2px strokes, `currentColor`.

import type { ReactElement, ReactNode } from "react";

function Glyph({ size, children }: { size: number; children: ReactNode }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </g>
    </svg>
  );
}

export interface IconProps {
  size?: number;
}

/** Stacked rows — the Sessions list. */
export function SessionsIcon({ size = 16 }: IconProps): ReactElement {
  return (
    <Glyph size={size}>
      <rect x="2.5" y="3" width="11" height="3.5" rx="1" />
      <rect x="2.5" y="9.5" width="11" height="3.5" rx="1" />
    </Glyph>
  );
}

/** Two people — the Roster. */
export function RosterIcon({ size = 16 }: IconProps): ReactElement {
  return (
    <Glyph size={size}>
      <circle cx="6" cy="5.5" r="2.2" />
      <path d="M2 13c0-2.2 1.8-3.8 4-3.8s4 1.6 4 3.8" />
      <path d="M10.4 3.6a2.2 2.2 0 0 1 0 3.9" />
      <path d="M11.8 9.6c1.3.5 2.2 1.8 2.2 3.4" />
    </Glyph>
  );
}

/** A pulse line — Live now. */
export function LiveIcon({ size = 16 }: IconProps): ReactElement {
  return (
    <Glyph size={size}>
      <path d="M1.5 8.5h3l1.7-4.5 3 8 1.8-3.5h3.5" />
    </Glyph>
  );
}

/** An unplugged connector — no host, or a host this build cannot talk to. */
export function UnpluggedIcon({ size = 16 }: IconProps): ReactElement {
  return (
    <Glyph size={size}>
      <path d="M6 2v3M10 2v3" />
      <path d="M4 5h8v2.5a4 4 0 0 1-8 0z" />
      <path d="M8 11.5V14" />
    </Glyph>
  );
}
