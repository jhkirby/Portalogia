// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-05

import { contextBridge, ipcRenderer } from 'electron';
import type { HistoryEntry, NorthstarHistoryApi } from '@shared/ipc-contract';

// Channel names inlined as literals — see `terminal.ts` for why a sandboxed
// preload can't share the `IpcChannel` runtime object. `HistoryController`
// (main) sends and listens on the same strings.
const HistoryEntries = 'history:entries';
const HistoryQuery = 'history:query';
const HistoryDelete = 'history:delete';

// The page has no zoom: stopping Ctrl+wheel here keeps Chromium's own pinch/ctrl-wheel zoom from acting on it.
window.addEventListener(
  'wheel',
  (event) => {
    if (event.ctrlKey) {
      event.preventDefault();
    }
  },
  { passive: false, capture: true },
);

let latestEntries: readonly HistoryEntry[] | null = null;
const entryListeners = new Set<(entries: readonly HistoryEntry[]) => void>();
ipcRenderer.on(HistoryEntries, (_event, entries: readonly HistoryEntry[]) => {
  latestEntries = entries;
  entryListeners.forEach((listener) => listener(entries));
});

let latestQuery: string | null = null;
const queryListeners = new Set<(query: string) => void>();
ipcRenderer.on(HistoryQuery, (_event, query: string) => {
  latestQuery = query;
  queryListeners.forEach((listener) => listener(query));
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
  onQuery: (listener) => {
    queryListeners.add(listener);
    if (latestQuery !== null) {
      listener(latestQuery);
    }
    return () => {
      queryListeners.delete(listener);
    };
  },
  deleteEntry: (id: string) => {
    ipcRenderer.send(HistoryDelete, { id });
  },
};

contextBridge.exposeInMainWorld('northstarHistory', api satisfies NorthstarHistoryApi);
