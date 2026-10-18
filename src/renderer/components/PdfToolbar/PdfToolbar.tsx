// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-17

import { useState } from 'react';
import type { BookmarkState, PdfTabState } from '@shared/tab-state';
import { formatShortcut } from '../../lib/shortcuts';
import { BookmarkStarIcon } from '../icons';
import { PdfSearchBox } from './PdfSearchBox';

/** Must match `pdfRenameRequestSchema` in main: something, then ".pdf". */
const PDF_NAME_PATTERN = /.\.pdf$/i;

interface PdfToolbarProps {
  readonly tab: PdfTabState;
  /** Whether the open file's path is already bookmarked — drives the star's filled/outline state. */
  readonly isBookmarked: boolean;
  /** Bookmarks the open file (by its path on disk), or removes its bookmark. */
  readonly onToggleBookmark: (id: string) => void;
  /** The bookmarked PDFs, searched by the box an empty tab shows in place of a file name. */
  readonly pdfBookmarks: readonly BookmarkState[];
  /** Opens a bookmarked PDF in the tab. */
  readonly onOpenBookmark: (id: string, bookmarkId: string) => void;
  /** Opens a PDF from the history, by path, in the tab. */
  readonly onOpenPdfPath: (id: string, path: string) => void;
  readonly onOpen: (id: string) => void;
  readonly onGoToPage: (id: string, page: number) => void;
  /** Saves a copy of the open file with its crops, drawings, text boxes and highlights applied. */
  readonly onExport: (id: string) => void;
  /** Closes the open file, leaving the tab empty. */
  readonly onClose: (id: string) => void;
  /** Renames the file on disk; resolves to an error message, or `null` on success. */
  readonly onRename: (id: string, name: string) => Promise<string | null>;
}

/**
 * The PDF tab's controls, shown in the main toolbar where a browser tab has
 * its address bar: the bookmark star, Open, Close and Export, the page
 * counter, and the file name (an editable text
 * box — or, while no file is open, a search over the bookmarked PDFs). The
 * PDF page itself only draws the document.
 * Remount per tab (via `key`) so a draft name never leaks between tabs.
 */
export function PdfToolbar({
  tab,
  isBookmarked,
  onToggleBookmark,
  pdfBookmarks,
  onOpenBookmark,
  onOpenPdfPath,
  onOpen,
  onGoToPage,
  onExport,
  onClose,
  onRename,
}: PdfToolbarProps) {
  /** Uncommitted text while the name input is being edited; null when not editing. */
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  /** Uncommitted text while the page box is being edited; null shows the live page. */
  const [pageDraft, setPageDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { fileName, page, pageCount } = tab;

  const commitPage = (): void => {
    const requested = Number.parseInt(pageDraft ?? '', 10);
    setPageDraft(null);
    if (Number.isNaN(requested)) {
      return;
    }
    const target = Math.min(Math.max(requested, 1), pageCount);
    if (target !== page) {
      onGoToPage(tab.id, target);
    }
  };

  const commitName = (): void => {
    const trimmed = nameDraft?.trim();
    setNameDraft(null);
    if (!trimmed || trimmed === fileName) {
      return;
    }
    if (!PDF_NAME_PATTERN.test(trimmed)) {
      setError('File name must end in .pdf');
      return;
    }
    setError(null);
    void onRename(tab.id, trimmed).then(setError);
  };

  return (
    <div className="pdf-toolbar">
      <button
        type="button"
        className="pdf-toolbar__bookmark hover-grow chrome-tooltip"
        onClick={() => onToggleBookmark(tab.id)}
        disabled={fileName === null}
        aria-pressed={isBookmarked}
        aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark this PDF'}
        data-tooltip={`${isBookmarked ? 'Remove bookmark' : 'Bookmark this PDF'} (${formatShortcut('B')})`}
      >
        <BookmarkStarIcon filled={isBookmarked} size={14} />
      </button>
      <button
        type="button"
        className="pdf-toolbar__button hover-grow chrome-tooltip"
        onClick={() => onOpen(tab.id)}
        data-tooltip={`Open PDF (${formatShortcut('O')})`}
      >
        Open
      </button>
      <button
        type="button"
        className="pdf-toolbar__button hover-grow chrome-tooltip"
        onClick={() => onClose(tab.id)}
        disabled={fileName === null}
        data-tooltip={`Close the open PDF (${formatShortcut('Shift+C')})`}
      >
        Close
      </button>
      <button
        type="button"
        className="pdf-toolbar__button hover-grow chrome-tooltip"
        onClick={() => onExport(tab.id)}
        disabled={fileName === null}
        data-tooltip="Export a copy with crops, drawings, text boxes and highlights"
      >
        Export
      </button>
      {pageCount > 0 && (
        <div className="pdf-toolbar__pages">
          <input
            type="text"
            inputMode="numeric"
            className="pdf-toolbar__page-input"
            aria-label="Current page"
            value={pageDraft ?? String(page)}
            // Just wide enough for the largest page number, so it sits snug against the "/".
            style={{ width: `${String(pageCount).length}ch` }}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setPageDraft(event.target.value.replace(/\D/g, ''))}
            onBlur={commitPage}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              } else if (event.key === 'Escape') {
                setPageDraft(null);
                event.currentTarget.blur();
              }
            }}
          />
          <span className="pdf-toolbar__page-total">/ {pageCount}</span>
        </div>
      )}
      {/* Before a file is open there's nothing to rename, so the slot is a search over the bookmarked PDFs instead. */}
      {fileName === null ? (
        <PdfSearchBox
          bookmarks={pdfBookmarks}
          onOpen={(bookmarkId) => onOpenBookmark(tab.id, bookmarkId)}
          onOpenPath={(path) => onOpenPdfPath(tab.id, path)}
        />
      ) : (
        <input
          type="text"
          className="pdf-toolbar__file-name"
          aria-label="File name"
          value={nameDraft ?? fileName}
          onChange={(event) => setNameDraft(event.target.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            } else if (event.key === 'Escape') {
              setNameDraft(null);
              event.currentTarget.blur();
            }
          }}
        />
      )}
      {error && <span className="pdf-toolbar__error">{error}</span>}
    </div>
  );
}
