// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-05

interface HistoryIconProps {
  /** Edge length in px — matches the other tool icons' default so it sits at the same visual size in `PageActions`' toolbar. */
  readonly size?: number;
}

/** A clock face with its hands — `PageActions`' toolbar button for opening a History tab, and that tab's icon in the tab strip. */
export function HistoryIcon({ size = 16 }: HistoryIconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 7v5l3.5 2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
