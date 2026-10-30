// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { contextBridge, ipcRenderer } from 'electron';
import type { ExportMenuSyncPayload, MenuOverlayAction, NorthstarExportMenuApi } from '@shared/ipc-contract';

// Channel names inlined as literals — see `colorPicker.ts` for why a
// sandboxed preload can't import the `IpcChannel` runtime object.
const ExportMenuSync = 'export-menu:sync';
const ExportMenuSelect = 'export-menu:select';
const ExportMenuCloseRequested = 'export-menu:close-requested';

const api: NorthstarExportMenuApi = {
  onSync: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ExportMenuSyncPayload): void => {
      listener(payload);
    };
    ipcRenderer.on(ExportMenuSync, handler);
    return () => ipcRenderer.removeListener(ExportMenuSync, handler);
  },
  select: (action: MenuOverlayAction) => ipcRenderer.send(ExportMenuSelect, { action }),
  requestClose: () => ipcRenderer.send(ExportMenuCloseRequested),
};

contextBridge.exposeInMainWorld('northstarExportMenu', api satisfies NorthstarExportMenuApi);
