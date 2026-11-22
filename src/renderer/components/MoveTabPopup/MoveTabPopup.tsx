// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-21

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { WorkspaceState } from '@shared/tab-state';
import { useAnimatedPlaceholder } from '../../hooks/useAnimatedPlaceholder';
import { WorkspaceIcon } from '../WorkspaceIcon';

/** A workspace the tab could go to, and how many tabs it holds now. */
export interface MoveTabDestination {
  readonly workspace: WorkspaceState;
  readonly tabCount: number;
}

interface MoveTabPopupProps {
  /** The workspaces with room for one more tab, other than the tab's own, in the sidebar's order. */
  readonly destinations: readonly MoveTabDestination[];
  /** The most tabs a workspace holds, for each row's count. */
  readonly maxTabs: number;
  /** The tab's title, so it's clear what is being moved. */
  readonly tabTitle: string;
  /** A still of the tab, drawn blurred behind the popup (its live view has to come off the window). */
  readonly previewImage: string | null;
  /** Moves the tab to that workspace; the popup closes. */
  readonly onMove: (workspaceId: string) => void;
  /** Dismisses without moving — the backdrop, or Escape. */
  readonly onClose: () => void;
}

/**
 * The "Move tab to workspace" popup (the toolbar's button beside Duplicate):
 * a search box over the workspaces the active tab can go to — only those
 * with room for it, never its own. Up/Down move the highlight, Enter or a
 * click moves the tab there. It looks and behaves like the tab search and
 * the workspace images, a modal over the blurred page. Only ever mounted
 * while open (see `App`), so its state starts fresh each time.
 */
export function MoveTabPopup({ destinations, maxTabs, tabTitle, previewImage, onMove, onClose }: MoveTabPopupProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle === '' ? destinations : destinations.filter(({ workspace }) => workspace.name.toLowerCase().includes(needle));
  }, [destinations, query]);
  const clampedIndex = results.length === 0 ? 0 : Math.min(selectedIndex, results.length - 1);

  // A long list scrolls: keep the highlighted row in view as the arrow keys move it.
  useEffect(() => {
    listRef.current?.querySelector('.tab-search__result--selected')?.scrollIntoView({ block: 'nearest' });
  }, [clampedIndex, results]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const placeholder = useAnimatedPlaceholder(query === '', 'Move Tab to Workspace');

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex(Math.min(clampedIndex + 1, Math.max(results.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex(Math.max(clampedIndex - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = results[clampedIndex];
      if (target) {
        onMove(target.workspace.id);
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
        aria-label={`Move “${tabTitle}” to a workspace`}
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
          aria-label="Move tab to workspace"
          role="combobox"
          aria-expanded
          aria-controls="move-tab-results"
          aria-activedescendant={results[clampedIndex] ? `move-tab-option-${results[clampedIndex].workspace.id}` : undefined}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        <ul ref={listRef} id="move-tab-results" className="tab-search__results" role="listbox" aria-label="Workspaces">
          {results.length === 0 && (
            <li className="tab-search__empty tab-search__empty--centered">
              {destinations.length === 0 ? 'No other workspace has room for this tab' : 'No matching workspaces'}
            </li>
          )}
          {results.map(({ workspace, tabCount }, index) => (
            <li
              key={workspace.id}
              id={`move-tab-option-${workspace.id}`}
              role="option"
              aria-selected={index === clampedIndex}
              className={`tab-search__result${index === clampedIndex ? ' tab-search__result--selected' : ''}`}
              onMouseMove={() => setSelectedIndex(index)}
              onClick={() => onMove(workspace.id)}
            >
              <span className="tab-search__kind" aria-hidden="true">
                <WorkspaceIcon icon={workspace.icon} color={workspace.color} size={16} />
              </span>
              <span className="tab-search__title">{workspace.name}</span>
              <span className="tab-search__workspace">
                {tabCount} of {maxTabs} tabs
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
