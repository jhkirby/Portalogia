// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-01

import { contextBridge, ipcRenderer } from 'electron';
import type { NorthstarPdfApi, PdfOpenResult, PdfToolState } from '@shared/ipc-contract';
import type { RGB } from '@shared/color';
import type { PdfMode } from '@shared/tab-state';

// Channel names inlined as literals — see `terminal.ts` for why a sandboxed
// preload can't share the `IpcChannel` runtime object.
const PdfFile = 'pdf:file';
const PdfModeChanged = 'pdf:mode-changed';
// Same strings `PenController` / `CommentController` (main) send on; hardcoded for the same sandboxed-preload reason as above.
const PenState = 'pen:state';
const CommentToolState = 'comment-tool:state';
const HighlighterState = 'highlighter:state';
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

const fileListeners = new Set<(file: PdfOpenResult) => void>();
ipcRenderer.on(PdfFile, (_event, file: PdfOpenResult) => {
  fileListeners.forEach((listener) => listener(file));
});

let latestMode: PdfMode | null = null;
const modeListeners = new Set<(mode: PdfMode) => void>();
ipcRenderer.on(PdfModeChanged, (_event, mode: PdfMode) => {
  latestMode = mode;
  modeListeners.forEach((listener) => listener(mode));
});

let penOn = false;
let commentOn = false;
let highlighterOn = false;
let toolColor: RGB = { r: 26, g: 115, b: 232 };
let toolReceived = false;
const toolListeners = new Set<(state: PdfToolState) => void>();
const currentTool = (): PdfToolState => ({ tool: penOn ? 'pen' : commentOn ? 'comment' : highlighterOn ? 'highlighter' : 'none', color: toolColor });
const notifyTool = (): void => {
  toolReceived = true;
  toolListeners.forEach((listener) => listener(currentTool()));
};
ipcRenderer.on(PenState, (_event, payload: { active: boolean; color: RGB }) => {
  penOn = payload.active;
  toolColor = payload.color;
  notifyTool();
});
ipcRenderer.on(HighlighterState, (_event, payload: { active: boolean; color: RGB }) => {
  highlighterOn = payload.active;
  toolColor = payload.color;
  notifyTool();
});
ipcRenderer.on(CommentToolState, (_event, payload: { active: boolean; color: RGB }) => {
  commentOn = payload.active;
  toolColor = payload.color;
  notifyTool();
});

const api: NorthstarPdfApi = {
  onTool: (listener) => {
    toolListeners.add(listener);
    if (toolReceived) {
      listener(currentTool());
    }
    return () => {
      toolListeners.delete(listener);
    };
  },
  onFile: (listener) => {
    fileListeners.add(listener);
    return () => {
      fileListeners.delete(listener);
    };
  },
  onMode: (listener) => {
    modeListeners.add(listener);
    if (latestMode !== null) {
      listener(latestMode);
    }
    return () => {
      modeListeners.delete(listener);
    };
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
