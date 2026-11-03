// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-19

interface KeyboardIconProps {
  /** Edge length in px — the same default as the other tool icons. */
  readonly size?: number;
}

/** A keyboard: the edit mode button, which hands the tools' keyboard shortcuts to the page. */
export function KeyboardIcon({ size = 16 }: KeyboardIconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <rect x="2.5" y="6" width="19" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M6 9.5h.01M9.3 9.5h.01M12.6 9.5h.01M15.9 9.5h.01M18 9.5h.01M7.5 12.2h.01M10.8 12.2h.01M14.1 12.2h.01M17.4 12.2h.01"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <path d="M8 15h8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
