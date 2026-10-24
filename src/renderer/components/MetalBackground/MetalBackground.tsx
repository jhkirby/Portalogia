// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-24

import { useEffect, useRef } from 'react';
import { THEME_FADE_MS } from '@shared/constants';
import { MetalFluid } from '../../lib/metalFluid';

/** Whether the chrome's theme (`<html data-theme>`, see `useTheme`) is dark now. */
function isDark(): boolean {
  return document.documentElement.dataset['theme'] === 'dark';
}

/**
 * The slowly flowing metal behind every tab's content (`MetalFluid`): it
 * fills the tab area, and shows in the margin around the frame a tab sits
 * in — around a web page's view, and through the see-through margins of the
 * app's own pages. Purely a backdrop: it never takes the pointer.
 *
 * A light/dark switch doesn't change the metal in view: it holds still, and
 * a cover in the new theme's toolbar colour fades in over it in step with the
 * rest of the app's colours (`THEME_FADE_MS`). Once the switch is done, the
 * metal turns to the new theme's under the cover, and the cover fades away
 * again (as long again) to show it flowing on.
 */
export function MetalBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const coverRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const cover = coverRef.current;
    if (!canvas || !cover) {
      return undefined;
    }
    let dark = isDark();
    const fluid = new MetalFluid(canvas, dark);
    let timer = 0;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const observer = new MutationObserver(() => {
      const next = isDark();
      if (next === dark) {
        return;
      }
      dark = next;
      window.clearTimeout(timer);
      if (reducedMotion.matches) {
        fluid.setDark(next);
        return;
      }
      fluid.hold(true);
      cover.style.opacity = '1';
      timer = window.setTimeout(() => {
        // Covered: the metal turns to the new theme's and flows again, and the cover fades away to show it.
        fluid.setDark(next);
        fluid.hold(false);
        cover.style.opacity = '0';
      }, THEME_FADE_MS);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
      fluid.stop();
    };
  }, []);
  return (
    <>
      <canvas ref={canvasRef} className="metal-background" aria-hidden="true" />
      <div ref={coverRef} className="metal-background__cover" aria-hidden="true" />
    </>
  );
}
