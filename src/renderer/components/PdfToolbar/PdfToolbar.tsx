// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-04

import { useState } from 'react';
import type { PdfTabState } from '@shared/tab-state';
import { formatShortcut } from '../../lib/shortcuts';

/** Must match `pdfRenameRequestSchema` in main: something, then ".pdf". */
const PDF_NAME_PATTERN = /.\.pdf$/i;

interface PdfToolbarProps {
  readonly tab: PdfTabState;
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
 * its address bar: Open PDF, the file name (always an editable text box), the
 * page counter, and Export. The PDF page itself only draws the document.
 * Remount per tab (via `key`) so a draft name never leaks between tabs.
 */
export function PdfToolbar({ tab, onOpen, onGoToPage, onExport, onClose, onRename }: PdfToolbarProps) {
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
        className="pdf-toolbar__button chrome-tooltip"
        onClick={() => onOpen(tab.id)}
        data-tooltip={`Open PDF (${formatShortcut('O')})`}
      >
        Open
      </button>
      <button
        type="button"
        className="pdf-toolbar__button chrome-tooltip"
        onClick={() => onClose(tab.id)}
        disabled={fileName === null}
        data-tooltip="Close the open PDF"
      >
        Close
      </button>
      <button
        type="button"
        className="pdf-toolbar__button chrome-tooltip"
        onClick={() => onExport(tab.id)}
        disabled={fileName === null}
        data-tooltip="Export a copy with crops, drawings, text boxes and highlights"
      >
        Export
      </button>
      {/* Before a file is open there's nothing to rename: it reads "No file open" with no box and can't be focused. */}
      <input
        type="text"
        className={`pdf-toolbar__file-name${fileName === null ? ' pdf-toolbar__file-name--empty' : ''}`}
        aria-label="File name"
        value={nameDraft ?? fileName ?? 'No file open'}
        readOnly={fileName === null}
        tabIndex={fileName === null ? -1 : undefined}
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
      {pageCount > 0 && (
        <div className="pdf-toolbar__pages">
          <input
            type="text"
            inputMode="numeric"
            className="pdf-toolbar__page-input"
            aria-label="Current page"
            value={pageDraft ?? String(page)}
            size={String(pageCount).length}
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
      {error && <span className="pdf-toolbar__error">{error}</span>}
    </div>
  );
}
