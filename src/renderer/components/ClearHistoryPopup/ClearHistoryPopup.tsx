// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { useState, type ChangeEvent, type KeyboardEvent } from 'react';

/** The word typed to confirm, as it shows (any case may be typed). Shared by every deletion popup. */
export const CONFIRM_WORD = 'DELETE';

interface ClearHistoryPopupProps {
  /** How many visits the range covers: what would be deleted. `null` while it's still being counted. */
  readonly count: number | null;
  /** A data URL of the tab's last frame, shown blurred behind the popup (see `BookmarkPopup`). */
  readonly previewImage: string | null;
  /** Deletes the visits. */
  readonly onConfirm: () => void;
  /** Cancels: the ×, Escape, or a click outside. Nothing is deleted. */
  readonly onClose: () => void;
}

/**
 * Takes what was typed into the confirm box and keeps only what spells the
 * start of the word: each new character counts only if it's the next one the
 * word needs (in either case), so a stray key adds nothing. Deleting (or any
 * other edit) keeps whatever start of the word is left.
 * @param current What the box held.
 * @param typed What it holds after the edit.
 * @param word The word to spell, in capitals: `CONFIRM_WORD` unless a popup asks for another ("REVERT").
 * @returns The box's new text, always a start of the word, in capitals.
 */
export function acceptConfirmInput(current: string, typed: string, word: string = CONFIRM_WORD): string {
  const upper = typed.toUpperCase();
  if (upper.startsWith(current) && upper.length > current.length) {
    let next = current;
    for (const character of upper.slice(current.length)) {
      if (character === word[next.length]) {
        next += character;
      }
    }
    return next;
  }
  let prefix = 0;
  while (prefix < upper.length && upper[prefix] === word[prefix]) {
    prefix += 1;
  }
  return word.slice(0, prefix);
}

/**
 * The confirmation before "Clear History" deletes anything: it says how many
 * visits would go, and the deletion only happens once "delete" has been typed
 * into its box and Enter pressed. Looks like the other
 * popups over the page (`BookmarkPopup`), whose styles it shares.
 */
export function ClearHistoryPopup({ count, previewImage, onConfirm, onClose }: ClearHistoryPopupProps) {
  const [typed, setTyped] = useState('');
  const isConfirmed = typed === CONFIRM_WORD && count !== null && count > 0;

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

  const items = count === null ? '…' : `${count.toLocaleString()} ${count === 1 ? 'item' : 'items'}`;

  return (
    <div className="bookmark-popup__backdrop" onClick={onClose}>
      {previewImage && <img className="bookmark-popup__preview" src={previewImage} alt="" aria-hidden="true" />}
      <div className="bookmark-popup__scrim" aria-hidden="true" />
      <div
        className="bookmark-popup"
        role="dialog"
        aria-label="Clear history"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="bookmark-popup__header">
          <h2 className="bookmark-popup__title">Delete {items} from history?</h2>
          <button type="button" className="bookmark-popup__close hover-grow" onClick={onClose} aria-label="Cancel">
            ×
          </button>
        </div>

        <label className="bookmark-popup__field">
          <input
            autoFocus
            // Red once the word is spelled out: Enter will now delete.
            className={`bookmark-popup__input clear-history__confirm${typed === CONFIRM_WORD ? ' clear-history__confirm--ready' : ''}`}
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
