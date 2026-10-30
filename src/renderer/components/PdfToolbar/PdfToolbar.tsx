// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { useState } from 'react';
import type { BookmarkState, PdfTabState } from '@shared/tab-state';
import { formatAltShortcut, formatShortcut } from '../../lib/shortcuts';
import { FileBar } from '../FileBar';
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
  /** Steps back (-1) or forward (1) through the jumps made in the document. */
  readonly onNavigate: (id: string, direction: 1 | -1) => void;
  /** Saves a copy of the open file with its crops, drawings, text boxes and highlights applied. */
  readonly onExport: (id: string) => void;
  /** Closes the open file, leaving the tab empty. */
  readonly onClose: (id: string) => void;
  /** Renames the file on disk; resolves to an error message, or `null` on success. */
  readonly onRename: (id: string, name: string) => Promise<string | null>;
}

/**
 * The PDF tab's controls, shown in the main toolbar where a browser tab has
 * its address bar: Back/Forward through the jumps made in the document
 * (followed links, the page box), Open, Close and Export, and the file bar
 * (`FileBar`): the bookmark star and the file name (an editable text box — or,
 * while no file is open, a search over the bookmarked PDFs), with the file's
 * progress while it opens. The
 * page counter is in the PDF page's own stat bar (`PdfStatusBar`).
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
  onNavigate,
  onExport,
  onClose,
  onRename,
}: PdfToolbarProps) {
  /** Uncommitted text while the name input is being edited; null when not editing. */
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { fileName } = tab;

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
      {/* The browser and note tabs' own back/forward buttons, so every kind of tab reads alike. */}
      <div className="nav-controls">
        <button
          type="button"
          className="nav-controls__button hover-glow chrome-tooltip"
          onClick={() => onNavigate(tab.id, -1)}
          disabled={!tab.canGoBack}
          aria-label="Back"
          data-tooltip={`Back (${formatAltShortcut('←')})`}
        >
          ‹
        </button>
        <button
          type="button"
          className="nav-controls__button hover-glow chrome-tooltip"
          onClick={() => onNavigate(tab.id, 1)}
          disabled={!tab.canGoForward}
          aria-label="Forward"
          data-tooltip={`Forward (${formatAltShortcut('→')})`}
        >
          ›
        </button>
      </div>
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
      <FileBar
        isBookmarked={isBookmarked}
        canBookmark={fileName !== null}
        bookmarkLabel="Bookmark this PDF"
        onToggleBookmark={() => onToggleBookmark(tab.id)}
        loadProgress={tab.loadProgress}
      >
        {/* Before a file is open there's nothing to rename, so the bar is a search over the bookmarked PDFs instead. */}
        {fileName === null ? (
          <PdfSearchBox
            bookmarks={pdfBookmarks}
            onOpen={(bookmarkId) => onOpenBookmark(tab.id, bookmarkId)}
            onOpenPath={(path) => onOpenPdfPath(tab.id, path)}
          />
        ) : (
          <input
            type="text"
            className="file-bar__name"
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
      </FileBar>
      {error && <span className="pdf-toolbar__error">{error}</span>}
    </div>
  );
}
