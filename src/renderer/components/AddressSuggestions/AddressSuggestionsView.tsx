// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AddressSuggestionsSyncPayload } from '@shared/ipc-contract';
import { BookmarkStarIcon, HistoryIcon } from '../icons';

/**
 * The whole of `suggestions.html`'s page — the address bar's bookmark-
 * suggestions dropdown (or, in its `'menu'` variant, a plain option list: the
 * History toolbar's unit dropdown), rendered here instead of in the chrome's own DOM
 * so it can sit visually above the active tab's live `WebContentsView`
 * without that view ever needing to be hidden (see `SuggestionsOverlay`
 * on the main-process side for why a chrome-drawn dropdown can't do that).
 *
 * This view's own `WebContentsView` bounds are always sized to exactly the
 * dropdown's own content (see `SuggestionsOverlay.sync`), so there's
 * nothing to lay out here beyond the list itself — no positioning, no
 * portal, no measuring. Selecting a row doesn't navigate directly; it just
 * reports the index back to the chrome's address bar (`select`), which
 * owns the actual bookmark list this index refers into.
 *
 * A row's selection fires on `mousedown`, not `click` — the address bar's
 * own input is what's focused while this dropdown is open, and the mouse
 * press that lands here also moves focus (and therefore OS input) to
 * *this* separate `WebContentsView`, blurring that input. `AddressBar`
 * closes the dropdown on that blur (see its own doc comment), which tears
 * this view's own overlay down — main removes it from the window outright,
 * same as `SuggestionsOverlay.sync`'s own doc comment explains for why.
 * Waiting for `click` (which only fires after a matching `mouseup`) risks
 * that teardown winning the race and this row disappearing — along with
 * its own pending `mouseup` — before the click ever fires, which is
 * exactly the "row vanishes, nothing happens" bug this sidesteps: sending
 * `select` on `mousedown` gets it to the chrome first, before the close
 * this same press triggers has a chance to catch up.
 */
export function AddressSuggestionsView() {
  const [payload, setPayload] = useState<AddressSuggestionsSyncPayload | null>(null);

  useEffect(() => window.northstarSuggestions.onSync(setPayload), []);

  // The keyboard's row is kept in view: Up and Down walk the whole list, past what the view shows at once.
  const listRef = useRef<HTMLUListElement>(null);
  const selectedIndex = payload?.selectedIndex ?? 0;
  useLayoutEffect(() => {
    const row = listRef.current?.children[selectedIndex];
    if (row instanceof HTMLElement) {
      row.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex, payload]);

  if (!payload || !payload.open) {
    return null;
  }

  const isMenu = payload.variant === 'menu';

  return (
    <ul ref={listRef} className={`address-bar__suggestions${isMenu ? ' address-bar__suggestions--menu' : ''}`} role="listbox">
      {payload.suggestions.map((item, index) => (
        <li
          key={item.id}
          role="option"
          aria-selected={index === payload.selectedIndex}
          className={`address-bar__suggestion${
            index === payload.selectedIndex ? ' address-bar__suggestion--selected' : ''
          }${item.kind === 'history' ? ' address-bar__suggestion--history' : ''}`}
          onMouseDown={(event) => {
            // Not the row's own default action (text-drag-selecting the
            // title/URL) — this is what lets the address bar's input stay
            // focused for a keyboard-driven Enter (`AddressBar`'s own
            // `handleKeyDown`) right up until an actual pointer selection
            // happens, same idiom the row's own hover-to-select already
            // relies on not fighting focus either.
            event.preventDefault();
            window.northstarSuggestions.select(index);
          }}
        >
          {!isMenu && (item.kind === 'history' ? <HistoryIcon size={13} /> : <BookmarkStarIcon filled size={13} />)}
          <span className="address-bar__suggestion-title">{item.title}</span>
          {!isMenu && <span className="address-bar__suggestion-url">{item.url}</span>}
        </li>
      ))}
    </ul>
  );
}
