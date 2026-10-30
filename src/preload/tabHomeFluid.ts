// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { ipcRenderer } from 'electron';
import { accentFluidPalette, startFluid, type FluidColor } from '@shared/dom/fluidSim';
import { startWindFog } from '@shared/dom/windFog';

// Hardcoded rather than imported from `@shared/ipc-contract` — see `tabZoom.ts`'s own comment on `ZoomApply`.
const TabAccent = 'tab:accent';
const TabAccentChanged = 'tab:accent-changed';
/** The new-tab page (`HOME_URL`), which has no script of its own to run the fluid with. */
const HOME_URL = 'northstar://home/';

/** The app's default accent, each channel 0–1: what the fluid shows if main can't say. */
const DEFAULT_ACCENT: FluidColor = [26 / 255, 115 / 255, 232 / 255];

/** An accent from main (`RGB`, 0–255), each channel 0–1; `null` if it isn't one. */
function toColor(value: unknown): FluidColor | null {
  const rgb = value as { r?: unknown; g?: unknown; b?: unknown } | null;
  return rgb && typeof rgb.r === 'number' && typeof rgb.g === 'number' && typeof rgb.b === 'number'
    ? [rgb.r / 255, rgb.g / 255, rgb.b / 255]
    : null;
}

/** The accent main last heard of (`pageSelectionAccent.ts`). */
function accent(): FluidColor {
  try {
    return toColor(ipcRenderer.sendSync(TabAccent)) ?? DEFAULT_ACCENT;
  } catch {
    return DEFAULT_ACCENT;
  }
}

// The new-tab page is filled with the same fluid as an empty note or PDF tab (`startFluid`), stirred by the pointer
// anywhere on it. Every other page is left alone.
if (window.location.href === HOME_URL) {
  window.addEventListener(
    'DOMContentLoaded',
    () => {
      const host = document.createElement('div');
      host.setAttribute('aria-hidden', 'true');
      Object.assign(host.style, { position: 'fixed', inset: '0', overflow: 'hidden', pointerEvents: 'none' });
      document.body.appendChild(host);
      // Follows the accent as it's changed, as an empty note's or PDF's fluid does.
      let palette = accentFluidPalette(accent());
      ipcRenderer.on(TabAccentChanged, (_event, rgb: unknown) => {
        const color = toColor(rgb);
        if (color) {
          palette = accentFluidPalette(color);
        }
      });
      // Only while the page has the keyboard, as an empty note's or PDF's: otherwise it fades away.
      startFluid(host, { palette: () => palette, events: window, active: () => document.hasFocus() });
      // Under it, a light grey fog drifting through on its own, focus or not (put first, so the fluid paints over it).
      startWindFog(host);
    },
    { once: true },
  );
}
