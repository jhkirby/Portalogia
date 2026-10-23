// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

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

// Where the pointer is over the overlay — the same place over the tab beneath, which it covers exactly — for the tab's
// stat bar, whose page can't see the pointer while the overlay takes it. At most once a frame; `null` once it leaves.
const LaserPointerMove = 'laser-pointer:move';
let moveFrame = 0;
let latest: { x: number; y: number } | null = null;
window.addEventListener(
  'pointermove',
  (event) => {
    latest = { x: event.clientX, y: event.clientY };
    if (!moveFrame) {
      moveFrame = requestAnimationFrame(() => {
        moveFrame = 0;
        ipcRenderer.send(LaserPointerMove, latest);
      });
    }
  },
  { passive: true },
);
document.documentElement.addEventListener('pointerleave', () => {
  cancelAnimationFrame(moveFrame);
  moveFrame = 0;
  ipcRenderer.send(LaserPointerMove, null);
});
