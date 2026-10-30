// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { useState } from 'react';
import { formatPointerPosition, usePointerPosition } from '../../hooks/usePointerPosition';

/** The document's text and links, counted once it has loaded; `null` while still counting. */
export interface PdfDocumentStats {
  readonly words: number;
  readonly characters: number;
  readonly links: number;
}

interface PdfStatusBarProps {
  /** The page in view (1-based). */
  readonly page: number;
  readonly pageCount: number;
  /** Counted in the background after the document opens; `null` until then. */
  readonly stats: PdfDocumentStats | null;
  /** The file's size, in bytes, or `null` with no file open. */
  readonly bytes: number | null;
  /** What's selected, counted; `null` while nothing is, which hides those fields. */
  readonly selection: { readonly words: number; readonly characters: number } | null;
  /** Jumps to a page (clamped to the document), as a jump Back can return from. */
  readonly onGoToPage: (page: number) => void;
}

/**
 * The bar along the bottom of a PDF, like a note's: where the pointer is over
 * the page, the page in view (a box
 * you can type a page number into to jump there), then the document's words,
 * characters and links and the file's size in bytes, and while text is
 * selected, its words and characters.
 */
export function PdfStatusBar({ page, pageCount, stats, bytes, selection, onGoToPage }: PdfStatusBarProps) {
  const [draft, setDraft] = useState<string | null>(null);
  // Measured in the framed document, as a web page's is in its own view: blank over the background around it.
  const pointer = usePointerPosition('.pdf-viewer__body');
  const count = (value: number): string => value.toLocaleString();
  const counted = (value: number | undefined, one: string, many: string): string =>
    value === undefined ? `… ${many}` : `${count(value)} ${value === 1 ? one : many}`;

  return (
    <footer className="pdf-status" aria-label="PDF statistics">
      <span className="pdf-status__item pdf-status__pointer" title="Pointer position in the page (x×y, in CSS pixels from its top-left)">
        {formatPointerPosition(pointer)}
      </span>
      <span className="pdf-status__item">
        <input
          type="text"
          inputMode="numeric"
          className="pdf-status__field"
          aria-label="Current page"
          title="Page: type a number and press Enter to jump"
          // No file, no page: a dash, and nothing to type.
          disabled={pageCount === 0}
          value={pageCount === 0 ? '–' : (draft ?? String(page))}
          // Just wide enough for the largest page number, so it sits snug against the "/".
          style={{ width: `${Math.max(2, String(pageCount).length) + 1}ch` }}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setDraft(event.target.value.replace(/\D/g, ''))}
          onBlur={() => setDraft(null)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              const requested = Number.parseInt(draft ?? '', 10);
              setDraft(null);
              if (Number.isFinite(requested)) {
                onGoToPage(Math.min(Math.max(requested, 1), pageCount));
              }
              event.currentTarget.blur();
            } else if (event.key === 'Escape') {
              setDraft(null);
              event.currentTarget.blur();
            }
          }}
        />
        <span className="pdf-status__total">/ {count(pageCount)}</span>
        <span>{pageCount === 1 ? 'page' : 'pages'}</span>
      </span>
      <span className="pdf-status__item">{counted(stats?.words, 'word', 'words')}</span>
      <span className="pdf-status__item">{counted(stats?.characters, 'character', 'characters')}</span>
      <span className="pdf-status__item">{counted(stats?.links, 'link', 'links')}</span>
      <span className="pdf-status__item">{bytes === null ? '… bytes' : `${count(bytes)} bytes`}</span>
      {selection && (
        <span className="pdf-status__selection" aria-label="Selection">
          <span className="pdf-status__item">Selected:</span>
          <span className="pdf-status__item">{counted(selection.words, 'word', 'words')}</span>
          <span className="pdf-status__item">{counted(selection.characters, 'character', 'characters')}</span>
        </span>
      )}
    </footer>
  );
}
