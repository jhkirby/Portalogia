// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-24

import { contextBridge, ipcRenderer, webFrame } from 'electron';
import type { NorthstarTerminalApi } from '@shared/ipc-contract';
import type { RGB } from '@shared/color';

// Deliberately NOT importing the `IpcChannel` runtime object from
// `@shared/ipc-contract` here, even though `src/preload/index.ts` does —
// both are entries in the same Rollup build (see electron.vite.config.ts),
// and a value shared between two entries gets pulled into a separate
// chunk file. Electron's *sandboxed* preload loader only knows how to run
// its one bundled entry file; it can't `require()` a sibling chunk (that
// failure took down both preloads at once, silently, since the loader
// swallows the error into a console message rather than surfacing it
// anywhere obvious). A plain `import type` costs nothing here (erased at
// compile time, never a runtime module), but these four channel names —
// stable, effectively never-changing strings — are copied rather than
// imported so this bundle stays fully self-contained.
const TerminalInput = 'terminal:input';
const TerminalResize = 'terminal:resize';
const TerminalData = 'terminal:data';
const TerminalExited = 'terminal:exited';
const ZoomApply = 'zoom:apply';
// Same hardcoded string `HighlighterController` (main) and
// `src/preload/tabHighlighter.ts` (a browser tab's own preload) both use for
// this — not shared as a runtime import for the same chunking reason noted
// above, and reused verbatim here rather than invented fresh so one push
// from `HighlighterController.syncState` reaches either kind of tab's
// preload identically.
const HighlighterState = 'highlighter:state';

// `webFrame.setZoomLevel`, not `contextBridge` — see
// `src/preload/tabZoom.ts` (the same listener, for a browser tab's own
// view) for why this has to be frame-local rather than the main-process
// `contents.zoomLevel` it used to be pushed through.
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
    if (!event.ctrlKey || event.deltaY === 0) {
      return;
    }
    event.preventDefault();
    ipcRenderer.send('zoom:wheel', { direction: event.deltaY < 0 ? 1 : -1 });
  },
  { passive: false, capture: true },
);

const api: NorthstarTerminalApi = {
  sendTerminalInput: (id, data) => ipcRenderer.send(TerminalInput, { id, data }),
  resizeTerminal: (id, cols, rows) => ipcRenderer.send(TerminalResize, { id, cols, rows }),
  onTerminalData: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { id: string; data: string }): void => {
      listener(payload.id, payload.data);
    };
    ipcRenderer.on(TerminalData, handler);
    return () => ipcRenderer.removeListener(TerminalData, handler);
  },
  onTerminalExited: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { id: string }): void => {
      listener(payload.id);
    };
    ipcRenderer.on(TerminalExited, handler);
    return () => ipcRenderer.removeListener(TerminalExited, handler);
  },

  onHighlighterState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { active: boolean; color: RGB }): void => {
      listener(payload.active, payload.color);
    };
    ipcRenderer.on(HighlighterState, handler);
    return () => ipcRenderer.removeListener(HighlighterState, handler);
  },
};

contextBridge.exposeInMainWorld('northstarTerminal', api satisfies NorthstarTerminalApi);
