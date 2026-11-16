// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-12

import { SEARCH_SUGGESTIONS_LIMIT } from '@shared/constants';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { AddressSuggestionItem } from '@shared/ipc-contract';
import type { BookmarkState, LoadBytes } from '@shared/tab-state';
import { looksLikeUrl } from '@shared/url';
import { useAnimatedPlaceholder } from '../../hooks/useAnimatedPlaceholder';
import { useFadingProgress, useFadingValue } from '../../hooks/useFadingProgress';
import { formatByteFraction } from '../../lib/formatBytes';
import { useHistorySuggestions } from '../../hooks/useHistorySuggestions';
import { pageLabel } from '../../lib/pageLabel';
import { rankSuggestions } from '../../lib/suggestionRanking';
import { formatShortcut } from '../../lib/shortcuts';
import { BookmarkStarIcon, ReloadIcon, StopIcon } from '../icons';

interface AddressBarProps {
  /** The active tab's current URL; used to keep the field in sync with navigation. */
  readonly url: string;
  readonly isLoading: boolean;
  /** How far the page's load has got, 0-100, or `null` when there's none to show (see `BrowserTabState.loadProgress`). */
  readonly loadProgress: number | null;
  /** The load's bytes so far over the bytes it's loading, beside the percentage, or `null` (see `BrowserTabState.loadBytes`). */
  readonly loadBytes: LoadBytes | null;
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
  /** Whether there's a page to reload (or stop): a web tab. */
  readonly canReload: boolean;
  /** Reloads the page, or stops it while it loads. */
  readonly onReloadOrStop: () => void;
}

/** Every match, up to a generous limit: the dropdown scrolls through them. */
const MAX_SUGGESTIONS = SEARCH_SUGGESTIONS_LIMIT;

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
 * While focused with a non-empty draft that matches a bookmark or a recently
 * reached page (bookmarks first, then the most recent pages, ten at most),
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
  loadProgress,
  loadBytes,
  onNavigate,
  bookmarks,
  isBookmarked,
  canBookmark,
  bookmarkName,
  onToggleBookmark,
  canReload,
  onReloadOrStop,
}: AddressBarProps) {
  const [draft, setDraft] = useState(url);

  // When the load's progress goes (a second after 100%), it fades out rather than vanishing.
  const shownProgress = useFadingProgress(loadProgress);
  const shownBytes = useFadingValue(loadBytes);
  const [isFocused, setIsFocused] = useState(false);
  // -1: no row highlighted, so Enter submits what's typed. Down moves into the list.
  const [selectedIndex, setSelectedIndex] = useState(-1);
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
  // Ctrl+Shift+? empties it as well, for a new search.
  useEffect(
    () =>
      window.portalogia.onFocusAddressBar((clear) => {
        if (clear) {
          setDraft('');
        }
        inputRef.current?.focus();
      }),
    [],
  );

  const query = draft.trim().toLowerCase();
  const recentPages = useHistorySuggestions('url', draft, isFocused);
  // The bookmarks whose name matches come first, then those matching only by URL, then the pages most recently
  // reached the same way (`rankSuggestions`) — all capped at `MAX_SUGGESTIONS`.
  const suggestions = useMemo((): readonly AddressSuggestionItem[] => {
    if (!query) {
      return [];
    }
    return rankSuggestions(
      [...bookmarks].reverse().map((bookmark) => ({ id: bookmark.id, title: bookmark.title, url: bookmark.url })),
      recentPages.map((page) => ({ id: `history:${page.url}`, title: page.title, url: page.url })),
      query,
      MAX_SUGGESTIONS,
    );
  }, [bookmarks, query, recentPages]);

  const isDropdownOpen = isFocused && suggestions.length > 0;
  const clampedIndex = Math.min(selectedIndex, suggestions.length - 1);
  // The list the overlay was last given, which a click's index refers into.
  const shownRef = useRef<readonly AddressSuggestionItem[]>([]);

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

  // Belt-and-suspenders close on unmount (this component remounts per tab
  // — see its `key` in App.tsx) — the effect above already syncs `open:
  // false` on the dropdown's own closed transition, but a tab switch while
  // it's open skips straight to unmount without that transition firing.
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

  const selectSuggestion = (suggestion: AddressSuggestionItem): void => {
    onNavigate(suggestion.url);
    setDraft(suggestion.url);
    closeDropdown();
  };

  // A row clicked in the overlay's own view reports back by index. Pressing it moves the keyboard to the overlay,
  // blurring this box, and the blur clears the history's matches — so by the time the index arrives the list here can
  // have changed. It's resolved against the list the overlay was last given (`shownRef`), never the current one.
  const selectRef = useRef(selectSuggestion);
  selectRef.current = selectSuggestion;
  useEffect(
    () =>
      window.portalogia.onAddressSuggestionSelected((index) => {
        const target = shownRef.current[index];
        if (target) {
          selectRef.current(target);
        }
      }),
    [],
  );

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
      // Up from the first row goes back to the field itself.
      setSelectedIndex((index) => Math.max(index - 1, -1));
    } else if (event.key === 'Enter') {
      // Nothing highlighted: the form submits what's typed.
      const target = suggestions[clampedIndex];
      if (target) {
        event.preventDefault();
        selectSuggestion(target);
      }
    }
  };

  const isUrl = draft.trim().length > 0 && looksLikeUrl(draft);
  // The idle bubble: a bookmarked page's saved name, else the site's domain.
  const bubbleText = pageLabel(url, bookmarks);
  const savedName = bookmarkName?.trim() ? bookmarkName : null;
  // Types itself in once, then its trailing dots loop; the accessible name stays static.
  const placeholder = useAnimatedPlaceholder(draft === '');
  const showBubble = !isFocused && bubbleText !== null;
  // While a page loads, a line runs around the domain chip; with no chip showing (typing, or an app page), around the
  // whole bar instead. Nothing is added beside the chip, so it never shifts sideways.
  const ringOnBubble = isLoading && showBubble;
  const ringOnBar = isLoading && !showBubble;

  return (
    <form
      ref={containerRef}
      className={`address-bar${ringOnBar ? ' address-bar--loading' : ''}`}
      onSubmit={handleSubmit}
      role="search"
      aria-busy={isLoading}
    >
      {/* The load's progress as the bar's own background, filling it from left to right behind everything in it. */}
      {shownProgress && (
        <span className={`address-bar__progress${shownProgress.leaving ? ' address-bar__progress--leaving' : ''}`} aria-hidden="true">
          <span className="address-bar__progress-fill" style={{ width: `${shownProgress.value}%` }} />
        </span>
      )}
      <button
        type="button"
        className="address-bar__bookmark hover-grow chrome-tooltip"
        onClick={onToggleBookmark}
        disabled={!canBookmark}
        aria-pressed={isBookmarked}
        aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark this page'}
        data-tooltip={`${isBookmarked ? 'Remove bookmark' : 'Bookmark this page'} (${formatShortcut('B')})`}
      >
        <BookmarkStarIcon filled={isBookmarked} size={14} />
      </button>
      <span className="address-bar__field">
        <input
          ref={inputRef}
          className={`address-bar__input${showBubble ? ' address-bar__input--hidden' : ''}`}
          type="text"
          inputMode="url"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setSelectedIndex(-1);
          }}
          // Deliberately no select-all on focus: the URL stays unhighlighted
          // when the bar is clicked into (it's only ever selected by the user).
          onFocus={() => {
            setIsFocused(true);
            setSelectedIndex(-1);
          }}
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
          placeholder={placeholder}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        {/* The URL itself is hidden (transparent text) while the bubble shows, not removed:
            the bubble ignores the mouse, so a click lands on the input, focuses it, and the real URL comes back. */}
        {showBubble && (
          <span
            className={`address-bar__bubble${savedName ? '' : ' address-bar__bubble--domain'}${ringOnBubble ? ' address-bar__bubble--loading' : ''}`}
            aria-hidden="true"
          >
            {bubbleText}
          </span>
        )}
      </span>
      {/* The bytes loaded over the bytes to load, just left of the percentage, fading with it. */}
      {shownProgress && shownBytes && shownBytes.value.total > 0 && (
        <span
          className={`address-bar__bytes${shownProgress.leaving ? ' address-bar__progress--leaving' : ''}`}
          aria-label="Bytes loaded"
        >
          {formatByteFraction(shownBytes.value.loaded, shownBytes.value.total)}
        </span>
      )}
      {/* …and the same as a number at the bar's right end, held at 100% for a second once the page has loaded. */}
      {shownProgress && (
        <span
          className={`address-bar__percent${shownProgress.leaving ? ' address-bar__progress--leaving' : ''}`}
          role="progressbar"
          aria-label="Page loading"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={shownProgress.value}
        >
          {shownProgress.value}%
        </span>
      )}
      {/* Reload (Stop while the page loads), in the percentage's place at the bar's right end: shown only while the
          pointer is over the bar and nothing is being typed in it (address-bar.css). */}
      {canReload && (
        <button
          type="button"
          className="address-bar__reload hover-glow chrome-tooltip"
          // Taken by the press, not left with the button: focusing it would count as editing the bar, and hide it.
          onMouseDown={(event) => event.preventDefault()}
          onClick={onReloadOrStop}
          aria-label={isLoading ? 'Stop' : 'Reload'}
          data-tooltip={isLoading ? 'Stop' : `Reload (${formatShortcut('R')})`}
        >
          {isLoading ? <StopIcon size={14} /> : <ReloadIcon size={14} />}
        </button>
      )}
    </form>
  );
}
