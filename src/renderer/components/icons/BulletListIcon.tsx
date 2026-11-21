// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-21

interface BulletListIconProps {
  /** Edge length in px — the same default as the other tool icons. */
  readonly size?: number;
}

/** Three bulleted lines: the bulleted-list button. */
export function BulletListIcon({ size = 16 }: BulletListIconProps) {
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
      <circle cx="5" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="5" cy="17.5" r="1.2" fill="currentColor" stroke="none" />
      <path d="M9.5 6.5h10M9.5 12h10M9.5 17.5h10" />
    </svg>
  );
}
