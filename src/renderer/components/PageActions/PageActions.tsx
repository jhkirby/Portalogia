// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { useEffect, useRef } from 'react';
import type { Theme } from '../../hooks/useTheme';
import { formatShortcut } from '../../lib/shortcuts';
import { ColorPicker } from '../ColorPicker';
import { ExportMenu } from '../ExportMenu';
import { FindIcon, OpenInNewWindowIcon, SearchIcon, ShieldIcon } from '../icons';
import { ZoomControl } from '../ZoomControl';

interface PageActionsProps {
  /** Whether the export dropdown is usable: there's an active tab, and it isn't the built-in home page, which has no real content to export. */
  readonly canExportMenu: boolean;
  /** Whether the active tab has HTML/CSS/JS to save — browser tabs only. */
  readonly canExportDocuments: boolean;
  /** Whether the export dropdown is shown at all — hidden on a PDF tab, which has nothing to export. */
  readonly showExportMenu: boolean;
  /** Whether the zoom control is shown — hidden on a History tab, which doesn't zoom. */
  readonly showZoom: boolean;
  readonly canZoom: boolean;
  /** The active tab's current zoom, within its range. */
  readonly zoomPercent: number;
  readonly focusMode: boolean;
  readonly theme: Theme;
  /** Whether the ad blocker button is shown — web pages only (not the home page, a PDF, a terminal or History). */
  readonly showAdBlock: boolean;
  /** Whether the ad blocker is blocking on the active page: on globally, and not turned off for this site. */
  readonly adBlockActive: boolean;
  /** Whether the ad blocker is switched off everywhere — the button then can't turn it on per site. */
  readonly adBlockGloballyOff: boolean;
  /** Requests, popups and elements blocked since the page began loading. */
  readonly adBlockBlockedCount: number;
  /** The active page's hostname, for the button's accessible label. */
  readonly adBlockSite: string;
  /** Turns blocking off or back on for the active page's site. */
  readonly onToggleAdBlock: () => void;
  /** Whether the active tab is a Markdown note, whose export menu lists PDF, `.md` and `.txt`. */
  readonly markdownExport: boolean;
  readonly onOpenTabSearch: () => void;
  /** Whether the find bar is open. */
  readonly findOpen: boolean;
  /** Whether find can search the active tab: a page, a terminal, or a PDF with a file open — not the History tab or an empty PDF. */
  readonly canFind: boolean;
  readonly onToggleFind: () => void;
  readonly onZoomOut: () => void;
  readonly onZoomIn: () => void;
  readonly onSetZoom: (percent: number) => void;
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
  canZoom,
  zoomPercent,
  focusMode,
  theme,
  showAdBlock,
  adBlockActive,
  adBlockGloballyOff,
  adBlockBlockedCount,
  adBlockSite,
  onToggleAdBlock,
  markdownExport,
  canExportMenu,
  canExportDocuments,
  showExportMenu,
  showZoom,
  onOpenTabSearch,
  findOpen,
  canFind,
  onToggleFind,
  onZoomOut,
  onZoomIn,
  onSetZoom,
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
      {showExportMenu && <ExportMenu canExport={canExportMenu} canExportDocuments={canExportDocuments} markdown={markdownExport} />}
      <button
        type="button"
        className="page-actions__button hover-grow chrome-tooltip"
        onClick={onOpenTabSearch}
        aria-label="Search tabs"
        data-tooltip={`Search tabs (${formatShortcut('K')})`}
      >
        <SearchIcon />
      </button>
      <button
        type="button"
        className="page-actions__button hover-grow chrome-tooltip"
        onClick={onToggleFind}
        disabled={!canFind}
        aria-pressed={findOpen}
        aria-label={findOpen ? 'Close find' : 'Find'}
        data-tooltip={`${findOpen ? 'Close find' : 'Find'} (${formatShortcut('F')})`}
      >
        <FindIcon />
      </button>
      {showAdBlock && (
        <button
          type="button"
          className="page-actions__button hover-grow page-actions__button--adblock chrome-tooltip"
          onClick={onToggleAdBlock}
          disabled={adBlockGloballyOff}
          // Lit while the blocker is *off* here, so the default (blocking) state stays quiet.
          aria-pressed={!adBlockActive}
          aria-label={adBlockActive ? `Turn off ad blocker for ${adBlockSite}` : `Turn on ad blocker for ${adBlockSite}`}
          data-tooltip={
            adBlockGloballyOff
              ? 'Ad blocker is off (View menu)'
              : adBlockActive
                ? `${adBlockBlockedCount} ${adBlockBlockedCount === 1 ? 'ad' : 'ads'} blocked (${formatShortcut('Shift+B')})`
                : `Ads allowed on this site (${formatShortcut('Shift+B')})`
          }
        >
          <ShieldIcon off={!adBlockActive} />
        </button>
      )}
      <span className="page-actions__divider" role="separator" aria-hidden="true" />
      {showZoom && (
        <>
          <ZoomControl
            percent={zoomPercent}
            canZoom={canZoom}
            onZoomOut={onZoomOut}
            onZoomIn={onZoomIn}
            onSetZoom={onSetZoom}
          />
          <span className="page-actions__divider" role="separator" aria-hidden="true" />
        </>
      )}
      <button
        type="button"
        className="page-actions__button hover-grow chrome-tooltip"
        onClick={onOpenWorkspaceInNewWindow}
        aria-label="Open tab in new window"
        data-tooltip={`Open tab in new window (${formatShortcut('Shift+O')})`}
      >
        <OpenInNewWindowIcon />
      </button>
      <button
        type="button"
        className="page-actions__button hover-grow chrome-tooltip"
        onClick={onToggleFocusMode}
        aria-pressed={focusMode}
        aria-label={focusMode ? 'Exit Focus Mode' : 'Enter Focus Mode'}
        data-tooltip={`${focusMode ? 'Exit Focus Mode' : 'Enter Focus Mode'} (${formatShortcut('Shift+F')})`}
      >
        ⛶
      </button>
      <span className="page-actions__divider" role="separator" aria-hidden="true" />
      <ColorPicker />
      <button
        type="button"
        className="page-actions__button hover-grow chrome-tooltip"
        onClick={onToggleTheme}
        aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        data-tooltip={`${theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} (${formatShortcut('D')})`}
      >
        {theme === 'dark' ? '☾︎' : '☀︎'}
      </button>
    </div>
  );
}
