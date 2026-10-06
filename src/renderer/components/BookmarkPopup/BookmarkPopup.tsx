// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import { useState, type KeyboardEvent } from 'react';

interface BookmarkPopupProps {
  /** `'pdf'` and `'markdown'` show the file's path (read-only: it's where the file is, not something to retype) where a page shows its URL. */
  readonly variant?: 'page' | 'pdf' | 'markdown';
  /** The active tab's URL when the popup opened — editable before saving. */
  readonly url: string;
  /** The active tab's title when the popup opened — editable before saving. */
  readonly title: string;
  /** A data URL of the tab's last-painted frame (see `TabManager.beginTabPreview`), shown blurred behind the popup — `null` falls back to a plain scrim. */
  readonly previewImage: string | null;
  /** Commits the bookmark with whatever the two fields hold at the time. */
  readonly onSave: (name: string, url: string) => void;
  /** Cancels — clicking the backdrop, the × button, or Escape all take this path; nothing gets saved. */
  readonly onClose: () => void;
}

/**
 * The "add a bookmark" dialog opened from the toolbar's star button —
 * modeled on Chrome's own bookmark popup, with one deliberate difference:
 * Chrome saves the bookmark immediately and this popup is just an
 * edit/undo surface for it, whereas here nothing is saved until Save is
 * clicked (see `App.tsx`'s `handleToggleBookmark`), so closing any other
 * way is a true cancel rather than an implicit accept.
 *
 * The blurred backdrop is a still image, not the live page — the tab's own
 * `WebContentsView` is a separate native surface layered above the chrome
 * (see `TabManager.beginTabPreview`) and has to come off the window
 * entirely for this popup to be visible or clickable at all, so what's
 * shown here is a snapshot taken the instant the popup opened.
 */
export function BookmarkPopup({
  variant = 'page',
  url: initialUrl,
  title,
  previewImage,
  onSave,
  onClose,
}: BookmarkPopupProps) {
  const isPdf = variant !== 'page';
  const [name, setName] = useState(title);
  const [url, setUrl] = useState(initialUrl);

  const canSave = name.trim().length > 0;

  const handleSave = (): void => {
    if (!canSave) {
      return;
    }
    onSave(name.trim(), url.trim());
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'Enter' && canSave) {
      event.preventDefault();
      handleSave();
    }
  };

  return (
    <div className="bookmark-popup__backdrop" onClick={onClose}>
      {previewImage && <img className="bookmark-popup__preview" src={previewImage} alt="" aria-hidden="true" />}
      <div className="bookmark-popup__scrim" aria-hidden="true" />
      <div
        className="bookmark-popup"
        role="dialog"
        aria-label="Add bookmark"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="bookmark-popup__header">
          <h2 className="bookmark-popup__title">Add bookmark</h2>
          <button type="button" className="bookmark-popup__close" onClick={onClose} aria-label="Cancel">
            ×
          </button>
        </div>

        <label className="bookmark-popup__field">
          <span className="bookmark-popup__label">{isPdf ? 'File path' : 'URL'}</span>
          <input
            className="bookmark-popup__input"
            value={url}
            readOnly={isPdf}
            onChange={(event) => setUrl(event.target.value)}
            spellCheck={false}
          />
        </label>

        <label className="bookmark-popup__field">
          <span className="bookmark-popup__label">Name</span>
          <input
            autoFocus
            className="bookmark-popup__input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Bookmark name"
          />
        </label>

        <div className="bookmark-popup__actions">
          <button type="button" className="bookmark-popup__cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="bookmark-popup__save" onClick={handleSave} disabled={!canSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
