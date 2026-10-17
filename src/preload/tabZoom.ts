// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import { ipcRenderer, webFrame } from 'electron';
// Folded into this same preload entry rather than given its own
// `webPreferences.preload` — only one preload path can be set per
// `WebContentsView` (see `TabManager.createTab`), and a module imported by
// two Rollup entries in the same build gets split into a shared chunk the
// sandboxed CJS loader can't `require()` (see that file's own comment).
import { deepActiveElement } from './tabHighlighter';
import './tabComments';
import './tabTextBoxes';
import './tabFind';
import './tabPen';

// Hardcoded rather than imported from `@shared/ipc-contract` — see
// `src/preload/terminal.ts`'s own comment: a value shared between two
// entries in the same preload Rollup build gets split into a separate
// chunk file the sandboxed preload loader can't `require()`.
const ZoomApply = 'zoom:apply';

// `webFrame.setZoomLevel` (this frame's own zoom, set from inside the
// renderer) rather than the main-process `contents.zoomLevel` this used to
// be pushed through — that one is per-*origin*, shared by every
// `webContents` showing the same origin, which is exactly how a browser
// tab's zoom used to leak into the chrome's own toolbar/sidebar (same
// dev-server origin) instead of staying scoped to just that tab. See
// `TabManager.applyZoom`, which pushes here instead of setting it directly.
//
// No `contextBridge` export: the page itself never gets a handle on
// `ipcRenderer`/`webFrame` at all, only this preload does — applying a
// main-process-pushed zoom level is this file's entire job.
ipcRenderer.on(ZoomApply, (_event, level: number) => {
  webFrame.setZoomLevel(level);
});

// Ctrl+mouse wheel zooms the tab by `ZOOM_PERCENT_WHEEL_STEP` per tick,
// decided in main (`TabManager.wheelZoom`). `preventDefault` also blocks
// Chromium's own pinch/ctrl-wheel visual zoom. Capture phase so a page's
// own handlers can't swallow it first. Literal channel name, not imported —
// see the comment on `ZoomApply` for why.
window.addEventListener(
  'wheel',
  (event) => {
    if (!event.ctrlKey || event.deltaY === 0) {
      return;
    }
    event.preventDefault();
    ipcRenderer.send('zoom:wheel', { direction: event.deltaY < 0 ? 1 : -1 });
  },
  { passive: false, capture: true },
);

// Tells main whether the keyboard is in something you type into, so a shortcut that is also an editing key
// (Ctrl+Left/Right jumping a word) can leave the caret alone instead of switching tabs. Repeated in each
// preload that needs it: two entries can't share a module (see the note on `tabZoom.ts`'s imports).
const EditableFocus = 'ui:editable-focus';
const NON_TEXT_INPUT_TYPES = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit']);
let editableReported = false;
function reportEditableFocus(): void {
  // Looks into the comment/text-box tools' closed shadow roots, where typing a note is still typing.
  const element = deepActiveElement();
  const editable =
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.has(element.type)) ||
    (element instanceof HTMLElement && element.isContentEditable);
  if (editable !== editableReported) {
    editableReported = editable;
    ipcRenderer.send(EditableFocus, editable);
  }
}
window.addEventListener('focusin', reportEditableFocus, true);
// `focusout` fires before the next element has focus, so look once focus has settled.
window.addEventListener('focusout', () => setTimeout(reportEditableFocus, 0), true);
