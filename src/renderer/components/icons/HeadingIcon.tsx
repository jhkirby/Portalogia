// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-21

interface HeadingIconProps {
  /** Edge length in px — the same default as the other tool icons. */
  readonly size?: number;
}

/** A capital H with a size tick: the Heading button. */
export function HeadingIcon({ size = 16 }: HeadingIconProps) {
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
      <path d="M5 5v14M14 5v14M5 12h9" />
      <path d="M17.5 14.5l2-1.5v6" />
    </svg>
  );
}
