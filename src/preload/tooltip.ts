// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-25

import { contextBridge, ipcRenderer } from 'electron';
import type { PortalogiaTooltipApi, TooltipSyncPayload } from '@shared/ipc-contract';

// Channel name copied as a literal rather than imported from the
// `IpcChannel` runtime object — see `src/preload/suggestions.ts`'s own
// comment on this same pattern for why: this sandboxed preload can't
// `require()` a sibling Rollup chunk.
const TooltipSync = 'tooltip:sync';

const api: PortalogiaTooltipApi = {
  onSync: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: TooltipSyncPayload): void => {
      listener(payload);
    };
    ipcRenderer.on(TooltipSync, handler);
    return () => ipcRenderer.removeListener(TooltipSync, handler);
  },
};

contextBridge.exposeInMainWorld('portalogiaTooltip', api satisfies PortalogiaTooltipApi);
