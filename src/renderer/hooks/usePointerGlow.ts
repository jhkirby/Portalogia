// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-24

import { useEffect, type RefObject } from 'react';

/**
 * Keeps an area's accent glow (`.pointer-glow`, see pointer-glow.css) under
 * the pointer: sets `--glow-x` / `--glow-y` on the area, in its own pixels,
 * from its pointer events. The tab row also passes `fromMain`: its empty
 * space is the OS drag region, which gets no events, so main reports the
 * pointer there instead (`onTitlebarPointerPosition`). Written straight to
 * the element, so following the pointer never re-renders the chrome.
 * @param areaRef The area the glow fills (the tab row, the sidebar).
 * @param fromMain Whether to follow main's reports of the pointer too.
 */
export function usePointerGlow(areaRef: RefObject<HTMLElement | null>, fromMain = false): void {
  useEffect(() => {
    const area = areaRef.current;
    if (!area) {
      return undefined;
    }
    let frame = 0;
    let pending: { x: number; y: number } | null = null;
    /** Moves the glow to a point of the window (CSS pixels), once per frame at most. */
    const moveTo = (x: number, y: number): void => {
      pending = { x, y };
      if (frame !== 0) {
        return;
      }
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (pending) {
          const box = area.getBoundingClientRect();
          area.style.setProperty('--glow-x', `${pending.x - box.left}px`);
          area.style.setProperty('--glow-y', `${pending.y - box.top}px`);
        }
      });
    };
    const onPointerMove = (event: PointerEvent): void => moveTo(event.clientX, event.clientY);
    area.addEventListener('pointermove', onPointerMove);
    const stopMain = fromMain ? window.portalogia.onTitlebarPointerPosition(({ x, y }) => moveTo(x, y)) : () => {};
    return () => {
      cancelAnimationFrame(frame);
      area.removeEventListener('pointermove', onPointerMove);
      stopMain();
    };
  }, [areaRef, fromMain]);
}
