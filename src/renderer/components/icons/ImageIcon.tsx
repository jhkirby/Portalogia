// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-21

interface ImageIconProps {
  /** Edge length in px — the same default as the other tool icons. */
  readonly size?: number;
}

/** A framed landscape: the picture button. */
export function ImageIcon({ size = 16 }: ImageIconProps) {
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
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
      <circle cx="9" cy="9.5" r="1.6" />
      <path d="M20.5 16l-5-5-9 8.5" />
    </svg>
  );
}
