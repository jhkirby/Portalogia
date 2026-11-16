// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-26

interface CommentIconProps {
  /** Edge length in px — matches `HighlighterIcon`/`LaserPointerIcon`'s own default so it sits at the same visual size in `PageActions`' toolbar. */
  readonly size?: number;
}

/** A speech bubble — `PageActions`' toolbar button for toggling the comment tool. */
export function CommentIcon({ size = 16 }: CommentIconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path
        d="M3 4.5h16a2 2 0 0 1 2 2V14a2 2 0 0 1-2 2H10l-5 4.5V16H3a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
