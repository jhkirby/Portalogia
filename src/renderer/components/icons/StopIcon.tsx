// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

interface StopIconProps {
  /** Edge length in px. */
  readonly size?: number;
}

/** An X — the address bar's stop button, which takes the reload button's place while a page loads. Same size and weight as `ReloadIcon`, so the two swap without the button looking different. */
export function StopIcon({ size = 16 }: StopIconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}
