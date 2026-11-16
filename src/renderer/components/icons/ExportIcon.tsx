// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-01

interface ExportIconProps {
  /** Edge length in px — matches the other toolbar icons' default so it sits at the same visual size in `PageActions`. */
  readonly size?: number;
}

/** An open-top tray with an arrow rising out of it — `PageActions`' export dropdown button. */
export function ExportIcon({ size = 16 }: ExportIconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path
        d="M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 16V4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="m7.5 8.5 4.5-4.5 4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
