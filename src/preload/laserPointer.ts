// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-30

import { ipcRenderer } from 'electron';

// Channel name copied as a literal — see `src/preload/suggestions.ts`'s own
// comment on this pattern.
const LaserPointerWheel = 'laser-pointer:wheel';

// The overlay swallows every mouse event over the page, wheel included, so
// forward each wheel tick to the main process, which replays it onto the
// tab underneath. No API is exposed to the page: this is a one-way relay.
window.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    ipcRenderer.send(LaserPointerWheel, {
      x: event.clientX,
      y: event.clientY,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
    });
  },
  { passive: false },
);
