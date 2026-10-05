// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-05

import { contextBridge, ipcRenderer } from 'electron';
import type { FindOptions } from '@shared/find';
import type { FindBarState, NorthstarFindApi } from '@shared/ipc-contract';

// Channel names inlined as literals — see `terminal.ts` for why a sandboxed
// preload can't share the `IpcChannel` runtime object. `FindOverlay` and
// `TabManager` (main) use the same strings.
const FindState = 'find:state';
const FindFocus = 'find:focus';
const FindInput = 'find:input';
const FindStep = 'find:step';
const FindGoto = 'find:goto';
const FindClose = 'find:close';

let latestState: FindBarState | null = null;
const stateListeners = new Set<(state: FindBarState) => void>();
ipcRenderer.on(FindState, (_event, state: FindBarState) => {
  latestState = state;
  stateListeners.forEach((listener) => listener(state));
});

const focusListeners = new Set<() => void>();
ipcRenderer.on(FindFocus, () => focusListeners.forEach((listener) => listener()));

const api: NorthstarFindApi = {
  onState: (listener) => {
    stateListeners.add(listener);
    if (latestState !== null) {
      listener(latestState);
    }
    return () => {
      stateListeners.delete(listener);
    };
  },
  onFocus: (listener) => {
    focusListeners.add(listener);
    return () => {
      focusListeners.delete(listener);
    };
  },
  search: (query: string, options: FindOptions) => {
    ipcRenderer.send(FindInput, { query, options });
  },
  step: (direction) => {
    ipcRenderer.send(FindStep, direction);
  },
  goTo: (index: number) => {
    ipcRenderer.send(FindGoto, index);
  },
  close: () => {
    ipcRenderer.send(FindClose);
  },
};

contextBridge.exposeInMainWorld('northstarFind', api satisfies NorthstarFindApi);
