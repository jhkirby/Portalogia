// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

interface FileOpenIconProps {
  /** Edge length in px. */
  readonly size?: number;
}

/** An open folder — the Tools sidebar's Open (a file from disk). */
export function FileOpenIcon({ size = 16 }: FileOpenIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1" />
      <path d="M3 7v11a1 1 0 0 0 1 1h14.5a1 1 0 0 0 1-.8L21.5 11a1 1 0 0 0-1-1.2H7.2a1 1 0 0 0-1 .8L4 19" />
    </svg>
  );
}
