// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

interface SearchIconProps {
  /** Edge length in px — matches the other tool icons' default so it sits at the same visual size in `PageActions`' toolbar. */
  readonly size?: number;
}

/** A plain magnifying glass — `PageActions`' toolbar button for searching the open tabs (the find button's glass has lines of text beside it). */
export function SearchIcon({ size = 16 }: SearchIconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="m15.4 15.4 5.1 5.1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
