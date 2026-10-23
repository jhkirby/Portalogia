// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

import { useEffect, useRef } from 'react';
import { accentFluidPalette, startFluid, type FluidColor } from '@shared/dom/fluidSim';
import '../../styles/components/fluid-background.css';
import { ACCENT_STORAGE_KEY, DEFAULT_ACCENT, readStoredAccent } from '../../lib/accentStorage';

/** The app's accent, as the colour picker last set it (shared storage), each channel 0–1. */
function storedAccent(): FluidColor {
  const { r, g, b } = readStoredAccent() ?? DEFAULT_ACCENT;
  return [r / 255, g / 255, b / 255];
}

/**
 * The fluid filling an empty note or PDF tab (`startFluid`): stirred by the pointer, rippling where it's clicked, in
 * the accent's colour. Fills its positioned parent, behind whatever else is in it.
 */
export function FluidBackground() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    // The accent's own colour, following it as it's changed in another window (a `storage` event).
    let palette = accentFluidPalette(storedAccent());
    const onStorage = (event: StorageEvent): void => {
      if (event.key === ACCENT_STORAGE_KEY) {
        palette = accentFluidPalette(storedAccent());
      }
    };
    window.addEventListener('storage', onStorage);
    // The pointer comes from the whole empty page, not this layer, which lets it through to what's above.
    const stop = startFluid(host, { palette: () => palette, events: host.parentElement ?? host });
    return () => {
      window.removeEventListener('storage', onStorage);
      stop();
    };
  }, []);

  return <div ref={hostRef} className="fluid-background" aria-hidden="true" />;
}
