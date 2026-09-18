// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-12

import { useMemo, useState, type KeyboardEvent } from 'react';
import { searchTabs } from '../../lib/searchTabs';
import type { TabState, WorkspaceState } from '@shared/tab-state';

interface TabSearchProps {
  /** Every tab across every workspace — search reaches tabs outside the current one too. */
  readonly tabs: readonly TabState[];
  readonly workspaces: readonly WorkspaceState[];
  readonly activeTabId: string | null;
  readonly onClose: () => void;
  readonly onActivate: (id: string) => void;
  readonly onSplitWithActive: (id: string) => void;
}

/**
 * A command-palette-style overlay for finding a tab by typing something
 * close to what it's about, not just its exact title — e.g. "that page
 * about hiking" matches a tab titled "10 Best Hiking Trails Near You". Only
 * ever mounted while open (see `App`), so its own state resets fresh each
 * time rather than needing to be cleared on close.
 */
export function TabSearch({
  tabs,
  workspaces,
  activeTabId,
  onClose,
  onActivate,
  onSplitWithActive,
}: TabSearchProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const results = useMemo(() => searchTabs(tabs, query), [tabs, query]);
  const workspaceNameById = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace.name])),
    [workspaces],
  );

  const clampedIndex = results.length === 0 ? 0 : Math.min(selectedIndex, results.length - 1);

  const activate = (tab: TabState): void => {
    onActivate(tab.id);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((index) => Math.min(index + 1, Math.max(results.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = results[clampedIndex];
      if (target) {
        if (event.altKey && activeTabId && activeTabId !== target.id) {
          onSplitWithActive(target.id);
        } else {
          activate(target);
        }
      }
    }
  };

  return (
    <div className="tab-search__backdrop" onClick={onClose}>
      <div
        className="tab-search"
        role="dialog"
        aria-label="Search tabs"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <input
          autoFocus
          className="tab-search__input"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelectedIndex(0);
          }}
          placeholder="Search tabs — try describing what a page was about"
          aria-label="Search tabs"
        />
        <ul className="tab-search__results">
          {results.length === 0 && <li className="tab-search__empty">No matching tabs</li>}
          {results.map((tab, index) => (
            <li
              key={tab.id}
              className={`tab-search__result${index === clampedIndex ? ' tab-search__result--selected' : ''}`}
              onMouseEnter={() => setSelectedIndex(index)}
              onClick={() => activate(tab)}
            >
              {tab.kind === 'browser' && tab.favicon ? (
                <img className="tab-search__favicon" src={tab.favicon} alt="" />
              ) : (
                <span className="tab-search__favicon-placeholder" aria-hidden="true" />
              )}
              <span className="tab-search__title">{tab.title || 'New Tab'}</span>
              <span className="tab-search__workspace">{workspaceNameById.get(tab.workspaceId)}</span>
              {/* Split view only ever holds two browser tabs side by side (see
                  TabManager.enterSplitView) — hide the option entirely for a
                  terminal tab rather than offering a button that silently no-ops. */}
              {tab.kind === 'browser' && activeTabId && activeTabId !== tab.id && (
                <button
                  type="button"
                  className="tab-search__split"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSplitWithActive(tab.id);
                  }}
                >
                  Split
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
