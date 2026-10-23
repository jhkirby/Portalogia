// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

import { ipcRenderer, webFrame } from 'electron';
// Folded into this same preload entry rather than given its own
// `webPreferences.preload` — only one preload path can be set per
// `WebContentsView` (see `TabManager.createTab`), and a module imported by
// two Rollup entries in the same build gets split into a shared chunk the
// sandboxed CJS loader can't `require()` (see that file's own comment).
import './tabHighlighter';
import './tabComments';
import './tabTextBoxes';
import './tabFind';
import './tabPen';
import './tabEditableFocus';
import './tabPan';
import './tabStats';

// Hardcoded rather than imported from `@shared/ipc-contract` — see
// `src/preload/terminal.ts`'s own comment: a value shared between two
// entries in the same preload Rollup build gets split into a separate
// chunk file the sandboxed preload loader can't `require()`.
const ZoomApply = 'zoom:apply';

// `webFrame.setZoomLevel` (this frame's own zoom, set from inside the
// renderer) rather than the main-process `contents.zoomLevel` this used to
// be pushed through — that one is per-*origin*, shared by every
// `webContents` showing the same origin, which is exactly how a browser
// tab's zoom used to leak into the chrome's own toolbar/sidebar (same
// dev-server origin) instead of staying scoped to just that tab. See
// `TabManager.applyZoom`, which pushes here instead of setting it directly.
//
// No `contextBridge` export: the page itself never gets a handle on
// `ipcRenderer`/`webFrame` at all, only this preload does — applying a
// main-process-pushed zoom level is this file's entire job.
ipcRenderer.on(ZoomApply, (_event, level: number) => {
  webFrame.setZoomLevel(level);
});

// Ctrl+mouse wheel zooms the tab by `ZOOM_PERCENT_WHEEL_STEP` per tick,
// decided in main (`TabManager.wheelZoom`). `preventDefault` also blocks
// Chromium's own pinch/ctrl-wheel visual zoom. Capture phase so a page's
// own handlers can't swallow it first. Literal channel name, not imported —
// see the comment on `ZoomApply` for why.
window.addEventListener(
  'wheel',
  (event) => {
    // With Shift held too, Windows turns the wheel sideways, so the step comes in `deltaX`; Shift asks for the coarse
    // step (`ZOOM_PERCENT_WHEEL_STEP_COARSE`).
    const delta = event.deltaY || event.deltaX;
    if (!event.ctrlKey || delta === 0) {
      return;
    }
    event.preventDefault();
    ipcRenderer.send('zoom:wheel', { direction: delta < 0 ? 1 : -1, coarse: event.shiftKey });
  },
  { passive: false, capture: true },
);
