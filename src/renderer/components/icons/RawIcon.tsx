// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-03

interface RawIconProps {
  /** Edge length in px — the same default as the other tool icons. */
  readonly size?: number;
}

/** Angle brackets around a slash: a note shown as its raw Markdown (the Formatted/Raw button). */
export function RawIcon({ size = 16 }: RawIconProps) {
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
      <path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14" />
    </svg>
  );
}
