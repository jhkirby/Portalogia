// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

interface ReloadIconProps {
  /** Edge length in px. */
  readonly size?: number;
}

/**
 * A circular arrow — the address bar's reload button. Drawn as a shape rather
 * than typed as the `⟳` character, whose glyph is oversized and sits off-center
 * in the button's hover circle in most fonts.
 */
export function ReloadIcon({ size = 16 }: ReloadIconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <path d="M19.5 12a7.5 7.5 0 1 1-2.3-5.4" />
      <path d="M19.8 3.8v4.6h-4.6" />
    </svg>
  );
}
