// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-27

interface PenIconProps {
  /** Edge length in px — matches `LaserPointerIcon`/`HighlighterIcon`'s own default so it sits at the same visual size in `PageActions`' toolbar. */
  readonly size?: number;
}

/** A pen nib drawing a diagonal stroke — `PageActions`' toolbar button for toggling the pen tool. */
export function PenIcon({ size = 16 }: PenIconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path
        d="M4 20 5.1 15.9 15.5 5.5a1.7 1.7 0 0 1 2.4 0l.6.6a1.7 1.7 0 0 1 0 2.4L8.1 18.9 4 20Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="m14.3 6.7 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M4 20 5.1 15.9 8.1 18.9Z" fill="currentColor" />
    </svg>
  );
}
