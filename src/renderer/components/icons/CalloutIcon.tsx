// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-21

interface CalloutIconProps {
  /** Edge length in px — the same default as the other tool icons. */
  readonly size?: number;
}

/** A box with a bar down its side and an "i": the callout button. */
export function CalloutIcon({ size = 16 }: CalloutIconProps) {
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
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M7 4.5v15" />
      <path d="M13.5 9v.01M13.5 12v4" />
    </svg>
  );
}
