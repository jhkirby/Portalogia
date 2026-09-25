// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-25

interface LaserPointerIconProps {
  /** Edge length in px — matches `BookmarkStarIcon`'s own default so it sits at the same visual size in `PageActions`' toolbar. */
  readonly size?: number;
}

/** A dot with four radiating ticks, read as an aimed laser/target — `PageActions`' toolbar button for toggling the laser pointer overlay. */
export function LaserPointerIcon({ size = 16 }: LaserPointerIconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <line x1="12" y1="2.5" x2="12" y2="6.4" />
        <line x1="12" y1="17.6" x2="12" y2="21.5" />
        <line x1="2.5" y1="12" x2="6.4" y2="12" />
        <line x1="17.6" y1="12" x2="21.5" y2="12" />
      </g>
    </svg>
  );
}
