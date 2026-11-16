// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-18

import { useCallback, useRef, useState, type MouseEvent } from 'react';

/** One click's ripple: where it starts in its element, and the diameter that reaches the element's farthest corner. */
export interface ClickRipple {
  readonly id: number;
  /** What was clicked (a tab or workspace id), so one list can serve a whole row of them. */
  readonly ownerId: string;
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

/**
 * The accent-coloured ripples a click on a tab or a workspace spreads from the
 * pointer (drawn by `.click-ripple`, click-ripple.css).
 * @returns The live ripples, `add` to start one from a click, and `remove` for when one's animation ends.
 */
export function useClickRipples(): {
  ripples: readonly ClickRipple[];
  add: (ownerId: string, event: MouseEvent<HTMLElement>) => void;
  remove: (id: number) => void;
} {
  const [ripples, setRipples] = useState<readonly ClickRipple[]>([]);
  const nextIdRef = useRef(0);

  const add = useCallback((ownerId: string, event: MouseEvent<HTMLElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const reach = Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y));
    nextIdRef.current += 1;
    const ripple: ClickRipple = { id: nextIdRef.current, ownerId, x, y, size: reach * 2 };
    setRipples((previous) => [...previous, ripple]);
  }, []);

  const remove = useCallback((id: number): void => {
    setRipples((previous) => previous.filter((ripple) => ripple.id !== id));
  }, []);

  return { ripples, add, remove };
}
