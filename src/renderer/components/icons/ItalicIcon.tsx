// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-03

interface ItalicIconProps {
  /** Edge length in px — the same default as the other tool icons. */
  readonly size?: number;
}

/** A slanted "I": the Italic formatting button. */
export function ItalicIcon({ size = 16 }: ItalicIconProps) {
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
      <path d="M10 5h8M6 19h8M14 5l-4 14" />
    </svg>
  );
}
