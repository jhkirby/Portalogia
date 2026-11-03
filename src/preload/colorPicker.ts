// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-25

import { contextBridge, ipcRenderer } from 'electron';
import type { RGB } from '@shared/color';
import type { ColorPickerSyncPayload, PortalogiaColorPickerApi } from '@shared/ipc-contract';

// Channel names copied as literals rather than imported from the `IpcChannel`
// runtime object — see `src/preload/suggestions.ts`'s own comment on this
// same pattern for why: this sandboxed preload can't `require()` a sibling
// Rollup chunk, so the strings it needs are kept fully inline instead.
const ColorPickerSync = 'color-picker:sync';
const ColorPickerColorChanged = 'color-picker:color-changed';
const ColorPickerCloseRequested = 'color-picker:close-requested';

const api: PortalogiaColorPickerApi = {
  onSync: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ColorPickerSyncPayload): void => {
      listener(payload);
    };
    ipcRenderer.on(ColorPickerSync, handler);
    return () => ipcRenderer.removeListener(ColorPickerSync, handler);
  },
  changeColor: (rgb: RGB, commit: boolean) => ipcRenderer.send(ColorPickerColorChanged, { rgb, commit }),
  requestClose: () => ipcRenderer.send(ColorPickerCloseRequested),
};

contextBridge.exposeInMainWorld('portalogiaColorPicker', api satisfies PortalogiaColorPickerApi);
