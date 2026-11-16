// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { acceptConfirmInput } from '../ClearHistoryPopup';

interface ConfirmWordPopupProps {
  /** The question, e.g. "Delete notes.md?" or "Revert annotations?". */
  readonly title: string;
  /** What happens, said once more under the title. */
  readonly detail: string;
  /** The word to type, in capitals ("DELETE", "REVERT"); any case may be typed. */
  readonly word: string;
  /** The dialog's name for assistive technology, e.g. "Delete note". */
  readonly dialogLabel: string;
  /** A data URL of the tab's last frame, shown blurred behind the popup (see `BookmarkPopup`). */
  readonly previewImage: string | null;
  /** Goes ahead. */
  readonly onConfirm: () => void;
  /** Cancels: the ×, Escape, or a click outside. Nothing happens. */
  readonly onClose: () => void;
}

/**
 * The confirmation before something that can't be undone from here: it says
 * what will happen, and it only happens once `word` has been typed into its box
 * and Enter pressed — Clear History's way (`ClearHistoryPopup`), whose styles
 * it shares. A note's Delete asks for "DELETE"; Revert annotations, "REVERT".
 */
export function ConfirmWordPopup({ title, detail, word, dialogLabel, previewImage, onConfirm, onClose }: ConfirmWordPopupProps) {
  const [typed, setTyped] = useState('');
  const isConfirmed = typed === word;

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
        aria-label={dialogLabel}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="bookmark-popup__header">
          <h2 className="bookmark-popup__title">{title}</h2>
          <button type="button" className="bookmark-popup__close hover-grow" onClick={onClose} aria-label="Cancel">
            ×
          </button>
        </div>

        <label className="bookmark-popup__field">
          <span className="bookmark-popup__label">{detail}</span>
          <input
            autoFocus
            // Red once the word is spelled out: Enter will now go ahead.
            className={`bookmark-popup__input clear-history__confirm${isConfirmed ? ' clear-history__confirm--ready' : ''}`}
            value={typed}
            placeholder={word}
            // Typing or pasting alike: only the characters that spell the word, in order, are kept.
            onChange={(event: ChangeEvent<HTMLInputElement>) => setTyped(acceptConfirmInput(typed, event.target.value, word))}
            spellCheck={false}
            autoComplete="off"
            aria-label={`Type ${word.toLowerCase()} to confirm`}
          />
        </label>
      </div>
    </div>
  );
}
