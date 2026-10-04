// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-04

interface CropIconProps {
  /** Edge length in px — matches the other tool icons' default so it sits at the same visual size in `PageActions`' toolbar. */
  readonly size?: number;
}

/** The classic crop mark (two offset L-shaped corners) — `PageActions`' toolbar button for the PDF crop tool. */
export function CropIcon({ size = 16 }: CropIconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path
        d="M7 2v15a1 1 0 0 0 1 1h14M2 7h15a1 1 0 0 1 1 1v14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
