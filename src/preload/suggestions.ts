// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-24

import { contextBridge, ipcRenderer } from 'electron';
import type { AddressSuggestionsSyncPayload, PortalogiaAddressSuggestionsApi } from '@shared/ipc-contract';

// Channel names copied as literals rather than imported from the `IpcChannel`
// runtime object — see `src/preload/terminal.ts`'s own comment on this same
// pattern for why: this sandboxed preload can't `require()` a sibling
// Rollup chunk, so the two strings it needs are kept fully inline instead.
const AddressSuggestionsSync = 'address-suggestions:sync';
const AddressSuggestionsSelect = 'address-suggestions:select';

const api: PortalogiaAddressSuggestionsApi = {
  onSync: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: AddressSuggestionsSyncPayload): void => {
      listener(payload);
    };
    ipcRenderer.on(AddressSuggestionsSync, handler);
    return () => ipcRenderer.removeListener(AddressSuggestionsSync, handler);
  },
  select: (index) => ipcRenderer.send(AddressSuggestionsSelect, index),
};

contextBridge.exposeInMainWorld('portalogiaSuggestions', api satisfies PortalogiaAddressSuggestionsApi);
