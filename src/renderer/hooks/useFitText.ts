// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { useLayoutEffect, type RefObject } from 'react';

/** The least step, in px, the size is nudged down by when rounding leaves the text a sliver too wide. */
const NUDGE_PX = 0.5;

/**
 * Sizes a one-line element's text to fit its width: at `maxPx` when it fits,
 * otherwise as small as it needs to be, but never below `minPx` (then the
 * element's own ellipsis cuts it short, still readable). Refitted whenever the
 * text changes or the element's container resizes — a tab narrowing as more
 * open beside it, or widening as they close.
 *
 * The size is set straight on the element's style, not through React state:
 * fitting happens on every frame of a resize, and a render each time would buy
 * nothing.
 * @param ref The element: one line (`white-space: nowrap`), its width set by its layout rather than its text.
 * @param text What it shows; a change refits it.
 * @param maxPx Its full font size.
 * @param minPx The smallest it may go.
 */
export function useFitText(ref: RefObject<HTMLElement | null>, text: string, maxPx: number, minPx: number): void {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return undefined;
    }
    const fit = (): void => {
      element.style.fontSize = `${maxPx}px`;
      const available = element.clientWidth;
      const needed = element.scrollWidth;
      if (needed <= available || available <= 0) {
        return;
      }
      // Text widens in step with its font size, so one measurement gives the size that fits.
      let size = Math.max(minPx, Math.floor(((maxPx * available) / needed) * 10) / 10);
      element.style.fontSize = `${size}px`;
      while (size > minPx && element.scrollWidth > element.clientWidth) {
        size = Math.max(minPx, size - NUDGE_PX);
        element.style.fontSize = `${size}px`;
      }
    };
    fit();
    // The container, not the element: the element's own height changes with its font size, which would refit it again.
    const observer = new ResizeObserver(fit);
    observer.observe(element.parentElement ?? element);
    return () => observer.disconnect();
  }, [ref, text, maxPx, minPx]);
}
