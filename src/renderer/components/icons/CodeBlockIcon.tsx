// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-03

interface CodeBlockIconProps {
  /** Edge length in px — the same default as the other tool icons. */
  readonly size?: number;
}

/** Curly braces: the code block formatting button. */
export function CodeBlockIcon({ size = 16 }: CodeBlockIconProps) {
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
      <path d="M9 4H8a2 2 0 0 0-2 2v3.5a2.5 2.5 0 0 1-2.5 2.5A2.5 2.5 0 0 1 6 14.5V18a2 2 0 0 0 2 2h1M15 4h1a2 2 0 0 1 2 2v3.5a2.5 2.5 0 0 0 2.5 2.5 2.5 2.5 0 0 0-2.5 2.5V18a2 2 0 0 1-2 2h-1" />
    </svg>
  );
}
