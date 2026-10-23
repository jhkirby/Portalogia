// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

import { contextBridge, ipcRenderer } from 'electron';
import type { FindCommand, FindResult, NorthstarTerminalApi } from '@shared/ipc-contract';
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
const FindCommandChannel = 'find:command';
const FindResultChannel = 'find:result';
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
//
// Not the page's zoom, though, for a terminal: the level is handed to the terminal, which sizes its own text by it,
// so its stat bar (and everything else outside xterm) stays the same size at any zoom. Kept, for a listener added
// after the first push.
let latestZoomLevel = 0;
const zoomListeners = new Set<(level: number) => void>();
ipcRenderer.on(ZoomApply, (_event, level: number) => {
  latestZoomLevel = level;
  zoomListeners.forEach((listener) => listener(level));
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

// While the laser pointer's overlay covers this page, main passes on where the pointer is (the page itself sees no
// pointer events then), raised as a page event for the stat bar's pointer readout (`usePointerPosition`): plain
// numbers in a DOM event cross into the page, where a preload object wouldn't.
ipcRenderer.on('tab:pointer-position', (_event, point: { x: number; y: number } | null) => {
  window.dispatchEvent(
    point ? new MouseEvent('northstar-pointer', { clientX: point.x, clientY: point.y }) : new Event('northstar-pointer-leave'),
  );
});

// Whether the window is in Focus Mode: the stat bar hides with the chrome. Kept, so a listener added later hears it.
const TabFocusMode = 'tab:focus-mode';
let latestFocusMode = false;
const focusModeListeners = new Set<(focusMode: boolean) => void>();
ipcRenderer.on(TabFocusMode, (_event, focusMode: unknown) => {
  latestFocusMode = focusMode === true;
  focusModeListeners.forEach((listener) => listener(latestFocusMode));
});

const api: NorthstarTerminalApi = {
  onZoom: (listener) => {
    listener(latestZoomLevel);
    zoomListeners.add(listener);
    return () => {
      zoomListeners.delete(listener);
    };
  },
  onFocusMode: (listener) => {
    listener(latestFocusMode);
    focusModeListeners.add(listener);
    return () => {
      focusModeListeners.delete(listener);
    };
  },
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
  onFind: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, command: FindCommand): void => listener(command);
    ipcRenderer.on(FindCommandChannel, handler);
    return () => ipcRenderer.removeListener(FindCommandChannel, handler);
  },
  reportFind: (result: FindResult) => ipcRenderer.send(FindResultChannel, result),
};

contextBridge.exposeInMainWorld('northstarTerminal', api satisfies NorthstarTerminalApi);
