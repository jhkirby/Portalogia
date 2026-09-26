// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-25

interface HighlighterIconProps {
  /** Edge length in px — matches `LaserPointerIcon`'s own default so it sits at the same visual size in `PageActions`' toolbar. */
  readonly size?: number;
}

/** A highlighter marker with a colored tip stroke — `PageActions`' toolbar button for toggling the highlighter tool. */
export function HighlighterIcon({ size = 16 }: HighlighterIconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path
        d="M4 20.5h6.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="m9.5 15.5-5 5 2 2 5-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d="M9.7 15.3 15.3 9.7l4 4-5.6 5.6a1 1 0 0 1-1.4 0l-2.6-2.6a1 1 0 0 1 0-1.4Z"
        fill="currentColor"
      />
      <path
        d="m15.3 9.7 4.6-4.6a1.7 1.7 0 0 1 2.4 2.4l-4.6 4.6-2.4-2.4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
