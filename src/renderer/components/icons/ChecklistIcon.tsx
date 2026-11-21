// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-21

interface ChecklistIconProps {
  /** Edge length in px — the same default as the other tool icons. */
  readonly size?: number;
}

/** Two ticked boxes and a line each: the checklist button. */
export function ChecklistIcon({ size = 16 }: ChecklistIconProps) {
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
      <rect x="3.5" y="4.5" width="5" height="5" rx="1" />
      <path d="M4.8 7l1.2 1.2 2.2-2.4" />
      <rect x="3.5" y="14.5" width="5" height="5" rx="1" />
      <path d="M11.5 7h9M11.5 17h9" />
    </svg>
  );
}
