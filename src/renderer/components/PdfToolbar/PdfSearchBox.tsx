// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-12

import { SEARCH_SUGGESTIONS_LIMIT } from '@shared/constants';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { AddressSuggestionItem } from '@shared/ipc-contract';
import type { BookmarkState } from '@shared/tab-state';
import { useAnimatedPlaceholder } from '../../hooks/useAnimatedPlaceholder';
import { useHistorySuggestions } from '../../hooks/useHistorySuggestions';
import { rankSuggestions } from '../../lib/suggestionRanking';

interface PdfSearchBoxProps {
  /** Which files it searches: PDFs (the default) or Markdown notes — the same box, with its own history and wording. */
  readonly kind?: 'pdf' | 'markdown';
  /** The bookmarked files to search — matched against each one's name and path. */
  readonly bookmarks: readonly BookmarkState[];
  /** Opens the bookmarked PDF in this tab. */
  readonly onOpen: (bookmarkId: string) => void;
  /** Opens a PDF from the history, by its path, in this tab. */
  readonly onOpenPath: (path: string) => void;
}

/** Every match, up to a generous limit: the dropdown scrolls through them. */
const MAX_SUGGESTIONS = SEARCH_SUGGESTIONS_LIMIT;

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
export function PdfSearchBox({ kind = 'pdf', bookmarks, onOpen, onOpenPath }: PdfSearchBoxProps) {
  const [draft, setDraft] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  // -1: no row highlighted until Down moves into the list, so Enter never opens the first one unasked.
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [dropdownRect, setDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLFormElement>(null);

  // Ctrl+/ (menu accelerator, see buildMenu.ts) jumps to the address bar on a browser tab; here it
  // lands in this box instead, since an empty PDF tab shows this where a browser tab shows that.
  useEffect(() => window.portalogia.onFocusAddressBar(() => inputRef.current?.focus()), []);

  const query = draft.trim().toLowerCase();
  // Open as soon as the box is focused, like the address bar's once typing starts: with nothing typed yet, it lists
  // every bookmarked and recently opened file, for an empty tab is here to pick one.
  const recentPdfs = useHistorySuggestions(kind, draft, isFocused, true);
  // The bookmarked files whose name matches come first, then those matching only by path, then the files most
  // recently opened the same way (`rankSuggestions`) — all capped at `MAX_SUGGESTIONS`. Nothing typed lists all.
  const suggestions = useMemo(
    (): readonly AddressSuggestionItem[] =>
      rankSuggestions(
        [...bookmarks].reverse().map((bookmark) => ({ id: bookmark.id, title: bookmark.title, url: bookmark.path ?? bookmark.url })),
        recentPdfs.map((file) => ({ id: `history:${file.url}`, title: file.title, url: file.url })),
        query,
        MAX_SUGGESTIONS,
        // Paths compare without regard to case, as on Windows.
        (path) => path.toLowerCase(),
      ),
    [bookmarks, query, recentPdfs],
  );

  const isDropdownOpen = isFocused && suggestions.length > 0;
  const clampedIndex = Math.min(selectedIndex, suggestions.length - 1);
  // The list the overlay was last given, which a click's index refers into.
  const shownRef = useRef<readonly AddressSuggestionItem[]>([]);

  // Measured fresh each time the dropdown opens, and on window resize while it's open.
  useLayoutEffect(() => {
    if (!isDropdownOpen) {
      setDropdownRect(null);
      return;
    }
    const updateRect = (): void => {
      // The whole file bar it sits in, not just the box: the dropdown hangs from the bar, as the address bar's does.
      const anchor = containerRef.current?.closest('.file-bar') ?? containerRef.current;
      const rect = anchor?.getBoundingClientRect();
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
      window.portalogia.syncAddressSuggestions({ open: false, rect: null, suggestions: [], selectedIndex: 0 });
      return;
    }
    shownRef.current = suggestions;
    window.portalogia.syncAddressSuggestions({
      open: true,
      rect: { top: dropdownRect.top + DROPDOWN_GAP_PX, left: dropdownRect.left, width: dropdownRect.width },
      suggestions,
      selectedIndex: clampedIndex,
    });
  }, [isDropdownOpen, dropdownRect, suggestions, clampedIndex]);

  // A tab switch while the dropdown is open skips straight to unmount, so close it here too.
  useEffect(
    () => () => {
      window.portalogia.syncAddressSuggestions({ open: false, rect: null, suggestions: [], selectedIndex: 0 });
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

  // A row clicked in the overlay's own view reports back by index. Pressing it moves the keyboard to the overlay,
  // blurring this box, and the blur clears the history's matches — so by the time the index arrives the list here can
  // have changed. It's resolved against the list the overlay was last given (`shownRef`), never the current one.
  const openRef = useRef(openSuggestion);
  openRef.current = openSuggestion;
  useEffect(
    () =>
      window.portalogia.onAddressSuggestionSelected((index) => {
        const target = shownRef.current[index];
        if (target) {
          openRef.current(target);
        }
      }),
    [],
  );

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
      // Up from the first row goes back to the box itself.
      setSelectedIndex((index) => Math.max(index - 1, -1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = suggestions[clampedIndex];
      if (target) {
        openSuggestion(target);
      }
    }
  };

  // Types itself in once, then its trailing dots loop — the same animation as the address bar's.
  const label = kind === 'pdf' ? "PDF's" : 'notes';
  const placeholder = useAnimatedPlaceholder(draft === '', `Search ${label}`);

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
          setSelectedIndex(-1);
        }}
        onFocus={() => {
          setIsFocused(true);
          setSelectedIndex(-1);
        }}
        onBlur={() => setIsFocused(false)}
        onKeyDown={handleKeyDown}
        aria-label={`Search ${label}...`}
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
