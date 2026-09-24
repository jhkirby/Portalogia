// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-24

import { contextBridge, ipcRenderer } from 'electron';
import type { NorthstarTerminalApi } from '@shared/ipc-contract';

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
};

contextBridge.exposeInMainWorld('northstarTerminal', api satisfies NorthstarTerminalApi);
