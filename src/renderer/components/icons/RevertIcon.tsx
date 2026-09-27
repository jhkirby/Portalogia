// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-27

interface RevertIconProps {
  /** Edge length in px — matches `CommentIcon`/`HighlighterIcon`/`LaserPointerIcon`'s own default so it sits at the same visual size in `PageActions`' toolbar. */
  readonly size?: number;
}

/** A rounded-corner box with an X touching its corners — `PageActions`' toolbar button for reverting a page's highlights/comments back to none. */
export function RevertIcon({ size = 16 }: RevertIconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4 4 20 20M20 4 4 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
