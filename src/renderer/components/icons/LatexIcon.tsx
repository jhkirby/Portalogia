// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-03

interface LatexIconProps {
  /** Edge length in px — the same default as the other tool icons. */
  readonly size?: number;
}

/** A capital sigma: the LaTeX block formatting button. */
export function LatexIcon({ size = 16 }: LatexIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6V4H6l7 8-7 8h12v-2" />
    </svg>
  );
}
