// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-19

import { useEffect, useMemo, useState, type RefObject } from 'react';
import { DragPanner } from '@shared/DragPanner';

interface UseMarkdownPanParams {
  /** Whether a press on the note grabs it: Pan mode, a note open, and no annotation tool on. */
  readonly enabled: boolean;
  /** The element holding the note's view (the reader or the editor) and its side panel. */
  readonly bodyRef: RefObject<HTMLElement | null>;
  /** The element that scrolls the note right now: the reader's scroll box, or the editor's. */
  readonly scrollerOf: () => HTMLElement | null;
}

/**
 * Whether a point is on one of an element's own scroll bars, which keep working as scroll bars in Pan mode.
 * @param el The scrolling element.
 * @param x The pointer's x.
 * @param y The pointer's y.
 */
function isOnScrollbar(el: HTMLElement, x: number, y: number): boolean {
  const rect = el.getBoundingClientRect();
  return x >= rect.left + el.clientLeft + el.clientWidth || y >= rect.top + el.clientTop + el.clientHeight;
}

/**
 * A note's Pan mode, the PDF viewer's hand for a note: press and drag
 * anywhere on the note to move it, with the pointer wrapping at the view's
 * edges (see `DragPanner`). Text can't be selected and links and tasks don't
 * take clicks; the side panel and the scroll bars work as always.
 * @param params What to pan, and whether to.
 * @returns Whether the note is grabbed right now, for the closed-hand cursor.
 */
export function useMarkdownPan({ enabled, bodyRef, scrollerOf }: UseMarkdownPanParams): boolean {
  const [isPanning, setIsPanning] = useState(false);
  const panner = useMemo(
    () =>
      new DragPanner({
        viewBounds: () => {
          const rect = scrollerOf()?.getBoundingClientRect();
          return rect ?? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
        },
        warpPointer: (x, y) => window.portalogiaMarkdown.warpPointer(x, y),
        now: () => performance.now(),
      }),
    [scrollerOf],
  );

  useEffect(() => {
    const body = bodyRef.current;
    if (!enabled || !body) {
      panner.release();
      setIsPanning(false);
      return undefined;
    }
    // A selection made in Select mode would be left stranded where nothing can change it.
    window.getSelection()?.removeAllRanges();

    /** The scroller a press lands in, if it lands on the note rather than the side panel or a scroll bar. */
    const scrollerUnder = (event: MouseEvent): HTMLElement | null => {
      const scroller = scrollerOf();
      const target = event.target instanceof Node ? event.target : null;
      return scroller && target && scroller.contains(target) && !isOnScrollbar(scroller, event.clientX, event.clientY)
        ? scroller
        : null;
    };
    const swallow = (event: Event): void => {
      event.preventDefault();
      event.stopPropagation();
    };

    const onPointerDown = (event: PointerEvent): void => {
      const scroller = event.button === 0 ? scrollerUnder(event) : null;
      if (!scroller) {
        return;
      }
      swallow(event);
      panner.press(scroller, event.clientX, event.clientY);
      // Captured, so the drag keeps going once the pointer leaves the view.
      body.setPointerCapture(event.pointerId);
      setIsPanning(true);
    };
    const onPointerMove = (event: PointerEvent): void => {
      if (panner.isPanning) {
        swallow(event);
        panner.move(event.clientX, event.clientY);
      }
    };
    const onPointerEnd = (event: PointerEvent): void => {
      if (panner.isPanning) {
        swallow(event);
        panner.release();
        setIsPanning(false);
      }
    };
    // A click on the note does nothing in Pan mode: a link, a task box or the editor's caret would otherwise take it.
    const onMouse = (event: MouseEvent): void => {
      if (event.button === 0 && scrollerUnder(event)) {
        swallow(event);
      }
    };

    const mouseTypes = ['mousedown', 'mouseup', 'click', 'dblclick'] as const;
    body.addEventListener('pointerdown', onPointerDown, true);
    body.addEventListener('pointermove', onPointerMove, true);
    body.addEventListener('pointerup', onPointerEnd, true);
    body.addEventListener('pointercancel', onPointerEnd, true);
    mouseTypes.forEach((type) => body.addEventListener(type, onMouse, true));
    return () => {
      body.removeEventListener('pointerdown', onPointerDown, true);
      body.removeEventListener('pointermove', onPointerMove, true);
      body.removeEventListener('pointerup', onPointerEnd, true);
      body.removeEventListener('pointercancel', onPointerEnd, true);
      mouseTypes.forEach((type) => body.removeEventListener(type, onMouse, true));
      panner.release();
      setIsPanning(false);
    };
  }, [enabled, bodyRef, scrollerOf, panner]);

  return isPanning;
}
