// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

interface FileCloseIconProps {
  /** Edge length in px. */
  readonly size?: number;
}

/** A sheet of paper with a cross on it — the Tools sidebar's Close (the open file, leaving the tab empty). */
export function FileCloseIcon({ size = 16 }: FileCloseIconProps) {
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
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="m9.5 11.5 5 5M14.5 11.5l-5 5" />
    </svg>
  );
}
