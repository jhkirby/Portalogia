// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-25

import { ipcRenderer, webFrame } from 'electron';

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
