// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-27

import { useEffect, useRef, useState } from 'react';
import type { SecretsTabState } from '@shared/tab-state';
import { useAnimatedPlaceholder } from '../../hooks/useAnimatedPlaceholder';

interface SecretsToolbarProps {
  readonly tab: SecretsTabState;
}

/** Per tab: the toolbar remounts on every tab switch (see its `key` in `App`), which would otherwise empty the box while the tab's table kept its filter. */
const queryByTab = new Map<string, string>();

/**
 * The Secrets tab's controls, shown in the main toolbar where a browser tab
 * has its address bar: the search box (which filters the tab's table by name,
 * source and element — never by the secrets themselves), the View/Edit
 * switch, then Add, which starts a new row to type a secret into by hand.
 * The Bookmarks toolbar's twin (`BookmarksToolbar`), drawn with its styles.
 *
 * Both travel to the tab's page through main (`setSecretsQuery`,
 * `setSecretsMode`); the mode is kept in the tab's state, so the switch reads
 * it from `tab`. Ctrl+/ jumps to the search box.
 */
export function SecretsToolbar({ tab }: SecretsToolbarProps) {
  const [query, setQuery] = useState(queryByTab.get(tab.id) ?? '');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    queryByTab.set(tab.id, query);
    // The tab's page may have loaded after the text was last typed: tell it what this box holds.
    window.northstar.setSecretsQuery(tab.id, query);
  }, [tab.id, query]);

  // Ctrl+/ (menu accelerator, see buildMenu.ts) jumps here, as it does to the address bar on a browser tab.
  useEffect(() => window.northstar.onFocusAddressBar(() => searchRef.current?.focus()), []);

  const placeholder = useAnimatedPlaceholder(query === '', 'Search secrets');

  return (
    <div className="bookmarks-toolbar">
      <input
        ref={searchRef}
        type="text"
        className="bookmarks-toolbar__search"
        aria-label="Search secrets..."
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
        data-tooltip="Switch between viewing and editing the secrets"
      >
        {(['view', 'edit'] as const).map((side) => (
          <button
            key={side}
            type="button"
            className={`bookmarks-toolbar__mode hover-grow${tab.mode === side ? ' bookmarks-toolbar__mode--active' : ''}`}
            onClick={() => window.northstar.setSecretsMode(tab.id, side)}
            aria-pressed={tab.mode === side}
          >
            {side === 'view' ? 'View' : 'Edit'}
          </button>
        ))}
      </div>
      {/* A new, empty row at the top of the table, every field typed in by hand; switches to editing to show it. */}
      <button
        type="button"
        className="secrets-toolbar__add hover-grow chrome-tooltip"
        onClick={() => window.northstar.addSecretRow(tab.id)}
        aria-label="Add a secret"
        data-tooltip="Add a secret by hand"
      >
        + Add
      </button>
    </div>
  );
}
