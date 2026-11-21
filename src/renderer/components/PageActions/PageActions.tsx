// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-12

import { useEffect, useRef, type ReactNode } from 'react';
import { MAX_TABS_PER_WORKSPACE } from '@shared/constants';
import type { Theme } from '../../hooks/useTheme';
import { formatShortcut } from '../../lib/shortcuts';
import { ColorPicker } from '../ColorPicker';
import {
  DuplicateTabIcon,
  FindIcon,
  MoveToWorkspaceIcon,
  OpenInNewWindowIcon,
  SearchIcon,
  SplitScreenIcon,
  SwapSidesIcon,
} from '../icons';

interface PageActionsProps {
  /** Whether the screen is split (two tabs side by side): the split button then goes back to one. */
  readonly splitActive: boolean;
  /** Whether exactly two tabs are selected, which the split button splits; otherwise it's disabled (unless split). */
  readonly canSplit: boolean;
  /** Splits the two selected tabs side by side, or goes back to one screen. */
  readonly onToggleSplit: () => void;
  /** While split, the two sides trade places. */
  readonly onSwapSplit: () => void;
  /** Whether there's a tab to duplicate and room for its copy (a workspace holds at most `MAX_TABS_PER_WORKSPACE`). */
  readonly canDuplicate: boolean;
  /** Opens a copy of the active tab right after it. */
  readonly onDuplicateTab: () => void;
  /** Whether another workspace has room for the active tab (`MAX_TABS_PER_WORKSPACE`). */
  readonly canMoveTab: boolean;
  /** Opens the popup that moves the active tab to another workspace. */
  readonly onMoveTab: () => void;
  /**
   * The active tab's own tools (`TabActions`: the ad blocker, zoom), after Find — or `null` in split screen, where
   * each half of the toolbar has its side's instead.
   */
  readonly tabActions: ReactNode;
  readonly focusMode: boolean;
  readonly theme: Theme;
  readonly onOpenTabSearch: () => void;
  /** Whether the find bar is open. */
  readonly findOpen: boolean;
  /** Whether find can search the active tab: a page, a terminal, or a PDF with a file open — not the History tab or an empty PDF. */
  readonly canFind: boolean;
  readonly onToggleFind: () => void;
  readonly onOpenWorkspaceInNewWindow: () => void;
  readonly onToggleFocusMode: () => void;
  readonly onToggleTheme: () => void;
}

/**
 * The toolbar's right-hand button strip, in four groups split by dividers —
 * nearest the address bar first: page tools (export, tab search, find, the ad
 * blocker);
 * zoom; window actions (new window, Focus Mode); appearance (accent color,
 * theme). The page-editing tools (Pan, Select, the laser pointer, pen and the
 * rest) are in the Tools sidebar on the right (`ToolsBar`), and the other kinds
 * of tab (PDF, note, terminal, bookmarks, secrets, history) open from the tab
 * row's "+" menu (`NewTabMenu`).
 */
export function PageActions({
  tabActions,
  focusMode,
  theme,
  splitActive,
  canSplit,
  onToggleSplit,
  onSwapSplit,
  canDuplicate,
  onDuplicateTab,
  canMoveTab,
  onMoveTab,
  onOpenTabSearch,
  findOpen,
  canFind,
  onToggleFind,
  onOpenWorkspaceInNewWindow,
  onToggleFocusMode,
  onToggleTheme,
}: PageActionsProps) {
  const stripRef = useRef<HTMLDivElement>(null);

  // In a window too narrow for every tool the strip scrolls sideways, with no scroll bar, so an ordinary (vertical)
  // wheel turn scrolls it; a sideways one (a touchpad, Shift+wheel) already does. Not passive, to keep the turn
  // from going anywhere else.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) {
      return undefined;
    }
    const scrollSideways = (event: WheelEvent): void => {
      if (strip.scrollWidth <= strip.clientWidth || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
        return;
      }
      event.preventDefault();
      // A wheel that reports lines rather than pixels.
      const pixels = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY;
      strip.scrollLeft += pixels;
    };
    strip.addEventListener('wheel', scrollSideways, { passive: false });
    return () => strip.removeEventListener('wheel', scrollSideways);
  }, []);

  return (
    <div ref={stripRef} className="page-actions">
      {/* While split: the two sides trade places. */}
      {splitActive && (
        <button
          type="button"
          className="page-actions__button hover-glow icon-hop chrome-tooltip"
          data-hop="flip"
          onClick={onSwapSplit}
          aria-label="Swap sides"
          data-tooltip="Swap sides"
        >
          <SwapSidesIcon />
        </button>
      )}
      {/* Split screen: the two selected tabs side by side (the first selected on the left), or back to one. */}
      <button
        type="button"
        className="page-actions__button hover-glow icon-hop chrome-tooltip"
        data-hop="spread"
        onClick={onToggleSplit}
        disabled={!splitActive && !canSplit}
        aria-pressed={splitActive}
        aria-label={splitActive ? 'Back to one screen' : 'Split screen'}
        data-tooltip={
          splitActive
            ? `Back to one screen, the side last used (${formatShortcut('Alt+S')})`
            : canSplit
              ? `Split screen: the two selected tabs side by side (${formatShortcut('Alt+S')})`
              : `Split screen: select two tabs first, with Ctrl+click (${formatShortcut('Alt+S')})`
        }
      >
        <SplitScreenIcon split={splitActive} />
      </button>
      {/* A copy of the active tab, right after it: the same page, file or kind of tool. */}
      <button
        type="button"
        className="page-actions__button hover-glow icon-hop chrome-tooltip"
        data-hop="nudge"
        onClick={onDuplicateTab}
        disabled={!canDuplicate}
        aria-label="Duplicate tab"
        data-tooltip={
          canDuplicate
            ? `Duplicate tab (${formatShortcut('Shift+D')})`
            : `Duplicate tab: this workspace already has ${MAX_TABS_PER_WORKSPACE} tabs, the most it can hold`
        }
      >
        <DuplicateTabIcon />
      </button>
      {/* The active tab to another workspace — one with room for it — picked in a popup over the page. */}
      <button
        type="button"
        className="page-actions__button hover-glow icon-hop chrome-tooltip"
        data-hop="slide"
        onClick={onMoveTab}
        disabled={!canMoveTab}
        aria-label="Move tab to workspace"
        data-tooltip={
          canMoveTab ? 'Move tab to another workspace' : 'Move tab: no other workspace has room for it'
        }
      >
        <MoveToWorkspaceIcon />
      </button>
      <button
        type="button"
        className="page-actions__button hover-glow icon-hop chrome-tooltip"
        data-hop="search"
        onClick={onOpenTabSearch}
        aria-label="Search tabs"
        data-tooltip={`Search tabs (${formatShortcut('K')})`}
      >
        <SearchIcon />
      </button>
      <button
        type="button"
        className="page-actions__button hover-glow icon-hop chrome-tooltip"
        data-hop="scan"
        onClick={onToggleFind}
        disabled={!canFind}
        aria-pressed={findOpen}
        aria-label={findOpen ? 'Close find' : 'Find'}
        data-tooltip={`${findOpen ? 'Close find' : 'Find'} (${formatShortcut('F')})`}
      >
        <FindIcon />
      </button>
      {tabActions ?? <span className="page-actions__divider" role="separator" aria-hidden="true" />}
      <button
        type="button"
        className="page-actions__button hover-glow icon-hop chrome-tooltip"
        data-hop="pop-out"
        onClick={onOpenWorkspaceInNewWindow}
        aria-label="Open tab in new window"
        data-tooltip={`Open tab in new window (${formatShortcut('Shift+O')})`}
      >
        <OpenInNewWindowIcon />
      </button>
      <button
        type="button"
        className="page-actions__button hover-glow icon-hop chrome-tooltip"
        data-hop="expand"
        onClick={onToggleFocusMode}
        aria-pressed={focusMode}
        aria-label={focusMode ? 'Exit Focus Mode' : 'Enter Focus Mode'}
        data-tooltip={`${focusMode ? 'Exit Focus Mode' : 'Enter Focus Mode'} (${formatShortcut('Shift+F')})`}
      >
        <span className="icon-hop__glyph">⛶</span>
      </button>
      <span className="page-actions__divider" role="separator" aria-hidden="true" />
      <ColorPicker />
      <button
        type="button"
        className="page-actions__button hover-glow icon-hop chrome-tooltip"
        data-hop="spin"
        onClick={onToggleTheme}
        aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        data-tooltip={`${theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} (${formatShortcut('D')})`}
      >
        <span className="icon-hop__glyph">{theme === 'dark' ? '☾︎' : '☀︎'}</span>
      </button>
    </div>
  );
}
