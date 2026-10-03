// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-02

import { useState } from 'react';
import type { PdfMode, PdfTabState } from '@shared/tab-state';
import { formatShortcut } from '../../lib/shortcuts';

/** Must match `pdfRenameRequestSchema` in main: something, then ".pdf". */
const PDF_NAME_PATTERN = /.\.pdf$/i;

interface PdfToolbarProps {
  readonly tab: PdfTabState;
  readonly onOpen: (id: string) => void;
  readonly onSetMode: (id: string, mode: PdfMode) => void;
  /** Renames the file on disk; resolves to an error message, or `null` on success. */
  readonly onRename: (id: string, name: string) => Promise<string | null>;
}

/**
 * The PDF tab's controls, shown in the main toolbar where a browser tab has
 * its address bar: Open PDF, the file name (a text box in Edit mode), and
 * the View/Edit toggle. The PDF page itself only draws the document.
 * Remount per tab (via `key`) so a draft name never leaks between tabs.
 */
export function PdfToolbar({ tab, onOpen, onSetMode, onRename }: PdfToolbarProps) {
  /** Uncommitted text while the name input is being edited; null when not editing. */
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { fileName, mode } = tab;

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
      <div className="pdf-toolbar__modes" role="group" aria-label="Mode">
        {(['view', 'edit'] as const).map((value) => (
          <button
            key={value}
            type="button"
            className="pdf-toolbar__mode"
            aria-pressed={mode === value}
            onClick={() => onSetMode(tab.id, value)}
          >
            {value === 'view' ? 'View' : 'Edit'}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="pdf-toolbar__button chrome-tooltip"
        onClick={() => onOpen(tab.id)}
        data-tooltip={`Open PDF (${formatShortcut('O')})`}
      >
        Open PDF
      </button>
      {mode === 'edit' && fileName !== null ? (
        <input
          type="text"
          className="pdf-toolbar__file-name pdf-toolbar__file-name--input"
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
      ) : (
        <span className="pdf-toolbar__file-name">{fileName ?? 'No file open'}</span>
      )}
      {error && <span className="pdf-toolbar__error">{error}</span>}
    </div>
  );
}
