// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

interface GlobeIconProps {
  /** Edge length in px. */
  readonly size?: number;
}

/** A globe — the tab strip's marker for a browser tab, as `>_` marks a terminal and `PDF` a PDF. */
export function GlobeIcon({ size = 16 }: GlobeIconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <ellipse cx="12" cy="12" rx="3.8" ry="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 9h17M3.5 15h17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
