// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { useState } from 'react';
import type { BookmarkState, MarkdownDisplay, MarkdownTabState } from '@shared/tab-state';
import { formatAltShortcut, formatShortcut } from '../../lib/shortcuts';
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
  readonly onNew: (id: string) => void;
  readonly onOpen: (id: string) => void;
  /** Closes the open note, leaving the tab empty. */
  readonly onClose: (id: string) => void;
  /** Asks to delete the open note (its file goes to the Recycle Bin): `App` confirms with the user first. */
  readonly onDelete: (id: string) => void;
  readonly onSetMode: (id: string, mode: 'view' | 'edit') => void;
  /** Switches between the formatted note and its raw text. */
  readonly onSetDisplay: (id: string, display: MarkdownDisplay) => void;
  /** Steps back (`-1`) or forward (`1`) through the notes reached by links. */
  readonly onNavigate: (id: string, direction: 1 | -1) => void;
  /** Renames the file on disk; resolves to an error message, or `null` on success. */
  readonly onRename: (id: string, name: string) => Promise<string | null>;
}

/**
 * The Markdown tab's controls, shown in the main toolbar where a browser tab
 * has its address bar: Back/Forward through followed links, New and Open,
 * Close and Delete, the View/Edit switch (read-only or editable), the
 * Raw/Formatted switch (exact characters or the drawn note), and the file bar
 * (`FileBar`): the bookmark star and the file name (an editable text box — or,
 * while no note is open, a search over the bookmarked and recent notes), with
 * the note's progress while it opens. Export lives in the
 * toolbar's export menu; the page itself only draws the note.
 * Remount per tab (via `key`) so a draft name never leaks between tabs.
 */
export function MarkdownToolbar({
  tab,
  isBookmarked,
  onToggleBookmark,
  markdownBookmarks,
  onOpenBookmark,
  onOpenPath,
  onNew,
  onOpen,
  onClose,
  onDelete,
  onSetMode,
  onSetDisplay,
  onNavigate,
  onRename,
}: MarkdownToolbarProps) {
  /** Uncommitted text while the name input is being edited; null when not editing. */
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { fileName, mode, display } = tab;

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
      <button
        type="button"
        className="markdown-toolbar__button hover-grow chrome-tooltip"
        onClick={() => onNew(tab.id)}
        data-tooltip="Create a new note"
      >
        New
      </button>
      <button
        type="button"
        className="markdown-toolbar__button hover-grow chrome-tooltip"
        onClick={() => onOpen(tab.id)}
        data-tooltip={`Open a note (${formatShortcut('O')})`}
      >
        Open
      </button>
      <button
        type="button"
        className="markdown-toolbar__button hover-grow chrome-tooltip"
        onClick={() => onClose(tab.id)}
        disabled={fileName === null}
        data-tooltip={`Close the open note (${formatShortcut('Shift+C')})`}
      >
        Close
      </button>
      <button
        type="button"
        className="markdown-toolbar__button hover-grow chrome-tooltip"
        onClick={() => onDelete(tab.id)}
        disabled={fileName === null}
        data-tooltip="Delete the open note"
      >
        Delete
      </button>
      {/* One switch with both sides showing; the side in use is filled. */}
      <div
        className="markdown-toolbar__modes chrome-tooltip"
        role="group"
        aria-label="View or edit"
        data-tooltip={`Switch between viewing and editing (${formatShortcut('Shift+G')})`}
      >
        {(['view', 'edit'] as const).map((side) => (
          <button
            key={side}
            type="button"
            className={`markdown-toolbar__mode hover-grow${mode === side ? ' markdown-toolbar__mode--active' : ''}`}
            onClick={() => onSetMode(tab.id, side)}
            disabled={fileName === null}
            aria-pressed={mode === side}
          >
            <ModeLabel text={side === 'view' ? 'View' : 'Edit'} />
          </button>
        ))}
      </div>
      <div
        className="markdown-toolbar__modes chrome-tooltip"
        role="group"
        aria-label="Raw or formatted"
        data-tooltip="Switch between the raw text and the formatted note"
      >
        {(['formatted', 'raw'] as const).map((side) => (
          <button
            key={side}
            type="button"
            className={`markdown-toolbar__mode hover-grow${display === side ? ' markdown-toolbar__mode--active' : ''}`}
            onClick={() => onSetDisplay(tab.id, side)}
            disabled={fileName === null}
            aria-pressed={display === side}
          >
            <ModeLabel text={side === 'raw' ? 'Raw' : 'Formatted'} />
          </button>
        ))}
      </div>
      <FileBar
        isBookmarked={isBookmarked}
        canBookmark={fileName !== null}
        bookmarkLabel="Bookmark this note"
        onToggleBookmark={() => onToggleBookmark(tab.id)}
        loadProgress={tab.loadProgress}
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

/** The longest label on either switch: every side of both is made this wide, so the two switches match. */
const WIDEST_MODE_LABEL = 'Formatted';

/**
 * A switch side's label, laid over an unseen copy of the longest label so the
 * button is that wide whatever its own word: View/Edit then lines up with
 * Raw/Formatted, in any font.
 * @param text The label.
 */
function ModeLabel({ text }: { readonly text: string }) {
  return (
    <span className="markdown-toolbar__mode-label">
      <span>{text}</span>
      <span className="markdown-toolbar__mode-sizer" aria-hidden="true">
        {WIDEST_MODE_LABEL}
      </span>
    </span>
  );
}
