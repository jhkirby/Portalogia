// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { useLayoutEffect, type RefObject } from 'react';

/** The least step, in px, the size is nudged down by when rounding leaves a text a sliver too wide. */
const NUDGE_PX = 0.5;

/**
 * Sizes a set of one-line texts together, so they always match: at `maxPx`
 * when every one fits, otherwise at the size the most crowded one needs, but
 * never below `minPx` (then their own ellipsis cuts the longest short, still
 * readable). The tab row's titles, so a long one never leaves its title
 * smaller than its neighbours'. Refitted when the container resizes, any of
 * the texts' boxes do, an animation inside ends, or `key` changes (a title
 * did).
 *
 * The size is set straight on the elements' style, not through React state:
 * fitting happens on every frame of a resize, and a render each time would buy
 * nothing.
 * @param containerRef What holds the texts.
 * @param selector Every text to size: one line (`white-space: nowrap`), its width set by its layout, not its text.
 * @param measureSelector The texts whose fit decides the size — those whose boxes are at rest (a tab still opening or
 *   closing is squeezed by its animation, and would shrink every title with it).
 * @param key Anything that changes when a text does, so they're refitted.
 * @param maxPx Their full font size.
 * @param minPx The smallest they may go.
 */
export function useSharedFitText(
  containerRef: RefObject<HTMLElement | null>,
  selector: string,
  measureSelector: string,
  key: string,
  maxPx: number,
  minPx: number,
): void {
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }
    let frame = 0;
    const fit = (): void => {
      frame = 0;
      const all = Array.from(container.querySelectorAll<HTMLElement>(selector));
      const measured = Array.from(container.querySelectorAll<HTMLElement>(measureSelector));
      const setAll = (size: number): void => {
        for (const element of all) {
          element.style.fontSize = `${size}px`;
        }
      };
      setAll(maxPx);
      // Text widens in step with its font size, so one measurement each gives the size every one of them fits at.
      let size = maxPx;
      for (const element of measured) {
        const available = element.clientWidth;
        const needed = element.scrollWidth;
        if (available > 0 && needed > available) {
          size = Math.min(size, (maxPx * available) / needed);
        }
      }
      size = Math.max(minPx, Math.floor(size * 10) / 10);
      if (size >= maxPx) {
        return;
      }
      setAll(size);
      const overflows = (): boolean => measured.some((element) => element.scrollWidth > element.clientWidth);
      while (size > minPx && overflows()) {
        size = Math.max(minPx, size - NUDGE_PX);
        setAll(size);
      }
    };
    const schedule = (): void => {
      if (!frame) {
        frame = requestAnimationFrame(fit);
      }
    };
    fit();
    // The texts' boxes (each one's parent, so its own height changing with its font size doesn't refit it again), and
    // the container as a whole.
    const observer = new ResizeObserver(schedule);
    observer.observe(container);
    for (const element of container.querySelectorAll<HTMLElement>(selector)) {
      observer.observe(element.parentElement ?? element);
    }
    // A tab done opening or closing now counts (or no longer does).
    container.addEventListener('animationend', schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      container.removeEventListener('animationend', schedule);
    };
  }, [containerRef, selector, measureSelector, key, maxPx, minPx]);
}
