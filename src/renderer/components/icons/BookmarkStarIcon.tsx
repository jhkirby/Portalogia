// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-24

/** A four-pointed star/sparkle, straight-edged rather than curved-edged so it reads clearly at small sizes. Shared by both the filled (bookmarked) and outline (not bookmarked) states below — only the fill/stroke differ. */
const STAR_PATH = 'M12 2.5 L14.6 9.4 L21.5 12 L14.6 14.6 L12 21.5 L9.4 14.6 L2.5 12 L9.4 9.4 Z';

interface BookmarkStarIconProps {
  /** Filled (already bookmarked) vs. outline (not bookmarked). */
  readonly filled: boolean;
  /** Edge length in px — both `PageActions`' toolbar button and the address bar's suggestion rows use this at different sizes. */
  readonly size?: number;
}

/** A bookmarked-page indicator — used by `PageActions`' toolbar button and by each row of the address bar's bookmark-suggestions dropdown. */
export function BookmarkStarIcon({ filled, size = 16 }: BookmarkStarIconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path
        d={STAR_PATH}
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={filled ? 0 : 1.6}
        strokeLinejoin="round"
      />
    </svg>
  );
}
