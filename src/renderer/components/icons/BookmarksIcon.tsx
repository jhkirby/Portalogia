// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-27

interface BookmarksIconProps {
  /** Edge length in px — matches `HistoryIcon`'s default so the two sit at the same size side by side in `PageActions`. */
  readonly size?: number;
}

/**
 * A ribbon bookmark over a second, behind it: a list of bookmarks — `PageActions`' toolbar button for opening a
 * Bookmarks tab, and that tab's icon in the tab strip. A ribbon rather than the star, which marks one page as saved.
 */
export function BookmarksIcon({ size = 16 }: BookmarksIconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path
        d="M9 3.5h8.5a1.5 1.5 0 0 1 1.5 1.5v14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.5 6.5h7a1.5 1.5 0 0 1 1.5 1.5v12.5l-5-3.5-5 3.5V8a1.5 1.5 0 0 1 1.5-1.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}
