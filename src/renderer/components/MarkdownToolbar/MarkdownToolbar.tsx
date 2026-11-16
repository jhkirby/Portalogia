// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-12

import { useState } from 'react';
import type { BookmarkState, MarkdownTabState } from '@shared/tab-state';
import { formatAltShortcut } from '../../lib/shortcuts';
import { FileBar } from '../FileBar';
import { PdfSearchBox } from '../PdfToolbar/PdfSearchBox';

/** Must match `markdownRenameRequestSchema` in main: something, then ".md" or ".markdown". */
const NOTE_NAME_PATTERN = /.\.(md|markdown)$/i;

interface MarkdownToolbarProps {
  readonly tab: MarkdownTabState;
  /** Whether the open note's path is already bookmarked — drives the star's filled/outline state. */
  readonly isBookmarked: boolean;
  /** Bookmarks the open note (by its path on disk), or removes its bookmark. */
  readonly onToggleBookmark: (id: string) => void;
  /** The bookmarked notes, searched by the box an empty tab shows in place of a file name. */
  readonly markdownBookmarks: readonly BookmarkState[];
  readonly onOpenBookmark: (id: string, bookmarkId: string) => void;
  /** Opens a note from the history, by path, in the tab. */
  readonly onOpenPath: (id: string, path: string) => void;
  /** Steps back (`-1`) or forward (`1`) through the notes reached by links. */
  readonly onNavigate: (id: string, direction: 1 | -1) => void;
  /** Renames the file on disk; resolves to an error message, or `null` on success. */
  readonly onRename: (id: string, name: string) => Promise<string | null>;
}

/**
 * The Markdown tab's controls, shown in the main toolbar where a browser tab
 * has its address bar: Back/Forward through followed links and the file bar
 * (`FileBar`): the bookmark star and the file name (an editable text box — or,
 * while no note is open, a search over the bookmarked and recent notes), with
 * the note's progress while it opens. View/Edit, Formatted/Raw, the formatting
 * buttons, New, Open, Close, Delete and Export are in the Tools sidebar
 * (`ToolsBar`); the page itself only draws the note.
 * Remount per tab (via `key`) so a draft name never leaks between tabs.
 */
export function MarkdownToolbar({
  tab,
  isBookmarked,
  onToggleBookmark,
  markdownBookmarks,
  onOpenBookmark,
  onOpenPath,
  onNavigate,
  onRename,
}: MarkdownToolbarProps) {
  /** Uncommitted text while the name input is being edited; null when not editing. */
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { fileName } = tab;

  const commitName = (): void => {
    const trimmed = nameDraft?.trim();
    setNameDraft(null);
    if (!trimmed || trimmed === fileName) {
      return;
    }
    // A name typed without an extension keeps the note a note.
    const name = NOTE_NAME_PATTERN.test(trimmed) ? trimmed : `${trimmed}.md`;
    setError(null);
    void onRename(tab.id, name).then(setError);
  };

  return (
    <div className="markdown-toolbar">
      {/* The browser tab's own back/forward buttons, so the two kinds of tab read alike. */}
      <div className="nav-controls">
        <button
          type="button"
          className="nav-controls__button hover-glow chrome-tooltip"
          onClick={() => onNavigate(tab.id, -1)}
          disabled={!tab.canGoBack}
          aria-label="Back"
          data-tooltip={`Back (${formatAltShortcut('←')})`}
        >
          ‹
        </button>
        <button
          type="button"
          className="nav-controls__button hover-glow chrome-tooltip"
          onClick={() => onNavigate(tab.id, 1)}
          disabled={!tab.canGoForward}
          aria-label="Forward"
          data-tooltip={`Forward (${formatAltShortcut('→')})`}
        >
          ›
        </button>
      </div>
      <FileBar
        isBookmarked={isBookmarked}
        canBookmark={fileName !== null}
        bookmarkLabel="Bookmark this note"
        onToggleBookmark={() => onToggleBookmark(tab.id)}
        loadProgress={tab.loadProgress}
        loadBytes={tab.loadBytes}
      >
        {/* Before a note is open there's nothing to rename, so the bar is a search over the bookmarked and recent notes instead. */}
        {fileName === null ? (
          <PdfSearchBox
            kind="markdown"
            bookmarks={markdownBookmarks}
            onOpen={(bookmarkId) => onOpenBookmark(tab.id, bookmarkId)}
            onOpenPath={(path) => onOpenPath(tab.id, path)}
          />
        ) : (
          <input
            type="text"
            className="file-bar__name"
            aria-label="File name"
            value={nameDraft ?? fileName}
            onChange={(event) => setNameDraft(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              } else if (event.key === 'Escape') {
                setNameDraft(null);
                event.currentTarget.blur();
              }
            }}
          />
        )}
      </FileBar>
      {error && <span className="markdown-toolbar__error">{error}</span>}
    </div>
  );
}
