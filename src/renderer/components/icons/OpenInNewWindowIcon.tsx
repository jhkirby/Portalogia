// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-27

interface OpenInNewWindowIconProps {
  /** Edge length in px — matches `CommentIcon`/`HighlighterIcon`/`LaserPointerIcon`'s own default so it sits at the same visual size in `PageActions`' toolbar. */
  readonly size?: number;
}

/** A box open at its top-right corner with an arrow pointing out through the gap — `PageActions`' toolbar button for opening the active workspace in a new window. */
export function OpenInNewWindowIcon({ size = 16 }: OpenInNewWindowIconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path
        d="M10 5H5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M13 4h7v7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 4 10 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
