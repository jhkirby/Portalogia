// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-21

interface DividerIconProps {
  /** Edge length in px — the same default as the other tool icons. */
  readonly size?: number;
}

/** A rule between two lines of text: the divider button. */
export function DividerIcon({ size = 16 }: DividerIconProps) {
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
      <path d="M4 12h16" strokeWidth="2" />
      <path d="M7 6h10M7 18h10" opacity="0.5" />
    </svg>
  );
}
