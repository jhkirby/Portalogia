// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

/** The id of the stylesheet `startWindFog` adds to a page once, however many fogs it starts there. */
const STYLE_ID = 'northstar-wind-fog';

/** How many wisps cross at once: enough that there's always one under way, few enough to stay faint. */
const WISP_COUNT = 4;

/**
 * The fog's look. Each wisp is a wide, soft, blurred patch of light grey that drifts in from the left edge and out past
 * the right, swelling and thinning as it goes, like fog carried on wind — each at its own height, speed and starting
 * point, so the crossings never line up. Only transforms and opacity animate, so it costs the compositor and nothing
 * else. A mid grey on a light page, fainter, where a light one wouldn't show.
 */
const CSS = `
.wind-fog {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  --wind-fog-rgb: 205, 208, 214;
  --wind-fog-alpha: 0.1;
}

@media (prefers-color-scheme: light) {
  .wind-fog {
    --wind-fog-rgb: 110, 114, 120;
    --wind-fog-alpha: 0.08;
  }
}

.wind-fog__wisp {
  position: absolute;
  left: -60%;
  width: 70%;
  height: 46%;
  border-radius: 50%;
  background: radial-gradient(closest-side, rgba(var(--wind-fog-rgb), var(--wind-fog-alpha)), transparent);
  filter: blur(26px);
  opacity: 0;
  will-change: transform, opacity;
  animation: wind-fog-drift var(--wind-fog-duration) linear var(--wind-fog-delay) infinite;
}

.wind-fog__wisp:nth-child(1) { top: 2%; --wind-fog-duration: 27s; --wind-fog-delay: -6s; }
.wind-fog__wisp:nth-child(2) { top: 26%; --wind-fog-duration: 35s; --wind-fog-delay: -21s; height: 54%; }
.wind-fog__wisp:nth-child(3) { top: 50%; --wind-fog-duration: 31s; --wind-fog-delay: -13s; }
.wind-fog__wisp:nth-child(4) { top: 66%; --wind-fog-duration: 42s; --wind-fog-delay: -33s; height: 40%; }

@keyframes wind-fog-drift {
  0% { transform: translate(0, 0) scale(0.9, 0.85); opacity: 0; }
  15% { opacity: 1; }
  50% { transform: translate(115%, -7%) scale(1.25, 1.05); }
  85% { opacity: 1; }
  100% { transform: translate(230%, 5%) scale(1.05, 0.9); opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .wind-fog__wisp {
    animation: none;
    opacity: 1;
    transform: translateX(80%);
  }
}
`;

/**
 * Starts a light grey fog drifting through a box like wind (see `CSS`): the quiet layer under the interactive
 * fluid (`startFluid`) on an empty note, PDF or new-tab page. It goes its own way — the pointer doesn't stir it,
 * the fluid doesn't move it, and it plays whether or not the page has the keyboard. Put first in the box, so anything
 * added to it afterwards (the fluid's canvas) paints over it.
 * @param host The positioned box to fill.
 * @returns A function that removes it.
 */
export function startWindFog(host: HTMLElement): () => void {
  const doc = host.ownerDocument;
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    doc.head.appendChild(style);
  }
  const layer = doc.createElement('div');
  layer.className = 'wind-fog';
  layer.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < WISP_COUNT; i += 1) {
    const wisp = doc.createElement('span');
    wisp.className = 'wind-fog__wisp';
    layer.appendChild(wisp);
  }
  host.prepend(layer);
  return () => layer.remove();
}
