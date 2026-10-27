// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-27

interface LockIconProps {
  /** Edge length in px — matches `BookmarksIcon`'s default so the two sit at the same size side by side in `PageActions`. */
  readonly size?: number;
}

/**
 * A closed padlock: the saved secrets — `PageActions`' toolbar button for opening a Secrets tab, and that tab's icon
 * in the tab strip. Drawn in the same stroke as `BookmarksIcon` beside it.
 */
export function LockIcon({ size = 16 }: LockIconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="5" y="10.5" width="14" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 14.5v2.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
