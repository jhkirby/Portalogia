// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-17

interface TextSelectIconProps {
  /** Edge length in px — the same default as the other tool icons. */
  readonly size?: number;
}

/** A text cursor (I-beam) — `PdfToolbar`'s Select mode button, for selecting a document's text and clicking its links. */
export function TextSelectIcon({ size = 16 }: TextSelectIconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path
        d="M9 3h1.5A1.5 1.5 0 0 1 12 4.5v15a1.5 1.5 0 0 1-1.5 1.5H9m6-18h-1.5A1.5 1.5 0 0 0 12 4.5v15a1.5 1.5 0 0 0 1.5 1.5H15M9.5 12h5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
