// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-27

import { useEffect, useRef, useState } from 'react';
import type { BookmarksTabState } from '@shared/tab-state';
import { useAnimatedPlaceholder } from '../../hooks/useAnimatedPlaceholder';

interface BookmarksToolbarProps {
  readonly tab: BookmarksTabState;
}

/** Per tab: the toolbar remounts on every tab switch (see its `key` in `App`), which would otherwise empty the box while the tab's table kept its filter. */
const queryByTab = new Map<string, string>();

/**
 * The Bookmarks tab's controls, shown in the main toolbar where a browser tab
 * has its address bar: the search box (which filters the tab's table, in its
 * own page), then the View/Edit switch — the same two-sided switch a note's
 * toolbar has. Viewing lists the bookmarks and opens them; editing renames,
 * re-points and deletes them.
 *
 * Both travel to the tab's page through main (`setBookmarksQuery`,
 * `setBookmarksMode`); the mode is kept in the tab's state, so the switch
 * reads it from `tab`. Ctrl+/ jumps to the search box, as on a History tab.
 */
export function BookmarksToolbar({ tab }: BookmarksToolbarProps) {
  const [query, setQuery] = useState(queryByTab.get(tab.id) ?? '');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    queryByTab.set(tab.id, query);
    // The tab's page may have loaded after the text was last typed: tell it what this box holds.
    window.portalogia.setBookmarksQuery(tab.id, query);
  }, [tab.id, query]);

  // Ctrl+/ (menu accelerator, see buildMenu.ts) jumps here, as it does to the address bar on a browser tab.
  useEffect(() => window.portalogia.onFocusAddressBar(() => searchRef.current?.focus()), []);

  // Types itself in once, then its trailing dots loop — the same animation as the address bar's.
  const placeholder = useAnimatedPlaceholder(query === '', 'Search bookmarks');

  return (
    <div className="bookmarks-toolbar">
      <input
        ref={searchRef}
        type="text"
        className="bookmarks-toolbar__search"
        aria-label="Search bookmarks..."
        placeholder={placeholder}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setQuery('');
            event.currentTarget.blur();
          }
        }}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />
      {/* One switch with both sides showing; the side in use is filled. */}
      <div
        className="bookmarks-toolbar__modes chrome-tooltip"
        role="group"
        aria-label="View or edit"
        data-tooltip="Switch between viewing and editing the bookmarks"
      >
        {(['view', 'edit'] as const).map((side) => (
          <button
            key={side}
            type="button"
            className={`bookmarks-toolbar__mode hover-grow${tab.mode === side ? ' bookmarks-toolbar__mode--active' : ''}`}
            onClick={() => window.portalogia.setBookmarksMode(tab.id, side)}
            aria-pressed={tab.mode === side}
          >
            {side === 'view' ? 'View' : 'Edit'}
          </button>
        ))}
      </div>
    </div>
  );
}
