// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { TabState, WorkspaceState } from '@shared/tab-state';
import { useAnimatedPlaceholder } from '../../hooks/useAnimatedPlaceholder';
import { GlobeIcon, HistoryIcon } from '../icons';
import { WorkspaceIcon } from '../WorkspaceIcon';

interface TabSearchPopupProps {
  /** Every tab in every workspace — the search reaches tabs outside the current workspace too. */
  readonly tabs: readonly TabState[];
  readonly workspaces: readonly WorkspaceState[];
  /** A data URL of the active tab's last-painted frame (see `TabManager.beginTabPreview`), shown blurred behind the popup — `null` falls back to a plain scrim. */
  readonly previewImage: string | null;
  /** Jumps to a tab (and its workspace). */
  readonly onSelect: (tabId: string) => void;
  /** Dismisses without jumping — the backdrop, or Escape. */
  readonly onClose: () => void;
}

/** What a tab is searched by: its title, its URL if it has one, and the workspace it's in. */
function searchableText(tab: TabState, workspaceName: string): string {
  const url = tab.kind === 'browser' ? tab.url : '';
  return `${tab.title} ${url} ${workspaceName}`.toLowerCase();
}

/** The little mark at the start of a row: the same per-kind symbol the tab strip uses (globe, `>_`, `PDF`, history clock). */
function TabKindMark({ tab }: { readonly tab: TabState }) {
  return (
    <span className="tab-search__kind" aria-hidden="true">
      {tab.kind === 'terminal' ? (
        '>_'
      ) : tab.kind === 'pdf' ? (
        'PDF'
      ) : tab.kind === 'markdown' ? (
        'MD'
      ) : tab.kind === 'history' ? (
        <HistoryIcon size={13} />
      ) : (
        <GlobeIcon size={13} />
      )}
    </span>
  );
}

/**
 * The tab-search popup (the toolbar's search button, or Ctrl+K): a search box
 * over a list of every open tab — its name and the workspace it's in — to
 * jump to one. Up/Down move the highlight, Enter or a click jumps to it,
 * Escape or a click outside closes it.
 *
 * It's a true modal like `BookmarkPopup`, over whichever kind of tab is
 * showing: the active tab's native view comes off the window while it's
 * open (it would otherwise paint above this chrome HTML and swallow its
 * clicks), so the backdrop is a blurred still of that tab's last frame.
 * Only ever mounted while open (see `App`), so its state starts fresh each time.
 */
export function TabSearchPopup({ tabs, workspaces, previewImage, onSelect, onClose }: TabSearchPopupProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const workspaceNameById = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace.name])),
    [workspaces],
  );

  const workspaceById = useMemo(() => new Map(workspaces.map((workspace) => [workspace.id, workspace])), [workspaces]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return tabs;
    }
    return tabs.filter((tab) => searchableText(tab, workspaceNameById.get(tab.workspaceId) ?? '').includes(needle));
  }, [tabs, query, workspaceNameById]);

  const clampedIndex = results.length === 0 ? 0 : Math.min(selectedIndex, results.length - 1);
  const listRef = useRef<HTMLUListElement>(null);

  // With more than ten tabs the list scrolls: keep the highlighted row in view as the arrow keys move it.
  useEffect(() => {
    listRef.current?.querySelector('.tab-search__result--selected')?.scrollIntoView({ block: 'nearest' });
  }, [clampedIndex, results]);
  // Types itself in once, then its trailing dots loop — the same animation as the address bar's.
  const placeholder = useAnimatedPlaceholder(query === '', 'Search tabs');

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex(Math.min(clampedIndex + 1, Math.max(results.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex(Math.max(clampedIndex - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = results[clampedIndex];
      if (target) {
        onSelect(target.id);
      }
    }
  };

  return (
    <div className="tab-search__backdrop" onClick={onClose}>
      {previewImage && <img className="bookmark-popup__preview" src={previewImage} alt="" aria-hidden="true" />}
      <div className="bookmark-popup__scrim" aria-hidden="true" />
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
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelectedIndex(0);
          }}
          placeholder={placeholder}
          aria-label="Search tabs"
          role="combobox"
          aria-expanded
          aria-controls="tab-search-results"
          aria-activedescendant={results[clampedIndex] ? `tab-search-option-${results[clampedIndex].id}` : undefined}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        <ul ref={listRef} id="tab-search-results" className="tab-search__results" role="listbox" aria-label="Open tabs">
          {results.length === 0 && <li className="tab-search__empty">No matching tabs</li>}
          {results.map((tab, index) => (
            <li
              key={tab.id}
              id={`tab-search-option-${tab.id}`}
              role="option"
              aria-selected={index === clampedIndex}
              className={`tab-search__result${index === clampedIndex ? ' tab-search__result--selected' : ''}`}
              // The highlight follows the pointer when it moves, but not when a list scrolling under a resting pointer would steal it.
              onMouseMove={() => setSelectedIndex(index)}
              onClick={() => onSelect(tab.id)}
            >
              <TabKindMark tab={tab} />
              <span className="tab-search__title">{tab.title || 'New Tab'}</span>
              <span className="tab-search__workspace">
                {workspaceById.has(tab.workspaceId) && (
                  <WorkspaceIcon
                    icon={workspaceById.get(tab.workspaceId)?.icon ?? 'dot'}
                    color={workspaceById.get(tab.workspaceId)?.color ?? 'currentColor'}
                    size={14}
                  />
                )}
                {workspaceNameById.get(tab.workspaceId)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
