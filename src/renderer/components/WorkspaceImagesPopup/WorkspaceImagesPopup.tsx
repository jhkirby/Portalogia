// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-17

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { WorkspaceImageState } from '@shared/tab-state';
import { useAnimatedPlaceholder } from '../../hooks/useAnimatedPlaceholder';
import { PencilIcon } from '../icons';
import { WorkspaceIcon } from '../WorkspaceIcon';

interface WorkspaceImagesPopupProps {
  /** Every saved image, in the order they were saved. */
  readonly images: readonly WorkspaceImageState[];
  /** A still of the tab that was showing, drawn blurred behind the popup (its live view has to come off the window). */
  readonly previewImage: string | null;
  /** Opens an image as a new workspace; the popup closes. */
  readonly onOpen: (id: string) => void;
  /** Deletes an image; the popup stays open. */
  readonly onRemove: (id: string) => void;
  /** Renames an image; the popup stays open. */
  readonly onRename: (id: string, name: string) => void;
  /** Dismisses without opening — the backdrop, or Escape. */
  readonly onClose: () => void;
}

/**
 * The saved workspace images popup (the sidebar's images button, or
 * Ctrl+Shift+S): a search box over the list of images, each with its
 * workspace's icon and name and how many tabs it holds. Up/Down move the
 * highlight, Enter or a click opens it as a new workspace, and the × on a
 * hovered row deletes it. It looks and behaves like the tab search, as
 * another true modal over whichever tab is showing. Only ever mounted while
 * open (see `App`), so its state starts fresh each time.
 */
export function WorkspaceImagesPopup({ images, previewImage, onOpen, onRemove, onRename, onClose }: WorkspaceImagesPopupProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  /** The row whose name is being edited, and the text typed so far. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const commitRename = (): void => {
    if (editingId !== null && draft.trim() !== '') {
      onRename(editingId, draft.trim());
    }
    setEditingId(null);
  };

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle === '' ? images : images.filter((image) => image.name.toLowerCase().includes(needle));
  }, [images, query]);

  const clampedIndex = results.length === 0 ? 0 : Math.min(selectedIndex, results.length - 1);

  // With more than ten images the list scrolls: keep the highlighted row in view as the arrow keys move it.
  useEffect(() => {
    listRef.current?.querySelector('.tab-search__result--selected')?.scrollIntoView({ block: 'nearest' });
  }, [clampedIndex, results]);

  // Deleting a row removes the button that had focus, which leaves the keyboard on the page behind: Escape is heard there too.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      // Escape in the name box only cancels the rename (the box stops it reaching here).
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Types itself in once, then its trailing dots loop — the same animation as the other search bars'.
  const placeholder = useAnimatedPlaceholder(query === '', 'Search Workspace Images');

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // While a name is being typed the keys belong to the box.
    if (editingId !== null) {
      return;
    }
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
        onOpen(target.id);
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
        aria-label="Workspace images"
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
          aria-label="Search Workspace Images..."
          role="combobox"
          aria-expanded
          aria-controls="workspace-images-results"
          aria-activedescendant={results[clampedIndex] ? `workspace-image-option-${results[clampedIndex].id}` : undefined}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        <ul ref={listRef} id="workspace-images-results" className="tab-search__results" role="listbox" aria-label="Workspace images">
          {results.length === 0 && (
            <li className="tab-search__empty tab-search__empty--centered">
              {images.length === 0 ? 'No saved workspace images' : 'No matching workspace images'}
            </li>
          )}
          {results.map((image, index) => (
            <li
              key={image.id}
              id={`workspace-image-option-${image.id}`}
              role="option"
              aria-selected={index === clampedIndex}
              className={`tab-search__result${index === clampedIndex ? ' tab-search__result--selected' : ''}`}
              // The highlight follows the pointer when it moves, but not when a list scrolling under a resting pointer would steal it.
              onMouseMove={() => setSelectedIndex(index)}
              onClick={() => (editingId === image.id ? undefined : onOpen(image.id))}
            >
              <span className="tab-search__kind" aria-hidden="true">
                <WorkspaceIcon icon={image.icon} color={image.color} size={16} />
              </span>
              {editingId === image.id ? (
                <input
                  autoFocus
                  className="tab-search__rename-input"
                  value={draft}
                  maxLength={200}
                  aria-label="Workspace image name"
                  onChange={(event) => setDraft(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  onBlur={commitRename}
                  onKeyDown={(event) => {
                    // Keeps the popup's own Enter/Escape/arrow handling out of typing.
                    event.stopPropagation();
                    if (event.key === 'Enter') {
                      commitRename();
                    } else if (event.key === 'Escape') {
                      setEditingId(null);
                    }
                  }}
                  onFocus={(event) => event.currentTarget.select()}
                  spellCheck={false}
                />
              ) : (
                <span className="tab-search__title">{image.name}</span>
              )}
              <span className="tab-search__workspace">{image.tabCount === 1 ? '1 tab' : `${image.tabCount} tabs`}</span>
              <button
                type="button"
                className="tab-search__rename hover-grow"
                aria-label={`Rename ${image.name} workspace image`}
                title="Rename workspace image"
                onClick={(event) => {
                  event.stopPropagation();
                  setDraft(image.name);
                  setEditingId(image.id);
                }}
              >
                <PencilIcon size={12} />
              </button>
              <button
                type="button"
                className="tab-search__remove hover-grow"
                aria-label={`Delete ${image.name} workspace image`}
                title="Delete workspace image"
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove(image.id);
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
