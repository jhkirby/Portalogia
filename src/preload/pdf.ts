// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-17

import { contextBridge, ipcRenderer } from 'electron';
import type { PdfAnnotations } from '@shared/ipc-schemas';
import type { FindCommand, FindResult, NorthstarPdfApi, PdfOpenResult, PdfToolState } from '@shared/ipc-contract';
import type { PointerMode } from '@shared/tab-state';
import type { RGB } from '@shared/color';

// Channel names inlined as literals — see `terminal.ts` for why a sandboxed
// preload can't share the `IpcChannel` runtime object.
const PdfFile = 'pdf:file';
const PdfSaveAnnotations = 'pdf:save-annotations';
const PdfClear = 'pdf:clear';
const PdfClosed = 'pdf:closed';
const PdfUndo = 'pdf:undo';
const PdfRedo = 'pdf:redo';
const PdfPageInfo = 'pdf:page-info';
const PdfCropState = 'pdf:crop-state';
const PdfScrollToPage = 'pdf:scroll-to-page';
const PdfPointerMode = 'pdf:pointer-mode';
const PdfOpenLink = 'pdf:open-link';
const PdfWarpPointer = 'pdf:warp-pointer';
const FindCommandChannel = 'find:command';
const FindResultChannel = 'find:result';

// main created this page with `?id=<tab id>`; it's echoed back so main knows which tab a report is from.
const tabId = new URLSearchParams(window.location.search).get('id') ?? '';

const scrollListeners = new Set<(page: number) => void>();
ipcRenderer.on(PdfScrollToPage, (_event, page: number) => scrollListeners.forEach((listener) => listener(page)));

let latestPointerMode: PointerMode | null = null;
const pointerModeListeners = new Set<(mode: PointerMode) => void>();
ipcRenderer.on(PdfPointerMode, (_event, mode: PointerMode) => {
  latestPointerMode = mode;
  pointerModeListeners.forEach((listener) => listener(mode));
});
// Same strings `PenController` / `CommentController` (main) send on; hardcoded for the same sandboxed-preload reason as above.
const PenState = 'pen:state';
const CommentToolState = 'comment-tool:state';
const TextToolState = 'text-tool:state';
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

const findListeners = new Set<(command: FindCommand) => void>();
ipcRenderer.on(FindCommandChannel, (_event, command: FindCommand) => findListeners.forEach((listener) => listener(command)));

const fileListeners = new Set<(file: PdfOpenResult) => void>();
ipcRenderer.on(PdfFile, (_event, file: PdfOpenResult) => {
  fileListeners.forEach((listener) => listener(file));
});

let penOn = false;
let commentOn = false;
let textOn = false;
let highlighterOn = false;
let toolColor: RGB = { r: 26, g: 115, b: 232 };
let toolReceived = false;
const toolListeners = new Set<(state: PdfToolState) => void>();
let cropOn = false;
const currentTool = (): PdfToolState => ({
  tool: penOn
    ? 'pen'
    : commentOn
      ? 'comment'
      : textOn
        ? 'text'
        : highlighterOn
          ? 'highlighter'
          : cropOn
            ? 'crop'
            : 'none',
  color: toolColor,
});
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

ipcRenderer.on(TextToolState, (_event, payload: { active: boolean; color: RGB }) => {
  textOn = payload.active;
  toolColor = payload.color;
  notifyTool();
});

ipcRenderer.on(PdfCropState, (_event, payload: { active: boolean }) => {
  cropOn = payload.active;
  notifyTool();
});

const clearListeners = new Set<() => void>();
ipcRenderer.on(PdfClear, () => clearListeners.forEach((listener) => listener()));

const undoListeners = new Set<() => void>();
const redoListeners = new Set<() => void>();
ipcRenderer.on(PdfUndo, () => undoListeners.forEach((listener) => listener()));
ipcRenderer.on(PdfRedo, () => redoListeners.forEach((listener) => listener()));

const closeListeners = new Set<() => void>();
ipcRenderer.on(PdfClosed, () => closeListeners.forEach((listener) => listener()));

const api: NorthstarPdfApi = {
  saveAnnotations: (key: string, annotations: PdfAnnotations) => {
    ipcRenderer.send(PdfSaveAnnotations, { key, annotations });
  },
  reportPage: (page, pageCount) => {
    ipcRenderer.send(PdfPageInfo, { id: tabId, page, pageCount });
  },
  onScrollToPage: (listener) => {
    scrollListeners.add(listener);
    return () => {
      scrollListeners.delete(listener);
    };
  },
  onPointerMode: (listener) => {
    pointerModeListeners.add(listener);
    if (latestPointerMode !== null) {
      listener(latestPointerMode);
    }
    return () => {
      pointerModeListeners.delete(listener);
    };
  },
  openLink: (url) => {
    ipcRenderer.send(PdfOpenLink, { id: tabId, url });
  },
  warpPointer: (x, y) => {
    ipcRenderer.send(PdfWarpPointer, { id: tabId, x, y });
  },
  onUndo: (listener) => {
    undoListeners.add(listener);
    return () => {
      undoListeners.delete(listener);
    };
  },
  onRedo: (listener) => {
    redoListeners.add(listener);
    return () => {
      redoListeners.delete(listener);
    };
  },
  onClose: (listener) => {
    closeListeners.add(listener);
    return () => {
      closeListeners.delete(listener);
    };
  },
  onClear: (listener) => {
    clearListeners.add(listener);
    return () => {
      clearListeners.delete(listener);
    };
  },
  onTool: (listener) => {
    toolListeners.add(listener);
    if (toolReceived) {
      listener(currentTool());
    }
    return () => {
      toolListeners.delete(listener);
    };
  },
  onFind: (listener) => {
    findListeners.add(listener);
    return () => {
      findListeners.delete(listener);
    };
  },
  reportFind: (result: FindResult) => {
    ipcRenderer.send(FindResultChannel, result);
  },
  onFile: (listener) => {
    fileListeners.add(listener);
    return () => {
      fileListeners.delete(listener);
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

// Tells main whether the keyboard is in something you type into, so a shortcut that is also an editing key
// (Ctrl+Left/Right jumping a word) can leave the caret alone instead of switching tabs. A `contenteditable`
// region is reported as 'rich': a web page's rich editor gives Ctrl+B/I/U meanings of its own. Repeated in each
// preload that needs it: two entries can't share a module (see the note on `tabZoom.ts`'s imports).
const EditableFocus = 'ui:editable-focus';
const NON_TEXT_INPUT_TYPES = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit']);
function isEditableElement(element: Element | null): element is HTMLElement {
  return (
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.has(element.type)) ||
    (element instanceof HTMLElement && element.isContentEditable)
  );
}
let editableReported: 'plain' | 'rich' | false = false;
function reportEditableFocus(): void {
  const element = document.activeElement;
  const editable = !isEditableElement(element) ? false : element.isContentEditable ? 'rich' : 'plain';
  if (editable !== editableReported) {
    editableReported = editable;
    ipcRenderer.send(EditableFocus, editable);
  }
}
window.addEventListener('focusin', reportEditableFocus, true);
// `focusout` fires before the next element has focus, so look once focus has settled.
window.addEventListener('focusout', () => setTimeout(reportEditableFocus, 0), true);

// Escape takes the caret out of a text box, so the shortcuts that stand aside while one has it work again. Decided
// once the page's own handlers have had the key: one that used Escape itself (closing a suggestion list or a popup)
// called `preventDefault`, and then the caret stays for the next press.
window.addEventListener(
  'keydown',
  (event) => {
    if (event.key !== 'Escape' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.isComposing) {
      return;
    }
    const element = document.activeElement;
    if (!isEditableElement(element)) {
      return;
    }
    setTimeout(() => {
      if (!event.defaultPrevented && document.activeElement === element) {
        element.blur();
      }
    }, 0);
  },
  true,
);
