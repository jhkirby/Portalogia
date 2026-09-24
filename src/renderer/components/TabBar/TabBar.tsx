// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-18

import { useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import type { TabState } from '@shared/tab-state';
import { formatShortcut } from '../../lib/shortcuts';

// A native HTML5 drag shows the browser's own snapshot of the dragged
// element following the cursor by default; over this chrome's mix of HTML
// and layered native `WebContentsView`s that snapshot renders in the wrong
// place entirely (see the tab drag-and-drop work this came from). Handing
// `setDragImage` a fully transparent 1x1 pixel suppresses that snapshot,
// leaving only the dragged tab's own in-place `--dragging` highlight.
const TRANSPARENT_DRAG_IMAGE = new Image();
TRANSPARENT_DRAG_IMAGE.src =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7';

interface TabBarProps {
  /** Tabs to render, left to right, in the order they were opened. */
  readonly tabs: readonly TabState[];
  /** Id of the tab drawn as selected; `null` while no window has one yet. */
  readonly activeTabId: string | null;
  /** Called when the user picks a different tab. */
  readonly onActivate: (id: string) => void;
  /** Called when the user closes a tab. */
  readonly onClose: (id: string) => void;
  /** Called when a drag-and-drop reorder finishes: `beforeId` is the tab it should land before, or `null` for the end of the row. */
  readonly onReorder: (id: string, beforeId: string | null) => void;
  /** The tab grabbed for keyboard reordering (Ctrl+Space held, then Left/Right to nudge it — see `TabManager.grabTabForReorder`), or `null` when nothing is grabbed. Shares the mouse-drag's `--dragging` highlight. */
  readonly grabbedTabId: string | null;
  /** Called when the user clicks the "new tab" button. */
  readonly onNewTab: () => void;
  /**
   * Called when a tab drag ends without landing on any drop target this
   * chrome itself recognizes (an in-bar reorder, or a `WorkspaceBar` pill)
   * — `screenX`/`screenY` are the drag's OS screen coordinates at release,
   * for main to decide whether the release point actually left this
   * window (see `tearOffTab`), which alone means "open this tab in a new
   * window."
   */
  readonly onDragEndOutside: (id: string, screenX: number, screenY: number) => void;
}

/** Which half of a tab the dragged tab is currently hovering over — drives both the drop position and its visual indicator. */
type DropPosition = 'before' | 'after';

interface DropTarget {
  readonly id: string;
  readonly position: DropPosition;
}

/** The row of open tabs at the top of the window, plus a "new tab" button. */
export function TabBar({
  tabs,
  activeTabId,
  onActivate,
  onClose,
  onReorder,
  grabbedTabId,
  onNewTab,
  onDragEndOutside,
}: TabBarProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  const endDrag = (): void => {
    setDraggedId(null);
    setDropTarget(null);
  };

  const handleDrop = (): void => {
    if (draggedId && dropTarget) {
      const targetIndex = tabs.findIndex((tab) => tab.id === dropTarget.id);
      const insertIndex = dropTarget.position === 'before' ? targetIndex : targetIndex + 1;
      onReorder(draggedId, tabs[insertIndex]?.id ?? null);
    }
    endDrag();
  };

  // Fallback for the drag crossing off the last tab entirely — onto the
  // "+" button, or any gap `.tab-bar`'s own flex row leaves past the
  // tabs — where no `Tab` is underneath to report a precise before/after
  // position. `drop`/`dragover` both bubble, so this still fires (and
  // still needs its own `preventDefault`) even when the event originated
  // on a `Tab` beneath it; the `closest` check below only takes over when
  // it didn't, defaulting to "append at the end" rather than leaving
  // whatever `dropTarget` a previous, no-longer-relevant hover left set.
  const handleContainerDragOver = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const overTab = (event.target as HTMLElement).closest('.tab-bar__tab');
    const lastTab = tabs[tabs.length - 1];
    if (!overTab && lastTab) {
      setDropTarget({ id: lastTab.id, position: 'after' });
    }
  };

  const handleContainerDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    handleDrop();
  };

  return (
    <div
      className="tab-bar"
      role="tablist"
      aria-label="Open tabs"
      onDragOver={handleContainerDragOver}
      onDrop={handleContainerDrop}
    >
      {tabs.map((tab) => (
        <Tab
          key={tab.id}
          tab={tab}
          isActive={tab.id === activeTabId}
          onActivate={onActivate}
          onClose={onClose}
          isDragging={tab.id === draggedId || tab.id === grabbedTabId}
          dropPosition={dropTarget?.id === tab.id ? dropTarget.position : null}
          onDragStart={() => setDraggedId(tab.id)}
          onDragOver={(position) => setDropTarget({ id: tab.id, position })}
          onDragEnd={endDrag}
          onDragEndOutside={onDragEndOutside}
        />
      ))}
      <button
        type="button"
        className="tab-bar__new chrome-tooltip"
        aria-label="New tab"
        onClick={onNewTab}
        data-tooltip={`New tab (${formatShortcut('N')})`}
      >
        +
      </button>
    </div>
  );
}

interface TabProps {
  readonly tab: TabState;
  readonly isActive: boolean;
  readonly onActivate: (id: string) => void;
  readonly onClose: (id: string) => void;
  /** Whether this is the tab currently being dragged (mouse) or grabbed (Ctrl+Space) — either way, drives its in-place `--dragging` highlight. */
  readonly isDragging: boolean;
  /** Which half of this tab the dragged tab is hovering over, if any — drives the drop-indicator line. */
  readonly dropPosition: DropPosition | null;
  readonly onDragStart: () => void;
  readonly onDragOver: (position: DropPosition) => void;
  readonly onDragEnd: () => void;
  /** See `TabBarProps.onDragEndOutside` — forwarded straight through, this tab already has its own `id` in scope. */
  readonly onDragEndOutside: (id: string, screenX: number, screenY: number) => void;
}

/** One tab. A `div[role=tab]` rather than a `<button>` because it hosts its own close `<button>`. */
function Tab({
  tab,
  isActive,
  onActivate,
  onClose,
  isDragging,
  dropPosition,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDragEndOutside,
}: TabProps) {
  const activate = (): void => onActivate(tab.id);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate();
    }
  };

  const handleClose = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    onClose(tab.id);
  };

  // A native HTML5 drag needs `dataTransfer` populated even though this
  // reorder is entirely local — some platforms refuse to start a drag (or
  // show a "no drop" cursor throughout) if nothing was ever set on it.
  const handleDragStart = (event: DragEvent<HTMLDivElement>): void => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', tab.id);
    event.dataTransfer.setDragImage(TRANSPARENT_DRAG_IMAGE, 0, 0);
    onDragStart();
  };

  // Fires continuously while hovering — `preventDefault` is what tells the
  // browser this element accepts the drop at all; without it, the drop
  // event (handled up at `.tab-bar` itself, since `drop` bubbles same as
  // this) would never fire. Which half of the tab the pointer is over
  // decides "insert before" vs. "insert after" this tab.
  const handleDragOver = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const rect = event.currentTarget.getBoundingClientRect();
    const isLeftHalf = event.clientX - rect.left < rect.width / 2;
    onDragOver(isLeftHalf ? 'before' : 'after');
  };

  // `dropEffect` reflects whatever the drop target's own `dragover`
  // handler last set before the drop (or `'none'` if the release never
  // landed on a target that called `preventDefault` at all — including a
  // release outside this OS window entirely, which never dispatches a
  // `drop` event here in the first place). Both this tab bar's own
  // in-place reorder and `WorkspaceBar`'s pills set `'move'` when they
  // accept a drop, so `'none'` uniquely means "didn't land on either" —
  // main gets the final say on whether that point was actually outside
  // the window (see `tearOffTab`'s own doc comment).
  const handleDragEnd = (event: DragEvent<HTMLDivElement>): void => {
    if (event.dataTransfer.dropEffect === 'none') {
      onDragEndOutside(tab.id, event.screenX, event.screenY);
    }
    onDragEnd();
  };

  const dropClass =
    dropPosition === 'before'
      ? ' tab-bar__tab--drop-before'
      : dropPosition === 'after'
        ? ' tab-bar__tab--drop-after'
        : '';

  return (
    <div
      role="tab"
      tabIndex={0}
      aria-selected={isActive}
      draggable
      className={`tab-bar__tab${isActive ? ' tab-bar__tab--active' : ''}${isDragging ? ' tab-bar__tab--dragging' : ''}${dropClass}`}
      onClick={activate}
      onKeyDown={handleKeyDown}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      {tab.kind === 'terminal' ? (
        <span className="tab-bar__terminal-icon" aria-hidden="true">
          {'>_'}
        </span>
      ) : tab.isLoading ? (
        <span className="tab-bar__spinner" aria-hidden="true" />
      ) : tab.favicon ? (
        <img className="tab-bar__favicon" src={tab.favicon} alt="" />
      ) : (
        <span className="tab-bar__favicon-placeholder" aria-hidden="true" />
      )}
      <span className="tab-bar__title">{tab.title || 'New Tab'}</span>
      <button
        type="button"
        className="tab-bar__close chrome-tooltip"
        aria-label={`Close ${tab.title || 'tab'}`}
        onClick={handleClose}
        data-tooltip={isActive ? `Close tab (${formatShortcut('W')})` : 'Close tab'}
      >
        ×
      </button>
    </div>
  );
}
