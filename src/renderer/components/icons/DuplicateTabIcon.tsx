// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-21

interface DuplicateTabIconProps {
  /** Edge length in px. */
  readonly size?: number;
}

/**
 * The duplicate-tab button's icon: a tab (a page with a tab on its top edge)
 * with a second one behind it, offset, and a small plus — a copy being made.
 * Drawn in the split-screen icon's stroke, beside which it sits.
 */
export function DuplicateTabIcon({ size = 16 }: DuplicateTabIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* The copy behind, showing only its top and right edges. */}
      <path d="M8 5V4.5A1.5 1.5 0 0 1 9.5 3h3l1 1.5h5A1.5 1.5 0 0 1 20 6v9.5a1.5 1.5 0 0 1-1.5 1.5H18" />
      {/* The tab in front. */}
      <path d="M4 9.5A1.5 1.5 0 0 1 5.5 8h3l1 1.5h5A1.5 1.5 0 0 1 16 11v8.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 19.5Z" />
      <path d="M10 13.5v4M8 15.5h4" />
    </svg>
  );
}
