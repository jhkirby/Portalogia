// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-05

interface FindIconProps {
  /** Edge length in px — matches the other tool icons' default so it sits at the same visual size in `PageActions`' toolbar. */
  readonly size?: number;
}

/** A magnifying glass over lines of text — `PageActions`' toolbar button for the find bar (find *in* the page, as opposed to the tab search's plain glyph). */
export function FindIcon({ size = 16 }: FindIconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d="M3 5h9M3 9.5h5M3 14h4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="14.5" cy="12" r="5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="m18.3 15.8 3.2 3.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
