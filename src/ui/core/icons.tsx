// Glyphs in Pomade's stroke language: 16px grid, 1.2px strokes, `currentColor`.

import type { ReactElement, ReactNode } from "react";

function Glyph({ size, stroke = 1.2, children }: { size: number; stroke?: number | undefined; children: ReactNode }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <g stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
        {children}
      </g>
    </svg>
  );
}

export interface IconProps {
  size?: number;
}

/** A glyph drawn small inside a control, with a heavier stroke so it reads at that size. */
export interface MarkProps extends IconProps {
  stroke?: number;
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

/** A chevron pointing right; turned down, it says a group is open. */
export function ChevronIcon({ size = 16 }: IconProps): ReactElement {
  return (
    <Glyph size={size}>
      <path d="M6 4l4 4-4 4" />
    </Glyph>
  );
}

/** A forked branch — a session forked from another. */
export function ForkIcon({ size = 16 }: IconProps): ReactElement {
  return (
    <Glyph size={size}>
      <circle cx="4.5" cy="3.5" r="1.5" />
      <circle cx="11.5" cy="3.5" r="1.5" />
      <circle cx="8" cy="12.5" r="1.5" />
      <path d="M4.5 5v1.5c0 1 .8 1.5 1.75 1.5h3.5c.95 0 1.75-.5 1.75-1.5V5M8 8v3" />
    </Glyph>
  );
}

/** A stopwatch — an unattended run. */
export function TimerIcon({ size = 16 }: IconProps): ReactElement {
  return (
    <Glyph size={size}>
      <circle cx="8" cy="9" r="4.75" />
      <path d="M8 6.5V9l1.75 1.25M6.5 1.75h3M8 1.75v2.5" />
    </Glyph>
  );
}

/** A note with a folded corner — the note under a row. */
export function NoteIcon({ size = 16 }: IconProps): ReactElement {
  return (
    <Glyph size={size}>
      <path d="M3 3.5h10v6.5L10 13H3z" />
      <path d="M13 10h-3v3" />
    </Glyph>
  );
}

/** A cross — close. */
export function CloseIcon({ size = 16 }: IconProps): ReactElement {
  return (
    <Glyph size={size}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Glyph>
  );
}

/** A folder — a session's start folder. */
export function FolderIcon({ size = 16 }: IconProps): ReactElement {
  return (
    <Glyph size={size}>
      <path d="M2 4.5c0-.6.4-1 1-1h3.2l1.5 1.5H13c.6 0 1 .4 1 1v6c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1z" />
    </Glyph>
  );
}

/** An "i" in a circle — a note about the session. */
export function InfoIcon({ size = 16 }: IconProps): ReactElement {
  return (
    <Glyph size={size}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.25V11M8 5v.01" />
    </Glyph>
  );
}

/** A triangle with "!" — a change that did not go through. */
export function WarningIcon({ size = 16 }: IconProps): ReactElement {
  return (
    <Glyph size={size}>
      <path d="M8 2.5l6 10.5H2z" />
      <path d="M8 6.5v3M8 11.25v.01" />
    </Glyph>
  );
}

/** A tick — checked. */
export function CheckIcon({ size = 16, stroke }: MarkProps): ReactElement {
  return (
    <Glyph size={size} stroke={stroke}>
      <path d="M3.5 8.5l3 3 6-7" />
    </Glyph>
  );
}

/** A dash — some of the rows checked. */
export function MixedIcon({ size = 16, stroke }: MarkProps): ReactElement {
  return (
    <Glyph size={size} stroke={stroke}>
      <path d="M4 8h8" />
    </Glyph>
  );
}

/** Three dots — a row's menu. */
export function MoreIcon({ size = 16 }: IconProps): ReactElement {
  return (
    <Glyph size={size}>
      <circle cx="3.5" cy="8" r=".6" fill="currentColor" />
      <circle cx="8" cy="8" r=".6" fill="currentColor" />
      <circle cx="12.5" cy="8" r=".6" fill="currentColor" />
    </Glyph>
  );
}
