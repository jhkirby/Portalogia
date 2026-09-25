// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-25

import { useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import { computeTooltipOverlayRect } from '../lib/tooltipOverlay';

/** Matches tooltip.css's own `transition-delay` — the plain CSS tooltip everywhere else in the chrome waits this long before fading in, so this one should feel the same. */
const HOVER_DELAY_MS = 400;

/**
 * Drives `TooltipOverlay` (a native `WebContentsView` stacked above the
 * active tab's own view) for a chrome element whose plain CSS `::after`
 * tooltip (tooltip.css) can't safely grow past the collapsed sidebar's
 * `--size-sidebar-collapsed-width` without the tab's native content
 * painting over it — see `SIDEBAR_COLLAPSED_WIDTH_PX`'s own comment.
 * Currently only `WorkspaceBar`'s `.sidebar__toggle` and "+ New workspace"
 * buttons need this; every other `.chrome-tooltip` consumer lives
 * somewhere the tab's view never reaches, so the plain CSS one is enough.
 *
 * @param text The tooltip's own text — re-measured (`computeTooltipOverlayRect`) on every hover, so a caller can pass something that changes (e.g. "Show sidebar" vs "Hide sidebar") without this hook needing to know why.
 * @returns `onMouseEnter`/`onMouseLeave` to spread onto the element in place of `.chrome-tooltip`'s `data-tooltip` attribute, plus `hide` for callers that need to dismiss it eagerly (e.g. on click, before a layout shift moves the anchor out from under it).
 */
export function useOverlayTooltip(text: string) {
  const timeoutRef = useRef<number | null>(null);

  const hide = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    window.northstar.syncTooltip({ visible: false, text: '', rect: null });
  }, []);

  // Unmounting mid-hover (e.g. Focus Mode hiding `.sidebar__toggle`
  // outright) must not leave a stale tooltip floating over the tab.
  useEffect(() => hide, [hide]);

  const onMouseEnter = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      // Measured now, while the element is still in the DOM at its
      // pre-hover position — `computeTooltipOverlayRect` itself runs only
      // once the delay elapses, but the anchor it measures against has to
      // be captured up front.
      const anchor = event.currentTarget.getBoundingClientRect();
      timeoutRef.current = window.setTimeout(() => {
        window.northstar.syncTooltip({ visible: true, text, rect: computeTooltipOverlayRect(text, anchor) });
      }, HOVER_DELAY_MS);
    },
    [text],
  );

  return { onMouseEnter, onMouseLeave: hide, hide };
}
