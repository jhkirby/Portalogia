// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-04

interface TextBoxIconProps {
  /** Edge length in px — matches the other tool icons' default so it sits at the same visual size in `PageActions`' toolbar. */
  readonly size?: number;
}

/** A "T" in a dashed frame — `PageActions`' toolbar button for the text box tool. */
export function TextBoxIcon({ size = 16 }: TextBoxIconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <rect
        x="2.5"
        y="4.5"
        width="19"
        height="15"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeDasharray="3 2.4"
      />
      <path
        d="M8 9.5h8M12 9.5v6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
