// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-12

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { looksLikeUrl } from '@shared/url';

interface AddressBarProps {
  /** The active tab's current URL; used to keep the field in sync with navigation. */
  readonly url: string;
  readonly isLoading: boolean;
  /** Called with the raw typed text on submit; normalization happens on the main-process side. */
  readonly onNavigate: (input: string) => void;
}

/**
 * The unified address/search bar. Kept as local, editable "draft" state
 * distinct from the `url` prop so the user's typing is never clobbered by
 * state pushes — the draft is only resynced from `url` while the field
 * isn't focused (e.g. after the page navigates on its own, or a link was
 * clicked in-page). Shows a search or a globe glyph depending on whether
 * the current draft would navigate or search, so it reads as one
 * "search-or-go" box the way other browsers' omniboxes do.
 */
export function AddressBar({ url, isLoading, onNavigate }: AddressBarProps) {
  const [draft, setDraft] = useState(url);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setDraft(url);
    }
  }, [url]);

  // Ctrl+/ (menu accelerator, see buildMenu.ts) jumps here regardless of
  // which tab's WebContentsView currently has focus; `onFocus` below
  // already selects the text once it lands.
  useEffect(() => window.northstar.onFocusAddressBar(() => inputRef.current?.focus()), []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onNavigate(draft);
    inputRef.current?.blur();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      setDraft(url);
      inputRef.current?.blur();
    }
  };

  const isUrl = draft.trim().length > 0 && looksLikeUrl(draft);

  return (
    <form className="address-bar" onSubmit={handleSubmit} role="search">
      {isLoading ? (
        <span className="address-bar__spinner" aria-hidden="true" />
      ) : (
        <span className="address-bar__icon" aria-hidden="true">
          {draft.trim() ? (isUrl ? '⊙' : '⌕') : '⌕'}
        </span>
      )}
      <input
        ref={inputRef}
        className="address-bar__input"
        type="text"
        inputMode="url"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={handleKeyDown}
        aria-label="Search the internet..."
        placeholder="Search the internet..."
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />
    </form>
  );
}
