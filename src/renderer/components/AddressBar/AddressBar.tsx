// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-24

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { BookmarkState } from '@shared/tab-state';
import { looksLikeUrl } from '@shared/url';
import { pageLabel } from '../../lib/pageLabel';
import { formatShortcut } from '../../lib/shortcuts';
import { BookmarkStarIcon } from '../icons';

interface AddressBarProps {
  /** The active tab's current URL; used to keep the field in sync with navigation. */
  readonly url: string;
  readonly isLoading: boolean;
  /** Called with the raw typed text on submit; normalization happens on the main-process side. */
  readonly onNavigate: (input: string) => void;
  /** Every saved bookmark, filtered locally against the draft to power the suggestions dropdown. */
  readonly bookmarks: readonly BookmarkState[];
  /** Whether the active tab's URL is already bookmarked — drives the star's filled/outline state. */
  readonly isBookmarked: boolean;
  /** Whether there's a page to bookmark (a terminal tab has no URL). */
  readonly canBookmark: boolean;
  /** The saved name of the active page's bookmark, or `null` if it isn't bookmarked — shown as a bubble in place of the URL while the field isn't focused (a page that isn't bookmarked gets its domain instead). */
  readonly bookmarkName: string | null;
  /** Called when the star is clicked: bookmarks the page, or removes its bookmark. */
  readonly onToggleBookmark: () => void;
}

/** How many bookmark suggestions to show at once. */
const MAX_SUGGESTIONS = 8;

/** Vertical gap, in CSS pixels, between the address bar's own bottom edge and the suggestions overlay below it. */
const DROPDOWN_GAP_PX = 6;

/**
 * The unified address/search bar. Kept as local, editable "draft" state
 * distinct from the `url` prop so the user's typing is never clobbered by
 * state pushes — the draft is only resynced from `url` while the field
 * isn't focused (e.g. after the page navigates on its own, or a link was
 * clicked in-page). Shows a search or a globe glyph depending on whether
 * the current draft would navigate or search, so it reads as one
 * "search-or-go" box the way other browsers' omniboxes do.
 *
 * While focused with a non-empty draft that matches at least one bookmark,
 * also shows those matches as a dropdown below the field — Up/Down moves
 * the highlight, Enter (or a click) navigates to the highlighted one
 * instead of submitting the typed text. That dropdown isn't rendered here
 * at all, or anywhere in this chrome's own DOM: it lives entirely in its
 * own dedicated `WebContentsView` (`suggestions.html`, see
 * `SuggestionsOverlay` on the main-process side), specifically so the
 * active tab's own view never has to be hidden or frozen just because the
 * dropdown is open — unlike `BookmarkPopup`, a real modal, this dropdown
 * is meant to look like it's simply floating over a page that's still
 * fully live underneath it. This component's job is just to compute the
 * match list and keyboard-selected index, measure where the dropdown
 * should sit, and push both down via `syncAddressSuggestions` — the only
 * channel that connects the two.
 */
export function AddressBar({
  url,
  isLoading,
  onNavigate,
  bookmarks,
  isBookmarked,
  canBookmark,
  bookmarkName,
  onToggleBookmark,
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

  // Measured fresh each time the dropdown opens (and on window resize while
  // it's open) — this is the position the main process sizes and mounts
  // the overlay view at (see the sync effect below), the same values this
  // bar's own portal-based dropdown used to position itself with directly.
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

  // Pushes this bar's current dropdown state to its overlay on every
  // change — open/closed, position, matches, and keyboard selection.
  // Fire-and-forget (see `syncAddressSuggestions`'s own doc comment); the
  // overlay's own view mounts/unmounts and resizes itself in response.
  useEffect(() => {
    if (!isDropdownOpen || !dropdownRect) {
      window.northstar.syncAddressSuggestions({ open: false, rect: null, suggestions: [], selectedIndex: 0 });
      return;
    }
    window.northstar.syncAddressSuggestions({
      open: true,
      rect: { top: dropdownRect.top + DROPDOWN_GAP_PX, left: dropdownRect.left, width: dropdownRect.width },
      suggestions: suggestions.map((bookmark) => ({ id: bookmark.id, title: bookmark.title, url: bookmark.url })),
      selectedIndex: clampedIndex,
    });
  }, [isDropdownOpen, dropdownRect, suggestions, clampedIndex]);

  // Belt-and-suspenders close on unmount (this component remounts per tab
  // — see its `key` in App.tsx) — the effect above already syncs `open:
  // false` on the dropdown's own closed transition, but a tab switch while
  // it's open skips straight to unmount without that transition firing.
  useEffect(
    () => () => {
      window.northstar.syncAddressSuggestions({ open: false, rect: null, suggestions: [], selectedIndex: 0 });
    },
    [],
  );

  const closeDropdown = (): void => {
    setIsFocused(false);
    inputRef.current?.blur();
  };

  const selectBookmark = (bookmark: BookmarkState): void => {
    onNavigate(bookmark.url);
    setDraft(bookmark.url);
    closeDropdown();
  };

  // A row clicked in the overlay's own separate view can't dispatch a
  // normal DOM click here — it reports back over IPC by index instead
  // (see `SuggestionsOverlay`). Re-subscribed whenever `suggestions`
  // changes so the index always resolves against the list the overlay was
  // actually showing when the click happened, rather than a stale closure.
  useEffect(() => {
    return window.northstar.onAddressSuggestionSelected((index) => {
      const target = suggestions[index];
      if (target) {
        selectBookmark(target);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `selectBookmark` closes over stable setters (`onNavigate` is effectively fixed per mounted tab — see this component's own `key` in App.tsx) and would otherwise force a re-subscribe on every render for no benefit.
  }, [suggestions]);

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
  // The idle bubble: a bookmarked page's saved name, else the site's domain.
  const bubbleText = pageLabel(url, bookmarks);
  const savedName = bookmarkName?.trim() ? bookmarkName : null;
  const showBubble = !isFocused && bubbleText !== null;

  return (
    <form ref={containerRef} className="address-bar" onSubmit={handleSubmit} role="search">
      <button
        type="button"
        className="address-bar__bookmark chrome-tooltip"
        onClick={onToggleBookmark}
        disabled={!canBookmark}
        aria-pressed={isBookmarked}
        aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark this page'}
        data-tooltip={`${isBookmarked ? 'Remove bookmark' : 'Bookmark this page'} (${formatShortcut('B')})`}
      >
        <BookmarkStarIcon filled={isBookmarked} size={14} />
      </button>
      {isLoading && <span className="address-bar__spinner" aria-hidden="true" />}
      <span className="address-bar__field">
        <input
          ref={inputRef}
          className={`address-bar__input${showBubble ? ' address-bar__input--hidden' : ''}`}
          type="text"
          inputMode="url"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setSelectedIndex(0);
          }}
          // Deliberately no select-all on focus: the URL stays unhighlighted
          // when the bar is clicked into (it's only ever selected by the user).
          onFocus={() => setIsFocused(true)}
          onBlur={(event) => {
            // Clicking elsewhere clears any selection the user made, or its
            // highlight lingers (visibly, behind the bookmark bubble).
            event.currentTarget.setSelectionRange(0, 0);
            setIsFocused(false);
          }}
          onKeyDown={handleKeyDown}
          aria-label="Search the internet..."
          role="combobox"
          aria-expanded={isDropdownOpen}
          aria-autocomplete="list"
          placeholder="Search the internet..."
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        {/* The URL itself is hidden (transparent text) while the bubble shows, not removed:
            the bubble ignores the mouse, so a click lands on the input, focuses it, and the real URL comes back. */}
        {showBubble && (
          <span
            className={`address-bar__bubble${savedName ? '' : ' address-bar__bubble--domain'}`}
            aria-hidden="true"
          >
            {bubbleText}
          </span>
        )}
      </span>
    </form>
  );
}
