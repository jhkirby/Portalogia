// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { formatShortcut } from '../../lib/shortcuts';
import { ShieldIcon } from '../icons';
import { NoteWidthControl } from '../NoteWidthControl';
import { ZoomControl } from '../ZoomControl';

interface TabActionsProps {
  /** Whether the ad blocker button is shown — web pages only (not the home page, a PDF, a terminal or History). */
  readonly showAdBlock: boolean;
  /** Whether the ad blocker is blocking on the page: on globally, and not turned off for this site. */
  readonly adBlockActive: boolean;
  /** Whether the ad blocker is switched off everywhere — the button then can't turn it on per site. */
  readonly adBlockGloballyOff: boolean;
  /** Requests, popups and elements blocked since the page began loading. */
  readonly adBlockBlockedCount: number;
  /** The page's hostname, for the button's accessible label. */
  readonly adBlockSite: string;
  /** Turns blocking off or back on for the page's site. */
  readonly onToggleAdBlock: () => void;
  /** Whether the zoom control is shown — hidden on a History, Bookmarks or Secrets tab, which don't zoom. */
  readonly showZoom: boolean;
  readonly canZoom: boolean;
  /** The tab's current zoom, within its range. */
  readonly zoomPercent: number;
  readonly onZoomOut: () => void;
  readonly onZoomIn: () => void;
  readonly onSetZoom: (percent: number) => void;
  /** A note's width slider, shown just left of the zoom on a Markdown tab with a note open; `null` elsewhere. */
  readonly noteWidth: {
    readonly percent: number;
    readonly minPercent: number;
    readonly enabled: boolean;
    readonly onChange: (percent: number) => void;
  } | null;
  /**
   * Whether these sit in the toolbar's one strip of page tools (`PageActions`), each group followed by a divider
   * from what comes next — rather than at the end of one half of a split's toolbar, with nothing after them.
   */
  readonly inStrip: boolean;
}

/**
 * One tab's own tools in the toolbar: the ad blocker for its site and its zoom. The active tab's sit in
 * `PageActions`; in split screen each half of the toolbar has its side's.
 */
export function TabActions({
  showAdBlock,
  adBlockActive,
  adBlockGloballyOff,
  adBlockBlockedCount,
  adBlockSite,
  onToggleAdBlock,
  showZoom,
  canZoom,
  zoomPercent,
  onZoomOut,
  onZoomIn,
  onSetZoom,
  noteWidth,
  inStrip,
}: TabActionsProps) {
  return (
    <>
      {showAdBlock && (
        <button
          type="button"
          className="page-actions__button hover-glow icon-hop page-actions__button--adblock chrome-tooltip"
          data-hop="shield"
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
      {(inStrip || (showAdBlock && showZoom)) && <span className="page-actions__divider" role="separator" aria-hidden="true" />}
      {showZoom && (
        <>
          {noteWidth && <NoteWidthControl {...noteWidth} />}
          <ZoomControl percent={zoomPercent} canZoom={canZoom} onZoomOut={onZoomOut} onZoomIn={onZoomIn} onSetZoom={onSetZoom} />
          {inStrip && <span className="page-actions__divider" role="separator" aria-hidden="true" />}
        </>
      )}
    </>
  );
}
