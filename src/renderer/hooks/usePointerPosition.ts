// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { useEffect, useState } from 'react';

/** A point in the page, in its CSS pixels from the top-left of the view. */
export interface PointerPosition {
  readonly x: number;
  readonly y: number;
}

/**
 * How a stat bar shows the pointer's position: `x×y`, or dashes while it's outside the page.
 * @param position The position, or `null` when the pointer isn't over the page.
 */
export function formatPointerPosition(position: PointerPosition | null): string {
  return position ? `${position.x}×${position.y}` : '–×–';
}

/**
 * Where the pointer is over this page's content, for a stat bar: updated at
 * most once a frame as it moves, and `null` once it leaves.
 *
 * With `frameSelector`, the content is the framed box it names — a PDF, note
 * or terminal sits in a frame with the chrome's animated background around
 * it — and the position is measured from that frame's inside top-left, `null`
 * while the pointer is over the background. That matches a web page's, whose
 * own view is exactly the inside of its frame.
 * @param frameSelector The framed content's selector, or none to measure the whole page.
 * @returns The position, or `null`.
 */
export function usePointerPosition(frameSelector?: string): PointerPosition | null {
  const [position, setPosition] = useState<PointerPosition | null>(null);

  useEffect(() => {
    let frame = 0;
    let latest: PointerPosition | null = null;
    const onMove = (event: MouseEvent): void => {
      latest = positionIn(frameSelector, event.clientX, event.clientY);
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          setPosition(latest);
        });
      }
    };
    const onLeave = (): void => {
      cancelAnimationFrame(frame);
      frame = 0;
      setPosition(null);
    };
    window.addEventListener('pointermove', onMove, { capture: true, passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    // While the laser pointer's overlay covers the page, the page sees no pointer; its preload passes the position on
    // as these instead (see `tab:pointer-position`).
    window.addEventListener('northstar-pointer', onMove as EventListener);
    window.addEventListener('northstar-pointer-leave', onLeave);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove, { capture: true });
      document.documentElement.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('northstar-pointer', onMove as EventListener);
      window.removeEventListener('northstar-pointer-leave', onLeave);
    };
  }, [frameSelector]);

  return position;
}

/**
 * A pointer's position, measured from the inside of the framed content (its border excluded) or the whole page.
 * @param frameSelector The framed content's selector, or none for the whole page.
 * @param clientX The pointer's x, in the page's CSS pixels.
 * @param clientY The pointer's y, in the page's CSS pixels.
 * @returns The position, or `null` while it's outside the frame (or the frame isn't there).
 */
function positionIn(frameSelector: string | undefined, clientX: number, clientY: number): PointerPosition | null {
  if (frameSelector === undefined) {
    return { x: Math.round(clientX), y: Math.round(clientY) };
  }
  const box = document.querySelector<HTMLElement>(frameSelector);
  if (!box) {
    return null;
  }
  const rect = box.getBoundingClientRect();
  const x = clientX - rect.left - box.clientLeft;
  const y = clientY - rect.top - box.clientTop;
  if (x < 0 || y < 0 || x >= box.clientWidth || y >= box.clientHeight) {
    return null;
  }
  return { x: Math.round(x), y: Math.round(y) };
}
