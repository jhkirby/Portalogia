// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { contextBridge, ipcRenderer } from 'electron';
import type { PdfAnnotations } from '@shared/ipc-schemas';
import type {
  FindCommand,
  FindResult,
  MarkdownBacklink,
  PortalogiaPdfApi,
  PdfOpenResult,
  PdfToolState,
} from '@shared/ipc-contract';
import type { PointerMode } from '@shared/tab-state';
import type { RGB } from '@shared/color';

// Channel names inlined as literals — see `terminal.ts` for why a sandboxed
// preload can't share the `IpcChannel` runtime object.
const PdfFile = 'pdf:file';
const TabReleaseKeyboard = 'tab:release-keyboard';
const PdfSaveAnnotations = 'pdf:save-annotations';
const PdfClear = 'pdf:clear';
const PdfClosed = 'pdf:closed';
const PdfUndo = 'pdf:undo';
const PdfRedo = 'pdf:redo';
const PdfPageInfo = 'pdf:page-info';
const PdfHistoryInfo = 'pdf:history-info';
const PdfLoadProgress = 'pdf:load-progress';
const PdfHistoryGo = 'pdf:history-go';
const PdfCropState = 'pdf:crop-state';
const PdfScrollToPage = 'pdf:scroll-to-page';
const PdfPointerMode = 'pdf:pointer-mode';
const PdfOpenLink = 'pdf:open-link';
const PdfWarpPointer = 'pdf:warp-pointer';
const PdfBacklinks = 'pdf:backlinks';
const PdfOpenBacklink = 'pdf:open-backlink';
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

const historyGoListeners = new Set<(direction: 1 | -1) => void>();
ipcRenderer.on(PdfHistoryGo, (_event, direction: unknown) => {
  if (direction === 1 || direction === -1) {
    historyGoListeners.forEach((listener) => listener(direction));
  }
});

const closeListeners = new Set<() => void>();
ipcRenderer.on(PdfClosed, () => closeListeners.forEach((listener) => listener()));

// While the laser pointer's overlay covers this page, main passes on where the pointer is (the page itself sees no
// pointer events then), raised as a page event for the stat bar's pointer readout (`usePointerPosition`): plain
// numbers in a DOM event cross into the page, where a preload object wouldn't.
ipcRenderer.on('tab:pointer-position', (_event, point: { x: number; y: number } | null) => {
  window.dispatchEvent(
    point ? new MouseEvent('portalogia-pointer', { clientX: point.x, clientY: point.y }) : new Event('portalogia-pointer-leave'),
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
// The sections' edit shortcut (Ctrl+Alt+E), passed on the same way.
const PdfToggleSectionEditing = 'pdf:toggle-section-editing';
const sectionEditingListeners = new Set<() => void>();
ipcRenderer.on(PdfToggleSectionEditing, () => sectionEditingListeners.forEach((listener) => listener()));

const api: PortalogiaPdfApi = {
  onToggleSectionEditing: (listener) => {
    sectionEditingListeners.add(listener);
    return () => {
      sectionEditingListeners.delete(listener);
    };
  },
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

  saveAnnotations: (key: string, annotations: PdfAnnotations) => {
    ipcRenderer.send(PdfSaveAnnotations, { key, annotations });
  },
  reportPage: (page, pageCount) => {
    ipcRenderer.send(PdfPageInfo, { id: tabId, page, pageCount });
  },
  reportLoadProgress: (percent) => {
    ipcRenderer.send(PdfLoadProgress, { id: tabId, percent });
  },
  reportHistory: (canGoBack, canGoForward) => {
    ipcRenderer.send(PdfHistoryInfo, { id: tabId, canGoBack, canGoForward });
  },
  onHistoryGo: (listener) => {
    historyGoListeners.add(listener);
    return () => {
      historyGoListeners.delete(listener);
    };
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
  getBacklinks: async () => {
    const result = (await ipcRenderer.invoke(PdfBacklinks, { id: tabId })) as MarkdownBacklink[] | null;
    return result ?? [];
  },
  openBacklink: (target) => {
    ipcRenderer.send(PdfOpenBacklink, { id: tabId, target });
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

contextBridge.exposeInMainWorld('portalogiaPdf', api satisfies PortalogiaPdfApi);

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

// The page's own stat bar, read out for the chrome: in split screen the chrome draws the one bar along the window's
// bottom, with the stats of whichever side was used last, and this page's own is hidden
// (`TabManager.syncSplitStatBars`). Repeated in each preload with a stat bar: two entries can't share a module (see
// the note on `tabZoom.ts`'s imports).
const TabStatItems = 'tab:stat-items';
{
  let sent = '';
  let queued = false;
  // An item's words, a jump box's number included (an input's value isn't in its text).
  const textOf = (node: Node): string =>
    node instanceof HTMLInputElement
      ? node.value
      : node.nodeType === Node.TEXT_NODE
        ? (node.textContent ?? '')
        : Array.from(node.childNodes, textOf).join('');
  const send = (): void => {
    queued = false;
    const bar = document.querySelector('footer.md-status, footer.pdf-status, footer.terminal-status');
    const items = bar
      ? Array.from(bar.querySelectorAll('[class*="status__item"]'), (item) => textOf(item).replace(/\s+/g, ' ').trim()).filter(
          (text) => text !== '',
        )
      : [];
    const key = JSON.stringify(items);
    if (key !== sent) {
      sent = key;
      ipcRenderer.send(TabStatItems, items);
    }
  };
  const queue = (): void => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(send);
    }
  };
  window.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(queue).observe(document.body, { subtree: true, childList: true, characterData: true });
    queue();
  });
  // A jump box's number changes as a property, which no mutation shows: whatever can move it reads the bar again.
  for (const type of ['input', 'keyup', 'pointerup', 'selectionchange']) {
    document.addEventListener(type, queue, true);
  }
  setInterval(queue, 1000);
}
