// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-18

import type { Theme } from '../../hooks/useTheme';
import { formatShortcut } from '../../lib/shortcuts';

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
        {isBookmarked ? '★' : '☆'}
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
