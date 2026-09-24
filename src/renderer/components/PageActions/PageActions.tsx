// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-18

import type { Theme } from '../../hooks/useTheme';
import { formatShortcut } from '../../lib/shortcuts';

/** A four-pointed star/sparkle, straight-edged rather than curved-edged so it reads clearly at 16px. Shared by both the filled (bookmarked) and outline (not bookmarked) states below — only the fill/stroke differ. */
const STAR_PATH = 'M12 2.5 L14.6 9.4 L21.5 12 L14.6 14.6 L12 21.5 L9.4 14.6 L2.5 12 L9.4 9.4 Z';

/** The bookmark button's icon — filled when the page is already bookmarked, outline otherwise. */
function BookmarkStarIcon({ filled }: { readonly filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
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

interface PageActionsProps {
  /** Whether the active tab's URL is already bookmarked. */
  readonly isBookmarked: boolean;
  /** Whether there's an active tab to bookmark or export at all. */
  readonly canActOnPage: boolean;
  readonly focusMode: boolean;
  readonly theme: Theme;
  readonly onToggleBookmark: () => void;
  readonly onExportPdf: () => void;
  readonly onNewTerminal: () => void;
  readonly onOpenTabSearch: () => void;
  readonly onToggleFocusMode: () => void;
  readonly onToggleTheme: () => void;
}

/** Actions on the current page (bookmark, export, new terminal, search tabs) plus the window-level Focus Mode and theme toggles. */
export function PageActions({
  isBookmarked,
  canActOnPage,
  focusMode,
  theme,
  onToggleBookmark,
  onExportPdf,
  onNewTerminal,
  onOpenTabSearch,
  onToggleFocusMode,
  onToggleTheme,
}: PageActionsProps) {
  return (
    <div className="page-actions">
      <button
        type="button"
        className="page-actions__button chrome-tooltip"
        onClick={onToggleBookmark}
        disabled={!canActOnPage}
        aria-pressed={isBookmarked}
        aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark this page'}
        data-tooltip={`${isBookmarked ? 'Remove bookmark' : 'Bookmark this page'} (${formatShortcut('B')})`}
      >
        <BookmarkStarIcon filled={isBookmarked} />
      </button>
      <button
        type="button"
        className="page-actions__button page-actions__button--pdf chrome-tooltip"
        onClick={onExportPdf}
        disabled={!canActOnPage}
        aria-label="Export page to PDF"
        data-tooltip="Export page to PDF"
      >
        PDF
      </button>
      <button
        type="button"
        className="page-actions__button chrome-tooltip"
        onClick={onNewTerminal}
        aria-label="New terminal"
        data-tooltip={`New terminal (${formatShortcut('>')})`}
      >
        {'>_'}
      </button>
      <button
        type="button"
        className="page-actions__button chrome-tooltip"
        onClick={onOpenTabSearch}
        aria-label="Search tabs"
        data-tooltip={`Search tabs (${formatShortcut('K')})`}
      >
        ⌕
      </button>
      <button
        type="button"
        className="page-actions__button chrome-tooltip"
        onClick={onToggleFocusMode}
        aria-pressed={focusMode}
        aria-label={focusMode ? 'Exit Focus Mode' : 'Enter Focus Mode'}
        data-tooltip={`${focusMode ? 'Exit Focus Mode' : 'Enter Focus Mode'} (${formatShortcut('Shift+F')})`}
      >
        ⛶
      </button>
      <button
        type="button"
        className="page-actions__button chrome-tooltip"
        onClick={onToggleTheme}
        aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        data-tooltip={`${theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} (${formatShortcut('D')})`}
      >
        {theme === 'dark' ? '☾︎' : '☀︎'}
      </button>
    </div>
  );
}
