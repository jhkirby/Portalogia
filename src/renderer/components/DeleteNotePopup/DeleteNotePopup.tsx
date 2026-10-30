// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { CONFIRM_WORD, acceptConfirmInput } from '../ClearHistoryPopup';

interface DeleteNotePopupProps {
  /** The note's file name, as the toolbar shows it. */
  readonly fileName: string;
  /** A data URL of the tab's last frame, shown blurred behind the popup (see `BookmarkPopup`). */
  readonly previewImage: string | null;
  /** Deletes the note. */
  readonly onConfirm: () => void;
  /** Cancels: the ×, Escape, or a click outside. Nothing is deleted. */
  readonly onClose: () => void;
}

/**
 * The confirmation before a note's Delete button deletes its file: it names
 * the file, and the deletion only happens once "delete" has been typed into
 * its box and Enter pressed — the same as Clear History's (`ClearHistoryPopup`),
 * whose styles it shares.
 */
export function DeleteNotePopup({ fileName, previewImage, onConfirm, onClose }: DeleteNotePopupProps) {
  const [typed, setTyped] = useState('');
  const isConfirmed = typed === CONFIRM_WORD;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (isConfirmed) {
        onConfirm();
      }
    }
  };

  return (
    <div className="bookmark-popup__backdrop" onClick={onClose}>
      {previewImage && <img className="bookmark-popup__preview" src={previewImage} alt="" aria-hidden="true" />}
      <div className="bookmark-popup__scrim" aria-hidden="true" />
      <div
        className="bookmark-popup"
        role="dialog"
        aria-label="Delete note"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="bookmark-popup__header">
          <h2 className="bookmark-popup__title">Delete {fileName}?</h2>
          <button type="button" className="bookmark-popup__close hover-grow" onClick={onClose} aria-label="Cancel">
            ×
          </button>
        </div>

        <label className="bookmark-popup__field">
          <span className="bookmark-popup__label">The file goes to the Recycle Bin, and its marks are removed.</span>
          <input
            autoFocus
            // Red once the word is spelled out: Enter will now delete.
            className={`bookmark-popup__input clear-history__confirm${isConfirmed ? ' clear-history__confirm--ready' : ''}`}
            value={typed}
            placeholder={CONFIRM_WORD}
            // Typing or pasting alike: only the characters that spell the word, in order, are kept.
            onChange={(event: ChangeEvent<HTMLInputElement>) => setTyped(acceptConfirmInput(typed, event.target.value))}
            spellCheck={false}
            autoComplete="off"
            aria-label="Type delete to confirm"
          />
        </label>
      </div>
    </div>
  );
}
