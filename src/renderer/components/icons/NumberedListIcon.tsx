// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-21

interface NumberedListIconProps {
  /** Edge length in px — the same default as the other tool icons. */
  readonly size?: number;
}

/** Three numbered lines: the numbered-list button. */
export function NumberedListIcon({ size = 16 }: NumberedListIconProps) {
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
      <path d="M4 5l1.5-1v5M3.8 9h3.2" />
      <path d="M3.8 14.2c.4-.8 2.9-1 2.9.6 0 1.3-2.9 2.4-2.9 3.7h3.1" />
      <path d="M10 6.5h10M10 12h10M10 17.5h10" />
    </svg>
  );
}
