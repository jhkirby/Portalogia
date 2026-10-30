// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { contextBridge, ipcRenderer } from 'electron';
import type { MarkdownAnnotations } from '@shared/ipc-schemas';
import type {
  FindCommand,
  FindResult,
  MarkdownBacklink,
  MarkdownFormatAction,
  MarkdownFileData,
  MarkdownRunResult,
  MarkdownToolState,
  NorthstarMarkdownApi,
} from '@shared/ipc-contract';
import type { RGB } from '@shared/color';
import type { MarkdownDisplay, PointerMode } from '@shared/tab-state';

// Channel names inlined as literals — see `terminal.ts` for why a sandboxed
// preload can't share the `IpcChannel` runtime object.
const MarkdownFile = 'markdown:file';
const TabReleaseKeyboard = 'tab:release-keyboard';
const MarkdownClosed = 'markdown:closed';
const MarkdownMode = 'markdown:mode';
const MarkdownPointerModeChannel = 'markdown:pointer-mode';
const TabWarpPointer = 'tab:warp-pointer';
const MarkdownDisplayChannel = 'markdown:display';
const MarkdownFormat = 'markdown:format';
const MarkdownSave = 'markdown:save';
const MarkdownSaveAnnotations = 'markdown:save-annotations';
const MarkdownClear = 'markdown:clear';
const MarkdownUndo = 'markdown:undo';
const MarkdownRedo = 'markdown:redo';
const MarkdownOpenLink = 'markdown:open-link';
const MarkdownResolveLinks = 'markdown:resolve-links';
const MarkdownBacklinks = 'markdown:backlinks';
const MarkdownListNotes = 'markdown:list-notes';
const MarkdownReadImage = 'markdown:read-image';
const MarkdownReadRemoteImage = 'markdown:read-remote-image';
const MarkdownRunCode = 'markdown:run-code';
const FindCommandChannel = 'find:command';
const FindResultChannel = 'find:result';
// Same strings `PenController` / `CommentController` / `HighlighterController` (main) send on.
const PenState = 'pen:state';
const CommentToolState = 'comment-tool:state';
const HighlighterState = 'highlighter:state';
const ZoomApply = 'zoom:apply';
const ZoomWheel = 'zoom:wheel';

// main created this page with `?id=<tab id>`; it's echoed back so main knows which tab a request is from.
const tabId = new URLSearchParams(window.location.search).get('id') ?? '';

/** Main pushes Chromium zoom *levels* (powers of 1.2) for browser/terminal frames; this page wants the percent. */
const percentFromLevel = (level: number): number => Math.round(100 * Math.pow(1.2, level));

let latestPercent: number | null = null;
const zoomListeners = new Set<(percent: number) => void>();
ipcRenderer.on(ZoomApply, (_event, level: number) => {
  latestPercent = percentFromLevel(level);
  zoomListeners.forEach((listener) => listener(latestPercent as number));
});

// Ctrl+wheel zoom — same behavior as `pdf.ts`; main steps the tab's zoom and pushes it back through `ZoomApply` above.
window.addEventListener(
  'wheel',
  (event) => {
    // With Shift held too, Windows turns the wheel sideways, so the step comes in `deltaX`; Shift asks for the coarse
    // step (`ZOOM_PERCENT_WHEEL_STEP_COARSE`).
    const delta = event.deltaY || event.deltaX;
    if (!event.ctrlKey || delta === 0) {
      return;
    }
    event.preventDefault();
    ipcRenderer.send(ZoomWheel, { direction: delta < 0 ? 1 : -1, coarse: event.shiftKey });
  },
  { passive: false, capture: true },
);

const findListeners = new Set<(command: FindCommand) => void>();
ipcRenderer.on(FindCommandChannel, (_event, command: FindCommand) => findListeners.forEach((listener) => listener(command)));

const fileListeners = new Set<(file: MarkdownFileData) => void>();
ipcRenderer.on(MarkdownFile, (_event, file: MarkdownFileData) => fileListeners.forEach((listener) => listener(file)));

const closeListeners = new Set<() => void>();
ipcRenderer.on(MarkdownClosed, () => closeListeners.forEach((listener) => listener()));

let latestMode: 'view' | 'edit' | null = null;
const modeListeners = new Set<(mode: 'view' | 'edit') => void>();
ipcRenderer.on(MarkdownMode, (_event, mode: 'view' | 'edit') => {
  latestMode = mode;
  modeListeners.forEach((listener) => listener(mode));
});

let latestPointerMode: PointerMode | null = null;
const pointerModeListeners = new Set<(mode: PointerMode) => void>();
ipcRenderer.on(MarkdownPointerModeChannel, (_event, mode: PointerMode) => {
  latestPointerMode = mode;
  pointerModeListeners.forEach((listener) => listener(mode));
});

let latestDisplay: MarkdownDisplay | null = null;
const displayListeners = new Set<(display: MarkdownDisplay) => void>();
ipcRenderer.on(MarkdownDisplayChannel, (_event, display: MarkdownDisplay) => {
  latestDisplay = display;
  displayListeners.forEach((listener) => listener(display));
});

let penOn = false;
let commentOn = false;
let highlighterOn = false;
let toolColor: RGB = { r: 26, g: 115, b: 232 };
let toolReceived = false;
const toolListeners = new Set<(state: MarkdownToolState) => void>();
const currentTool = (): MarkdownToolState => ({
  tool: penOn ? 'pen' : commentOn ? 'comment' : highlighterOn ? 'highlighter' : 'none',
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

const formatListeners = new Set<(action: MarkdownFormatAction) => void>();
ipcRenderer.on(MarkdownFormat, (_event, action: MarkdownFormatAction) => formatListeners.forEach((listener) => listener(action)));

const clearListeners = new Set<() => void>();
ipcRenderer.on(MarkdownClear, () => clearListeners.forEach((listener) => listener()));
const undoListeners = new Set<() => void>();
const redoListeners = new Set<() => void>();
ipcRenderer.on(MarkdownUndo, () => undoListeners.forEach((listener) => listener()));
ipcRenderer.on(MarkdownRedo, () => redoListeners.forEach((listener) => listener()));

/** Subscribes `listener` to one of the sets above, and hands back the way to unsubscribe. */
function subscribe<T>(listeners: Set<T>, listener: T): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** What a run comes back as if main couldn't answer at all (the page was refused, or the handler failed). */
const RUN_FAILED: MarkdownRunResult = {
  ran: false,
  error: 'The code could not be run.',
  stdout: '',
  stderr: '',
  exitCode: null,
  timedOut: false,
  truncated: false,
  durationMs: 0,
};

// While the laser pointer's overlay covers this page, main passes on where the pointer is (the page itself sees no
// pointer events then), raised as a page event for the stat bar's pointer readout (`usePointerPosition`): plain
// numbers in a DOM event cross into the page, where a preload object wouldn't.
ipcRenderer.on('tab:pointer-position', (_event, point: { x: number; y: number } | null) => {
  window.dispatchEvent(
    point ? new MouseEvent('northstar-pointer', { clientX: point.x, clientY: point.y }) : new Event('northstar-pointer-leave'),
  );
});

// Whether the window is in Focus Mode: the stat bar hides with the chrome. Kept, so a listener added later hears it.
const TabFocusMode = 'tab:focus-mode';
let latestFocusMode = false;
const focusModeListeners = new Set<(focusMode: boolean) => void>();
ipcRenderer.on(TabFocusMode, (_event, focusMode: unknown) => {
  latestFocusMode = focusMode === true;
  focusModeListeners.forEach((listener) => listener(latestFocusMode));
});

// The side panel's shortcut (Ctrl+Alt+B): a menu accelerator in main, which passes it on to the tab showing.
const TabToggleSidePanel = 'tab:toggle-side-panel';
const sidePanelListeners = new Set<() => void>();
ipcRenderer.on(TabToggleSidePanel, () => sidePanelListeners.forEach((listener) => listener()));

const api: NorthstarMarkdownApi = {
  onToggleSidePanel: (listener) => {
    sidePanelListeners.add(listener);
    return () => {
      sidePanelListeners.delete(listener);
    };
  },
  onFocusMode: (listener) => {
    listener(latestFocusMode);
    focusModeListeners.add(listener);
    return () => {
      focusModeListeners.delete(listener);
    };
  },

  onFind: (listener) => subscribe(findListeners, listener),
  reportFind: (result: FindResult) => {
    ipcRenderer.send(FindResultChannel, result);
  },
  onFile: (listener) => subscribe(fileListeners, listener),
  onClose: (listener) => subscribe(closeListeners, listener),
  onMode: (listener) => {
    if (latestMode !== null) {
      listener(latestMode);
    }
    return subscribe(modeListeners, listener);
  },
  onPointerMode: (listener) => {
    if (latestPointerMode !== null) {
      listener(latestPointerMode);
    }
    return subscribe(pointerModeListeners, listener);
  },
  warpPointer: (x, y) => {
    // This page zooms itself (see `onZoom`), so its pixels are already the window's; main finds the tab by sender.
    ipcRenderer.send(TabWarpPointer, { x, y });
  },
  onDisplay: (listener) => {
    if (latestDisplay !== null) {
      listener(latestDisplay);
    }
    return subscribe(displayListeners, listener);
  },
  onFormat: (listener) => subscribe(formatListeners, listener),
  save: (content: string, generation: number) => {
    ipcRenderer.send(MarkdownSave, { id: tabId, content, generation });
  },
  saveAnnotations: (annotations: MarkdownAnnotations, generation: number) => {
    ipcRenderer.send(MarkdownSaveAnnotations, { id: tabId, annotations, generation });
  },
  onUndo: (listener) => subscribe(undoListeners, listener),
  onRedo: (listener) => subscribe(redoListeners, listener),
  onClear: (listener) => subscribe(clearListeners, listener),
  onTool: (listener) => {
    if (toolReceived) {
      listener(currentTool());
    }
    return subscribe(toolListeners, listener);
  },
  openLink: async (kind, target, newTab) => {
    await ipcRenderer.invoke(MarkdownOpenLink, { id: tabId, kind, target, newTab });
  },
  resolveLinks: async (names) => {
    const result = (await ipcRenderer.invoke(MarkdownResolveLinks, { id: tabId, names })) as Record<string, boolean> | null;
    return result ?? {};
  },
  getBacklinks: async () => {
    const result = (await ipcRenderer.invoke(MarkdownBacklinks, { id: tabId })) as MarkdownBacklink[] | null;
    return result ?? [];
  },
  listNotes: async () => {
    const result = (await ipcRenderer.invoke(MarkdownListNotes, { id: tabId })) as string[] | null;
    return result ?? [];
  },
  readImage: async (src) => {
    const result = (await ipcRenderer.invoke(MarkdownReadImage, { id: tabId, src })) as string | null;
    return result ?? null;
  },
  readRemoteImage: async (url) => {
    const result = (await ipcRenderer.invoke(MarkdownReadRemoteImage, { id: tabId, url })) as string | null;
    return result ?? null;
  },
  runCode: async (index) => {
    const result = (await ipcRenderer.invoke(MarkdownRunCode, { id: tabId, index })) as MarkdownRunResult | null;
    return result ?? RUN_FAILED;
  },
  onZoom: (listener) => {
    if (latestPercent !== null) {
      listener(latestPercent);
    }
    return subscribe(zoomListeners, listener);
  },
};

contextBridge.exposeInMainWorld('northstarMarkdown', api satisfies NorthstarMarkdownApi);

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

// Escape gives the keyboard back to the chrome, so the app's shortcuts work again; Escape there hands it back. A text
// box (the note's editor among them) keeps its caret where it was rather than being left, so coming back puts the
// cursor in the same place. Decided once the page's own handlers have had the key: one that used Escape itself
// (closing a suggestion list or a popup) called `preventDefault`, and then the page keeps the keyboard for the next
// press.
window.addEventListener(
  'keydown',
  (event) => {
    if (event.key !== 'Escape' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.isComposing) {
      return;
    }
    setTimeout(() => {
      if (!event.defaultPrevented) {
        ipcRenderer.send(TabReleaseKeyboard);
      }
    }, 0);
  },
  true,
);
