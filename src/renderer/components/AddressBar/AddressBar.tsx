// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-24

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { BookmarkState } from '@shared/tab-state';
import { looksLikeUrl } from '@shared/url';
import { BookmarkStarIcon } from '../icons';

interface AddressBarProps {
  /** The active tab's current URL; used to keep the field in sync with navigation. */
  readonly url: string;
  readonly isLoading: boolean;
  /** Called with the raw typed text on submit; normalization happens on the main-process side. */
  readonly onNavigate: (input: string) => void;
  /** Every saved bookmark, filtered locally against the draft to power the suggestions dropdown. */
  readonly bookmarks: readonly BookmarkState[];
  /** The active tab — needed to hide/restore its native view while the dropdown is open; `null` only briefly during startup, before this bar would even be focusable. */
  readonly activeTabId: string | null;
  /** Hides the active tab's `WebContentsView` so the dropdown can render over it — see `TabManager.beginTabPreview`. */
  readonly onBeginTabPreview: (id: string) => Promise<string | null>;
  /** Re-shows the view `onBeginTabPreview` hid. */
  readonly onEndTabPreview: (id: string) => void;
}

/** How many bookmark suggestions to show at once — the dropdown scrolls internally past this rather than growing without bound. */
const MAX_SUGGESTIONS = 8;

/**
 * The unified address/search bar. Kept as local, editable "draft" state
 * distinct from the `url` prop so the user's typing is never clobbered by
 * state pushes — the draft is only resynced from `url` while the field
 * isn't focused (e.g. after the page navigates on its own, or a link was
 * clicked in-page). Shows a search or a globe glyph depending on whether
 * the current draft would navigate or search, so it reads as one
 * "search-or-go" box the way other browsers' omniboxes do.
 *
 * While focused with a non-empty draft that matches at least one
 * bookmark, also shows those matches as a dropdown below the field —
 * Up/Down moves the highlight, Enter (or a click) navigates to the
 * highlighted one instead of submitting the typed text. The dropdown has
 * to render over the tab's own content area, which — unlike the rest of
 * this chrome — is a separate native `WebContentsView` layered above it,
 * so showing it means hiding that view for as long as the dropdown stays
 * open (see `onBeginTabPreview`), the same mechanism `BookmarkPopup` uses.
 *
 * The dropdown itself is portaled to `document.body` rather than rendered
 * as a normal child here: `.app` (App.tsx's outermost chrome wrapper)
 * pins itself to a fixed height with `overflow: hidden` so Focus Mode's
 * slide-away animation has something to clip against, and this bar lives
 * inside it — a dropdown extending below the toolbar would just get
 * silently clipped away by that same rule. Escaping to `document.body`
 * and positioning it with `position: fixed` off this bar's own measured
 * `getBoundingClientRect()` (see the layout effect below) sidesteps that
 * without touching `.app`'s clipping, which Focus Mode still needs.
 */
export function AddressBar({
  url,
  isLoading,
  onNavigate,
  bookmarks,
  activeTabId,
  onBeginTabPreview,
  onEndTabPreview,
}: AddressBarProps) {
  const [draft, setDraft] = useState(url);
  const [isFocused, setIsFocused] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dropdownRect, setDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setDraft(url);
    }
  }, [url]);

  // Ctrl+/ (menu accelerator, see buildMenu.ts) jumps here regardless of
  // which tab's WebContentsView currently has focus; `onFocus` below
  // already selects the text once it lands.
  useEffect(() => window.northstar.onFocusAddressBar(() => inputRef.current?.focus()), []);

  const query = draft.trim().toLowerCase();
  const suggestions = useMemo(() => {
    if (!query) {
      return [];
    }
    return bookmarks
      .filter(
        (bookmark) => bookmark.title.toLowerCase().includes(query) || bookmark.url.toLowerCase().includes(query),
      )
      .slice(0, MAX_SUGGESTIONS);
  }, [bookmarks, query]);

  const isDropdownOpen = isFocused && suggestions.length > 0;
  const clampedIndex = suggestions.length === 0 ? 0 : Math.min(selectedIndex, suggestions.length - 1);

  // Only re-runs on the dropdown's own open/closed transition (or a tab
  // switch, though this component remounts per-tab anyway — see its `key`
  // in App.tsx), never per keystroke while it's already open: `isDropdownOpen`
  // only flips when the match count crosses zero, not on every character
  // typed while matches already exist.
  useEffect(() => {
    if (!isDropdownOpen || !activeTabId) {
      return;
    }
    const id = activeTabId;
    void onBeginTabPreview(id);
    return () => onEndTabPreview(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `onBeginTabPreview`/`onEndTabPreview` are stable (empty-deps useCallback in useTabs.ts); only the open/closed transition and which tab should re-run this.
  }, [isDropdownOpen, activeTabId]);

  // Measured fresh each time the dropdown opens (and on window resize while
  // it's open) — see this component's own doc comment for why it's
  // positioned this way instead of as a normal descendant.
  useLayoutEffect(() => {
    if (!isDropdownOpen) {
      setDropdownRect(null);
      return;
    }
    const updateRect = (): void => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        setDropdownRect({ top: rect.bottom, left: rect.left, width: rect.width });
      }
    };
    updateRect();
    window.addEventListener('resize', updateRect);
    return () => window.removeEventListener('resize', updateRect);
  }, [isDropdownOpen]);

  const closeDropdown = (): void => {
    setIsFocused(false);
    inputRef.current?.blur();
  };

  const selectBookmark = (bookmark: BookmarkState): void => {
    onNavigate(bookmark.url);
    setDraft(bookmark.url);
    closeDropdown();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onNavigate(draft);
    inputRef.current?.blur();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      setDraft(url);
      closeDropdown();
      return;
    }
    if (!isDropdownOpen) {
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((index) => Math.min(index + 1, suggestions.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = suggestions[clampedIndex];
      if (target) {
        selectBookmark(target);
      }
    }
  };

  const isUrl = draft.trim().length > 0 && looksLikeUrl(draft);

  return (
    <form ref={containerRef} className="address-bar" onSubmit={handleSubmit} role="search">
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
        onChange={(event) => {
          setDraft(event.target.value);
          setSelectedIndex(0);
        }}
        onFocus={(event) => {
          event.currentTarget.select();
          setIsFocused(true);
        }}
        // Dropdown rows preventDefault their own `mousedown`, so a click on
        // one never gets here — this only fires for a real "focus went
        // elsewhere" (clicking outside, Tab, a tab switch), which is
        // exactly when the dropdown should close.
        onBlur={() => setIsFocused(false)}
        onKeyDown={handleKeyDown}
        aria-label="Search the internet..."
        role="combobox"
        aria-expanded={isDropdownOpen}
        aria-autocomplete="list"
        aria-controls="address-bar-suggestions"
        placeholder="Search the internet..."
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />
      {isDropdownOpen &&
        dropdownRect &&
        createPortal(
          <ul
            id="address-bar-suggestions"
            className="address-bar__suggestions"
            role="listbox"
            style={{ top: dropdownRect.top + 6, left: dropdownRect.left, width: dropdownRect.width }}
          >
            {suggestions.map((bookmark, index) => (
              <li
                key={bookmark.id}
                role="option"
                aria-selected={index === clampedIndex}
                className={`address-bar__suggestion${index === clampedIndex ? ' address-bar__suggestion--selected' : ''}`}
                onMouseEnter={() => setSelectedIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectBookmark(bookmark)}
              >
                <BookmarkStarIcon filled size={13} />
                <span className="address-bar__suggestion-title">{bookmark.title}</span>
                <span className="address-bar__suggestion-url">{bookmark.url}</span>
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </form>
  );
}
