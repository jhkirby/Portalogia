// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-05

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { AddressSuggestionItem } from '@shared/ipc-contract';
import type { BookmarkState } from '@shared/tab-state';
import { useAnimatedPlaceholder } from '../../hooks/useAnimatedPlaceholder';
import { useHistorySuggestions } from '../../hooks/useHistorySuggestions';

interface PdfSearchBoxProps {
  /** The bookmarked PDFs to search — matched against each one's name and path. */
  readonly bookmarks: readonly BookmarkState[];
  /** Opens the bookmarked PDF in this tab. */
  readonly onOpen: (bookmarkId: string) => void;
  /** Opens a PDF from the history, by its path, in this tab. */
  readonly onOpenPath: (path: string) => void;
}

/** The most matches the dropdown shows at once, bookmarks and recently opened PDFs together. */
const MAX_SUGGESTIONS = 10;

/** Vertical gap, in CSS pixels, between the box's own bottom edge and the suggestions overlay below it. */
const DROPDOWN_GAP_PX = 6;

/**
 * The search box an empty PDF tab shows in place of a file name — the
 * counterpart of the address bar for bookmarked PDFs. While focused with a
 * non-empty draft it lists the bookmarks whose name or path match, then the
 * most recently opened PDFs that match (ten at most), Up/Down moves the
 * highlight, and Enter (or a click) opens the highlighted one.
 *
 * The list is drawn by the same dedicated overlay view the address bar's
 * dropdown uses (`SuggestionsOverlay`), for the same reason — it has to sit
 * above the tab's live native view — and is reached the same way: this
 * component measures where it should go and pushes the matches down with
 * `syncAddressSuggestions`. Only one of the two is ever mounted at a time
 * (the toolbar shows one or the other per tab), so they never contend for it.
 */
export function PdfSearchBox({ bookmarks, onOpen, onOpenPath }: PdfSearchBoxProps) {
  const [draft, setDraft] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dropdownRect, setDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLFormElement>(null);

  // Ctrl+/ (menu accelerator, see buildMenu.ts) jumps to the address bar on a browser tab; here it
  // lands in this box instead, since an empty PDF tab shows this where a browser tab shows that.
  useEffect(() => window.northstar.onFocusAddressBar(() => inputRef.current?.focus()), []);

  const query = draft.trim().toLowerCase();
  const recentPdfs = useHistorySuggestions('pdf', draft, isFocused);
  // The bookmarked PDFs that match come first, newest bookmark first; then the PDFs most recently opened that
  // match and aren't already listed as a bookmark — all capped at `MAX_SUGGESTIONS`.
  const suggestions = useMemo((): readonly AddressSuggestionItem[] => {
    if (!query) {
      return [];
    }
    const bookmarkRows = [...bookmarks]
      .reverse()
      .filter(
        (bookmark) =>
          bookmark.title.toLowerCase().includes(query) || (bookmark.path ?? '').toLowerCase().includes(query),
      )
      .map(
        (bookmark): AddressSuggestionItem => ({
          id: bookmark.id,
          title: bookmark.title,
          url: bookmark.path ?? bookmark.url,
          kind: 'bookmark',
        }),
      );
    // Paths compare without regard to case, as on Windows.
    const bookmarkedPaths = new Set(bookmarkRows.map((row) => row.url.toLowerCase()));
    const recentRows = recentPdfs
      .filter((pdf) => !bookmarkedPaths.has(pdf.url.toLowerCase()))
      .map((pdf): AddressSuggestionItem => ({ id: `history:${pdf.url}`, title: pdf.title, url: pdf.url, kind: 'history' }));
    return [...bookmarkRows, ...recentRows].slice(0, MAX_SUGGESTIONS);
  }, [bookmarks, query, recentPdfs]);

  const isDropdownOpen = isFocused && suggestions.length > 0;
  const clampedIndex = suggestions.length === 0 ? 0 : Math.min(selectedIndex, suggestions.length - 1);

  // Measured fresh each time the dropdown opens, and on window resize while it's open.
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

  // Pushes the dropdown's current state to its overlay on every change. A row shows the file's path where a page shows its URL.
  useEffect(() => {
    if (!isDropdownOpen || !dropdownRect) {
      window.northstar.syncAddressSuggestions({ open: false, rect: null, suggestions: [], selectedIndex: 0 });
      return;
    }
    window.northstar.syncAddressSuggestions({
      open: true,
      rect: { top: dropdownRect.top + DROPDOWN_GAP_PX, left: dropdownRect.left, width: dropdownRect.width },
      suggestions,
      selectedIndex: clampedIndex,
    });
  }, [isDropdownOpen, dropdownRect, suggestions, clampedIndex]);

  // A tab switch while the dropdown is open skips straight to unmount, so close it here too.
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

  const openSuggestion = (suggestion: AddressSuggestionItem): void => {
    if (suggestion.kind === 'history') {
      onOpenPath(suggestion.url);
    } else {
      onOpen(suggestion.id);
    }
    setDraft('');
    closeDropdown();
  };

  // A row clicked in the overlay's own view reports back by index; re-subscribed as the matches change so it resolves against the list actually shown.
  useEffect(() => {
    return window.northstar.onAddressSuggestionSelected((index) => {
      const target = suggestions[index];
      if (target) {
        openSuggestion(target);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `openSuggestion` closes over stable setters and a callback fixed per mounted tab; re-subscribing on every render would buy nothing.
  }, [suggestions]);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      setDraft('');
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
        openSuggestion(target);
      }
    }
  };

  // Types itself in once, then its trailing dots loop — the same animation as the address bar's.
  const placeholder = useAnimatedPlaceholder(draft === '', "Search PDF's");

  return (
    <form
      ref={containerRef}
      className="pdf-search"
      role="search"
      onSubmit={(event: FormEvent<HTMLFormElement>) => event.preventDefault()}
    >
      <input
        ref={inputRef}
        className="pdf-search__input"
        type="text"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setSelectedIndex(0);
        }}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        onKeyDown={handleKeyDown}
        aria-label="Search PDF's..."
        role="combobox"
        aria-expanded={isDropdownOpen}
        aria-autocomplete="list"
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />
    </form>
  );
}
