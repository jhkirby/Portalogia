// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-03

interface NoteEditIconProps {
  /** Edge length in px — the same default as the other tool icons. */
  readonly size?: number;
}

/** A pencil writing on a line: a note open for editing, in Edit mode (the Tools sidebar's View/Edit button). */
export function NoteEditIcon({ size = 16 }: NoteEditIconProps) {
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
      <path d="M15.5 4.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4L15.5 4.5z" />
      <path d="M13 20h8" />
    </svg>
  );
}
