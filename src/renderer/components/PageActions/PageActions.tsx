// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-12

interface PageActionsProps {
  /** Whether the active tab's URL is already bookmarked. */
  readonly isBookmarked: boolean;
  /** Whether there's an active tab to bookmark or export at all. */
  readonly canActOnPage: boolean;
  readonly focusMode: boolean;
  readonly onToggleBookmark: () => void;
  readonly onExportPdf: () => void;
  readonly onNewTerminal: () => void;
  readonly onOpenTabSearch: () => void;
  readonly onToggleFocusMode: () => void;
}

/** Actions on the current page (bookmark, export, new terminal, search tabs) plus the window-level Focus Mode toggle. */
export function PageActions({
  isBookmarked,
  canActOnPage,
  focusMode,
  onToggleBookmark,
  onExportPdf,
  onNewTerminal,
  onOpenTabSearch,
  onToggleFocusMode,
}: PageActionsProps) {
  return (
    <div className="page-actions">
      <button
        type="button"
        className="page-actions__button"
        onClick={onToggleBookmark}
        disabled={!canActOnPage}
        aria-pressed={isBookmarked}
        aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark this page'}
      >
        {isBookmarked ? '★' : '☆'}
      </button>
      <button
        type="button"
        className="page-actions__button page-actions__button--pdf"
        onClick={onExportPdf}
        disabled={!canActOnPage}
        aria-label="Export page to PDF"
      >
        PDF
      </button>
      <button
        type="button"
        className="page-actions__button"
        onClick={onNewTerminal}
        aria-label="New terminal"
      >
        {'>_'}
      </button>
      <button
        type="button"
        className="page-actions__button"
        onClick={onOpenTabSearch}
        aria-label="Search tabs"
      >
        ⌕
      </button>
      <button
        type="button"
        className="page-actions__button"
        onClick={onToggleFocusMode}
        aria-pressed={focusMode}
        aria-label={focusMode ? 'Exit Focus Mode' : 'Enter Focus Mode'}
      >
        ⛶
      </button>
    </div>
  );
}
