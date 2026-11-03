// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

interface ShieldIconProps {
  /** Edge length in px — matches the other tool icons' default. */
  readonly size?: number;
  /** Draws an x instead of the check: the blocker is off. */
  readonly off?: boolean;
}

/** A shield with a check, or an x when the blocker is off — `PageActions`' toolbar button for the ad blocker. */
export function ShieldIcon({ size = 16, off = false }: ShieldIconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path
        d="M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6L12 3Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d={off ? 'm9.2 9.7 5.6 5.6m0-5.6-5.6 5.6' : 'm8.8 12.2 2.4 2.4 4-4.4'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
