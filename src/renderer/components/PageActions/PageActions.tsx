// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-18

import type { Theme } from '../../hooks/useTheme';
import { formatShortcut } from '../../lib/shortcuts';
import { ColorPicker } from '../ColorPicker';
import { BookmarkStarIcon } from '../icons';
import { ZoomControl } from '../ZoomControl';

interface PageActionsProps {
  /** Whether the active tab's URL is already bookmarked. */
  readonly isBookmarked: boolean;
  /** Whether there's an active tab to bookmark — browser-only, unlike `canExportPdf`, since a terminal tab has no URL to bookmark. */
  readonly canActOnPage: boolean;
  /** Whether there's an active tab to export to PDF — unlike `canActOnPage`, true for a terminal tab too (its `WebContentsView` prints its on-screen output same as a browser tab prints its page). */
  readonly canExportPdf: boolean;
  /** Whether there's an active tab to zoom — unlike `canActOnPage`, true for a terminal tab too (zoom isn't browser-only). */
  readonly canZoom: boolean;
  /** The active tab's current zoom, 25–200. */
  readonly zoomPercent: number;
  readonly focusMode: boolean;
  readonly theme: Theme;
  readonly onToggleBookmark: () => void;
  readonly onExportPdf: () => void;
  readonly onNewTerminal: () => void;
  readonly onOpenTabSearch: () => void;
  readonly onZoomOut: () => void;
  readonly onZoomIn: () => void;
  readonly onSetZoom: (percent: number) => void;
  readonly onToggleFocusMode: () => void;
  readonly onToggleTheme: () => void;
}

/** Actions on the current page (bookmark, export, new terminal, search tabs, zoom) plus the window-level Focus Mode and theme toggles. */
export function PageActions({
  isBookmarked,
  canActOnPage,
  canExportPdf,
  canZoom,
  zoomPercent,
  focusMode,
  theme,
  onToggleBookmark,
  onExportPdf,
  onNewTerminal,
  onOpenTabSearch,
  onZoomOut,
  onZoomIn,
  onSetZoom,
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
        disabled={!canExportPdf}
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
      <ZoomControl percent={zoomPercent} canZoom={canZoom} onZoomOut={onZoomOut} onZoomIn={onZoomIn} onSetZoom={onSetZoom} />
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
      <ColorPicker />
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
