// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-03

import { useEffect, useState } from 'react';

/** How much of a document is in view: where its top and bottom edges fall, as whole percents of the document's height. */
export interface ScrollExtent {
  readonly top: number;
  readonly bottom: number;
}

/** How often the extent is looked at again even without a scroll, for a document that grows or shrinks as it loads. */
const RECHECK_MS = 500;

/** The tooltip each stat bar gives its scroll extent. */
export const SCROLL_EXTENT_TITLE =
  'The part of the document in view: where the top and the bottom of the view fall, as percents of the whole';

/**
 * How a stat bar shows a scroll extent: `0%–35%`, or dashes before there is a document.
 * @param extent The extent, or `null` with nothing to measure.
 */
export function formatScrollExtent(extent: ScrollExtent | null): string {
  return extent ? `${extent.top}%–${extent.bottom}%` : '–%–%';
}

/**
 * The extent an element's scroll shows.
 * @param element The scrolling element.
 */
export function scrollExtentOf(element: Element): ScrollExtent {
  const { scrollTop, scrollHeight, clientHeight } = element;
  if (scrollHeight <= clientHeight || scrollHeight <= 0) {
    return { top: 0, bottom: 100 };
  }
  const top = Math.max(0, Math.min(100, Math.round((scrollTop / scrollHeight) * 100)));
  const bottom = Math.max(top, Math.min(100, Math.round(((scrollTop + clientHeight) / scrollHeight) * 100)));
  return { top, bottom };
}

/** Whether an element scrolls up and down on its own (rather than only clipping). */
function scrolls(element: Element): boolean {
  const { overflowY } = getComputedStyle(element);
  return (overflowY === 'auto' || overflowY === 'scroll') && element.scrollHeight > element.clientHeight;
}

/**
 * The element that scrolls the document inside a frame: the one with the most to scroll, the frame itself included.
 * @param root The frame.
 */
function findScroller(root: Element): Element | null {
  let best: Element | null = null;
  let most = 0;
  for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
    const overflow = element.scrollHeight - element.clientHeight;
    if (overflow > most && scrolls(element)) {
      best = element;
      most = overflow;
    }
  }
  return best;
}

/**
 * Where the view sits in the document shown inside a frame — a note's body or
 * a PDF's — for a stat bar, kept up to date as it scrolls, resizes or loads.
 * @param frameSelector The frame's selector.
 * @returns The extent, or `null` while the frame isn't there.
 */
export function useScrollExtent(frameSelector: string): ScrollExtent | null {
  const [extent, setExtent] = useState<ScrollExtent | null>(null);

  useEffect(() => {
    let frame = 0;
    let scroller: Element | null = null;
    const measure = (): void => {
      const root = document.querySelector(frameSelector);
      if (!root) {
        setExtent(null);
        return;
      }
      if (!scroller || !root.contains(scroller) || !scrolls(scroller)) {
        scroller = findScroller(root);
      }
      const next = scroller ? scrollExtentOf(scroller) : { top: 0, bottom: 100 };
      setExtent((previous) => (previous?.top === next.top && previous.bottom === next.bottom ? previous : next));
    };
    const measureSoon = (event?: Event): void => {
      // The element that just scrolled is the one to follow, if it's inside the frame.
      const target = event?.target;
      if (target instanceof Element && scrolls(target) && document.querySelector(frameSelector)?.contains(target)) {
        scroller = target;
      }
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          measure();
        });
      }
    };
    document.addEventListener('scroll', measureSoon, { capture: true, passive: true });
    window.addEventListener('resize', measureSoon);
    const timer = window.setInterval(measure, RECHECK_MS);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(timer);
      document.removeEventListener('scroll', measureSoon, { capture: true });
      window.removeEventListener('resize', measureSoon);
    };
  }, [frameSelector]);

  return extent;
}
