// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

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
 * Where the pointer is over this page, for a stat bar: updated at most once a
 * frame as it moves, and `null` once it leaves the page.
 * @returns The position, or `null`.
 */
export function usePointerPosition(): PointerPosition | null {
  const [position, setPosition] = useState<PointerPosition | null>(null);

  useEffect(() => {
    let frame = 0;
    let latest: PointerPosition | null = null;
    const onMove = (event: MouseEvent): void => {
      latest = { x: Math.round(event.clientX), y: Math.round(event.clientY) };
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
  }, []);

  return position;
}
