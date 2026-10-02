// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-01

import { contextBridge, ipcRenderer } from 'electron';
import type { IpcResult, NorthstarPdfApi, PdfOpenResult } from '@shared/ipc-contract';

// Channel names inlined as literals — see `terminal.ts` for why a sandboxed
// preload can't share the `IpcChannel` runtime object.
const PdfOpenFile = 'pdf:open-file';
const ZoomApply = 'zoom:apply';
const ZoomWheel = 'zoom:wheel';

/** Main pushes Chromium zoom *levels* (powers of 1.2) for browser/terminal frames; this page wants the percent. */
const percentFromLevel = (level: number): number => Math.round(100 * Math.pow(1.2, level));

let latestPercent: number | null = null;
const listeners = new Set<(percent: number) => void>();

ipcRenderer.on(ZoomApply, (_event, level: number) => {
  latestPercent = percentFromLevel(level);
  listeners.forEach((listener) => listener(latestPercent as number));
});

// Ctrl+wheel zoom — same behavior as `tabZoom.ts`/`terminal.ts`; main steps
// the tab's zoom and pushes it back through `ZoomApply` above.
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

const api: NorthstarPdfApi = {
  openFile: async (id) => {
    const result = (await ipcRenderer.invoke(PdfOpenFile, { id })) as IpcResult<PdfOpenResult | null>;
    if (!result.ok) {
      throw new Error(result.message);
    }
    return result.data;
  },
  onZoom: (listener) => {
    listeners.add(listener);
    if (latestPercent !== null) {
      listener(latestPercent);
    }
    return () => {
      listeners.delete(listener);
    };
  },
};

contextBridge.exposeInMainWorld('northstarPdf', api satisfies NorthstarPdfApi);
