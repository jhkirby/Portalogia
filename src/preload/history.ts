// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-05

import { contextBridge, ipcRenderer, webFrame } from 'electron';
import type { HistoryClearRange, HistoryEntry, NorthstarHistoryApi } from '@shared/ipc-contract';

// Channel names inlined as literals — see `terminal.ts` for why a sandboxed
// preload can't share the `IpcChannel` runtime object. `HistoryController`
// (main) sends and listens on the same strings.
const HistoryEntries = 'history:entries';
const HistoryDelete = 'history:delete';
const HistoryClear = 'history:clear';
const ZoomApply = 'zoom:apply';
const ZoomWheel = 'zoom:wheel';

// Main pushes a Chromium zoom *level* (powers of 1.2) for this tab; the page
// is plain HTML, so the frame's own zoom does the job, same as `tabZoom.ts`.
ipcRenderer.on(ZoomApply, (_event, level: number) => {
  webFrame.setZoomLevel(level);
});

// Ctrl+wheel zooms the tab; main steps the zoom and pushes it back through `ZoomApply` above.
window.addEventListener(
  'wheel',
  (event) => {
    if (!event.ctrlKey || event.deltaY === 0) {
      return;
    }
    event.preventDefault();
    ipcRenderer.send(ZoomWheel, { direction: event.deltaY < 0 ? 1 : -1 });
  },
  { passive: false, capture: true },
);

let latestEntries: readonly HistoryEntry[] | null = null;
const entryListeners = new Set<(entries: readonly HistoryEntry[]) => void>();
ipcRenderer.on(HistoryEntries, (_event, entries: readonly HistoryEntry[]) => {
  latestEntries = entries;
  entryListeners.forEach((listener) => listener(entries));
});

const api: NorthstarHistoryApi = {
  onEntries: (listener) => {
    entryListeners.add(listener);
    if (latestEntries !== null) {
      listener(latestEntries);
    }
    return () => {
      entryListeners.delete(listener);
    };
  },
  deleteEntry: (id: string) => {
    ipcRenderer.send(HistoryDelete, { id });
  },
  clear: (range: HistoryClearRange) => {
    ipcRenderer.send(HistoryClear, range);
  },
};

contextBridge.exposeInMainWorld('northstarHistory', api satisfies NorthstarHistoryApi);
