// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-19

import { ipcRenderer } from 'electron';
import { deepActiveElement } from './tabHighlighter';

// Tells main whether the keyboard is in something you type into, so a shortcut that is also an editing key
// (Ctrl+Left/Right jumping a word) can leave the caret alone instead of switching tabs. A `contenteditable`
// region is reported as 'rich': a web page's rich editor gives Ctrl+B/I/U meanings of its own. Repeated in each
// preload that needs it: two entries can't share a module (see the note on `tabZoom.ts`'s imports).
//
// A web page's editor can take its typing inside a frame of its own (Google Docs types into a hidden same-origin
// iframe), and focus inside a frame leaves only the `<iframe>` element active in the page around it, so this
// follows focus down through every same-origin frame. A cross-origin frame can't be looked into from here and
// counts as not editable.
const EditableFocus = 'ui:editable-focus';
const NON_TEXT_INPUT_TYPES = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit']);

/** Frames whose focus changes and Escape presses are already being listened to. */
const watchedWindows = new WeakSet<Window>();

let editableReported: 'plain' | 'rich' | false = false;

/**
 * Whether an element is something you type into. Checked by tag and property rather than `instanceof`: an element
 * from inside a frame belongs to that frame's own `HTMLElement`, not this one's.
 * @param element The element to check.
 * @returns `true` for a text box, a text area, or a `contenteditable` region.
 */
function isEditableElement(element: Element | null): element is HTMLElement {
  if (!element) {
    return false;
  }
  if (element.tagName === 'TEXTAREA') {
    return true;
  }
  if (element.tagName === 'INPUT') {
    return !NON_TEXT_INPUT_TYPES.has((element as HTMLInputElement).type);
  }
  return (element as HTMLElement).isContentEditable === true;
}

/**
 * The window inside a frame element, if this page may look into it.
 * @param element A focused element that may be an `<iframe>` or `<frame>`.
 * @returns The frame's window, or `null` for anything else or a cross-origin frame.
 */
function sameOriginFrameWindow(element: Element): Window | null {
  if (element.tagName !== 'IFRAME' && element.tagName !== 'FRAME') {
    return null;
  }
  try {
    const frameWindow = (element as HTMLIFrameElement).contentWindow;
    // Reading a cross-origin frame's document throws; that is the check.
    return frameWindow?.document ? frameWindow : null;
  } catch {
    return null;
  }
}

/**
 * The element that really has the keyboard: the page's own focused element, followed into the comment and text-box
 * tools' closed shadow roots and down through same-origin frames. Starts listening to each frame it passes through,
 * since focus moving around inside a frame tells nothing to the page around it.
 * @returns The focused element, or `null` with nothing focused.
 */
function innermostActiveElement(): Element | null {
  let element = deepActiveElement();
  for (let frameWindow = element ? sameOriginFrameWindow(element) : null; frameWindow; ) {
    watchWindow(frameWindow);
    element = frameWindow.document.activeElement;
    frameWindow = element ? sameOriginFrameWindow(element) : null;
  }
  return element;
}

/** Sends main the kind of text box the keyboard is in, if that changed since last time. */
function reportEditableFocus(): void {
  const element = innermostActiveElement();
  const editable = !isEditableElement(element) ? false : element.isContentEditable ? 'rich' : 'plain';
  if (editable !== editableReported) {
    editableReported = editable;
    ipcRenderer.send(EditableFocus, editable);
  }
}

/**
 * Takes the caret out of a text box after Escape, so the shortcuts that stand aside while one has it work again.
 * Decided once the page's own handlers have had the key: one that used Escape itself (closing a suggestion list or a
 * popup) called `preventDefault`, and then the caret stays for the next press.
 * @param event The keydown, from this page or any frame in it.
 */
function leaveTextBoxOnEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.isComposing) {
    return;
  }
  const element = innermostActiveElement();
  if (!isEditableElement(element)) {
    return;
  }
  setTimeout(() => {
    if (event.defaultPrevented || innermostActiveElement() !== element) {
      return;
    }
    element.blur();
    // A frame whose whole document is editable (`designMode`) keeps the caret through a blur of its body; taking
    // focus off the frame itself is what leaves it.
    const outer = document.activeElement;
    if (outer && sameOriginFrameWindow(outer)) {
      (outer as HTMLElement).blur();
    }
    reportEditableFocus();
  }, 0);
}

/**
 * Listens to a window's focus changes and Escape presses.
 * @param target This page's window, or a same-origin frame's.
 */
function watchWindow(target: Window): void {
  if (watchedWindows.has(target)) {
    return;
  }
  watchedWindows.add(target);
  target.addEventListener('focusin', reportEditableFocus, true);
  // `focusout` fires before the next element has focus, so look once focus has settled.
  target.addEventListener('focusout', () => setTimeout(reportEditableFocus, 0), true);
  // Focus going into a frame shows up out here only as the window losing it.
  target.addEventListener('blur', () => setTimeout(reportEditableFocus, 0), true);
  target.addEventListener('keydown', leaveTextBoxOnEscape, true);
}

watchWindow(window);
