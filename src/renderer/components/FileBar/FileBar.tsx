// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-12

import type { ReactNode } from 'react';
import type { LoadBytes } from '@shared/tab-state';
import { useFadingProgress, useFadingValue } from '../../hooks/useFadingProgress';
import { formatByteFraction } from '../../lib/formatBytes';
import { formatShortcut } from '../../lib/shortcuts';
import { BookmarkStarIcon } from '../icons';

interface FileBarProps {
  /** Whether the open file is bookmarked — drives the star's filled/outline state. */
  readonly isBookmarked: boolean;
  /** Whether there's a file to bookmark: an empty tab has none. */
  readonly canBookmark: boolean;
  /** What the star says it does when the file isn't bookmarked yet, e.g. "Bookmark this note". */
  readonly bookmarkLabel: string;
  /** Bookmarks the open file, or removes its bookmark. */
  readonly onToggleBookmark: () => void;
  /** How far the file being opened has got, 0-100, or `null` when there's none to show. */
  readonly loadProgress: number | null;
  /** The file's bytes read so far over its size, beside the percentage, or `null`. */
  readonly loadBytes: LoadBytes | null;
  /** What the bar holds after the star: the file name box, or the search an empty tab shows instead. */
  readonly children: ReactNode;
}

/**
 * The PDF and note tabs' counterpart of the browser's address bar, and drawn
 * like it (its `.address-bar` look): the bookmark star at its left end, then
 * the file name box (or, in an empty tab, the search over bookmarked and
 * recent files), stretching across the toolbar up to the page tools. While a
 * file opens, its progress fills the bar from the left, with the percentage at
 * the right end, the way a web page's load does.
 */
export function FileBar({
  isBookmarked,
  canBookmark,
  bookmarkLabel,
  onToggleBookmark,
  loadProgress,
  loadBytes,
  children,
}: FileBarProps) {
  const shownProgress = useFadingProgress(loadProgress);
  const shownBytes = useFadingValue(loadBytes);
  const starLabel = isBookmarked ? 'Remove bookmark' : bookmarkLabel;

  return (
    <div className="address-bar file-bar" aria-busy={loadProgress !== null}>
      {/* The load's progress as the bar's own background, filling it from left to right behind everything in it. */}
      {shownProgress && (
        <span className={`address-bar__progress${shownProgress.leaving ? ' address-bar__progress--leaving' : ''}`} aria-hidden="true">
          <span className="address-bar__progress-fill" style={{ width: `${shownProgress.value}%` }} />
        </span>
      )}
      <button
        type="button"
        className="address-bar__bookmark hover-grow chrome-tooltip"
        onClick={onToggleBookmark}
        disabled={!canBookmark}
        aria-pressed={isBookmarked}
        aria-label={starLabel}
        data-tooltip={`${starLabel} (${formatShortcut('B')})`}
      >
        <BookmarkStarIcon filled={isBookmarked} size={14} />
      </button>
      <span className="address-bar__field">{children}</span>
      {/* The bytes loaded over the bytes to load, just left of the percentage, fading with it. */}
      {shownProgress && shownBytes && shownBytes.value.total > 0 && (
        <span
          className={`address-bar__bytes${shownProgress.leaving ? ' address-bar__progress--leaving' : ''}`}
          aria-label="Bytes loaded"
        >
          {formatByteFraction(shownBytes.value.loaded, shownBytes.value.total)}
        </span>
      )}
      {/* …and the same as a number at the bar's right end, held at 100% for a second once the file has opened. */}
      {shownProgress && (
        <span
          className={`address-bar__percent${shownProgress.leaving ? ' address-bar__progress--leaving' : ''}`}
          role="progressbar"
          aria-label="File loading"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={shownProgress.value}
        >
          {shownProgress.value}%
        </span>
      )}
    </div>
  );
}
