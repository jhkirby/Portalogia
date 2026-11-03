// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-03

interface FormattedIconProps {
  /** Edge length in px — the same default as the other tool icons. */
  readonly size?: number;
}

/** A page of laid-out text, a bold heading over its lines: a note shown formatted (the Formatted/Raw button). */
export function FormattedIcon({ size = 16 }: FormattedIconProps) {
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
      <path d="M5 5h14" strokeWidth="3" />
      <path d="M5 11h14M5 15h14M5 19h9" />
    </svg>
  );
}
