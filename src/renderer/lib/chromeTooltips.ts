// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { computeTooltipOverlayRect } from './tooltipOverlay';

/** How long the pointer rests on an element before its tooltip shows. */
const HOVER_DELAY_MS = 400;

/** What has a tooltip: its text in `data-tooltip`. */
const TOOLTIP_SELECTOR = '.chrome-tooltip[data-tooltip]';

/**
 * Shows the chrome's tooltips. Any element marked `.chrome-tooltip` with its
 * text in `data-tooltip` gets one after the pointer rests on it for a moment.
 *
 * Every tooltip is drawn by `TooltipOverlay` — a native view the main process
 * stacks above everything in the window, the tab's own page included — rather
 * than inside the chrome's page, where the toolbar, the tab row and the tab's
 * native view could each paint over it. It is placed by `placeTooltip`: above
 * its element, or below where there's no room, and always inside the window.
 *
 * Pressing anywhere, scrolling, a key, or the window losing focus hides it,
 * until the pointer moves onto something else. Call once, at the chrome's start.
 */
export function installChromeTooltips(): void {
  let current: Element | null = null;
  let timer = 0;
  let shown = false;

  const hide = (): void => {
    window.clearTimeout(timer);
    timer = 0;
    if (shown) {
      shown = false;
      window.northstar.syncTooltip({ visible: false, text: '', rect: null });
    }
  };

  const show = (): void => {
    timer = 0;
    const text = current?.getAttribute('data-tooltip');
    if (!current || !current.isConnected || !text) {
      return;
    }
    const rect = computeTooltipOverlayRect(text, current.getBoundingClientRect(), {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    shown = true;
    window.northstar.syncTooltip({ visible: true, text, rect });
  };

  // The innermost element with a tooltip under the pointer; a move within it changes nothing.
  document.addEventListener(
    'pointerover',
    (event) => {
      const target = event.target instanceof Element ? event.target.closest(TOOLTIP_SELECTOR) : null;
      if (target === current) {
        return;
      }
      hide();
      current = target;
      if (target) {
        timer = window.setTimeout(show, HOVER_DELAY_MS);
      }
    },
    true,
  );

  // Leaving the element for something without a tooltip (or the window).
  document.addEventListener(
    'pointerout',
    (event) => {
      const next = event.relatedTarget instanceof Element ? event.relatedTarget.closest(TOOLTIP_SELECTOR) : null;
      if (current && next !== current) {
        hide();
        current = null;
      }
    },
    true,
  );

  // A press, a scroll or a key moves things on: the tooltip goes, and stays gone while the pointer stays put — a
  // button's text often changes with its click ("Hide sidebar" becomes "Show sidebar").
  const dismiss = (): void => hide();
  document.addEventListener('pointerdown', dismiss, true);
  document.addEventListener('wheel', dismiss, { capture: true, passive: true });
  document.addEventListener('scroll', dismiss, true);
  document.addEventListener('keydown', dismiss, true);
  window.addEventListener('blur', () => {
    hide();
    current = null;
  });
}
