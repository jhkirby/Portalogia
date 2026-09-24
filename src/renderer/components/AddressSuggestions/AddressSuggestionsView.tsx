// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-24

import { useEffect, useState } from 'react';
import type { AddressSuggestionsSyncPayload } from '@shared/ipc-contract';
import { BookmarkStarIcon } from '../icons';

/**
 * The whole of `suggestions.html`'s page — the address bar's bookmark-
 * suggestions dropdown, rendered here instead of in the chrome's own DOM
 * so it can sit visually above the active tab's live `WebContentsView`
 * without that view ever needing to be hidden (see `SuggestionsOverlay`
 * on the main-process side for why a chrome-drawn dropdown can't do that).
 *
 * This view's own `WebContentsView` bounds are always sized to exactly the
 * dropdown's own content (see `SuggestionsOverlay.sync`), so there's
 * nothing to lay out here beyond the list itself — no positioning, no
 * portal, no measuring. Selecting a row doesn't navigate directly; it just
 * reports the click's index back to the chrome's address bar (`select`),
 * which owns the actual bookmark list this index refers into.
 */
export function AddressSuggestionsView() {
  const [payload, setPayload] = useState<AddressSuggestionsSyncPayload | null>(null);

  useEffect(() => window.northstarSuggestions.onSync(setPayload), []);

  if (!payload || !payload.open) {
    return null;
  }

  return (
    <ul className="address-bar__suggestions" role="listbox">
      {payload.suggestions.map((item, index) => (
        <li
          key={item.id}
          role="option"
          aria-selected={index === payload.selectedIndex}
          className={`address-bar__suggestion${
            index === payload.selectedIndex ? ' address-bar__suggestion--selected' : ''
          }`}
          onClick={() => window.northstarSuggestions.select(index)}
        >
          <BookmarkStarIcon filled size={13} />
          <span className="address-bar__suggestion-title">{item.title}</span>
          <span className="address-bar__suggestion-url">{item.url}</span>
        </li>
      ))}
    </ul>
  );
}
