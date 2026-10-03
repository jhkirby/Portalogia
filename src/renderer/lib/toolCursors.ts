// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-02

import type { RGB } from '@shared/color';
import { rgbToHex } from './color';

/** Light ink in dark mode, dark in light mode — same rule as `toolInk` in `tabHighlighter.ts`. */
function ink(): string {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? '%23f2f2f2' : '%23222';
}

// Copies of the cursors the browser-tab tools inject into pages
// (`src/preload/tabPen.ts`, `tabHighlighter.ts`, `tabComments.ts`), for the
// PDF viewer's own tools. A preload bundle can't share modules with the
// renderer, so keep them in sync by hand. Each is a single-quoted `url(...)`:
// the SVG's own attributes are double-quoted, and a double-quoted wrapper
// would end the CSS string at the SVG's first quote.

/** Pen-nib cursor. */
export function penCursor(): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
    '<path d="M4 20 5.2 15.6 14.8 6 18 9.2 8.4 18.8 4 20Z" fill="' + ink() + '" stroke="' + ink() + '" stroke-width="1.2" stroke-linejoin="round"/>' +
    '<path d="m14.8 6 2-2a1.7 1.7 0 0 1 2.4 0l.8.8a1.7 1.7 0 0 1 0 2.4l-2 2Z" fill="none" stroke="' + ink() + '" stroke-width="1.4" stroke-linejoin="round"/>' +
    '</svg>';
  return `url('data:image/svg+xml,${svg}') 2 22, crosshair`;
}

/** Highlighter-marker cursor. */
export function highlighterCursor(): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
    '<path d="M9.7 15.3 15.3 9.7l4 4-5.6 5.6a1 1 0 0 1-1.4 0l-2.6-2.6a1 1 0 0 1 0-1.4Z" fill="' + ink() + '"/>' +
    '<path d="m15.3 9.7 4.6-4.6a1.7 1.7 0 0 1 2.4 2.4l-4.6 4.6-2.4-2.4Z" fill="none" stroke="' + ink() + '" stroke-width="1.6"/>' +
    '<path d="m9.5 15.5-5 5 2 2 5-5" fill="none" stroke="' + ink() + '" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';
  return `url('data:image/svg+xml,${svg}') 2 22, text`;
}

/** Speech-bubble cursor filled with the accent color. */
export function commentCursor(color: RGB): string {
  const fill = `%23${rgbToHex(color).slice(1).toLowerCase()}`;
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
    `<path d="M3 4.5h16a2 2 0 0 1 2 2V14a2 2 0 0 1-2 2H10l-5 4.5V16H3a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2Z" fill="${fill}" stroke="${ink()}" stroke-width="1.2"/>` +
    '</svg>';
  return `url('data:image/svg+xml,${svg}') 1 22, text`;
}
