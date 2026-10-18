// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-17

import { ipcMain } from 'electron';

/** The channel every page's preload reports on (see `reportEditableFocus` in each preload). */
export const EDITABLE_FOCUS_CHANNEL = 'ui:editable-focus';

/**
 * What kind of thing to type into has the keyboard: `'plain'` for a text box
 * or text area, `'rich'` for a `contenteditable` region (a web page's rich
 * editor, which gives Ctrl+B/I/U meanings of its own).
 */
export type EditableKind = 'plain' | 'rich';

/** The `webContents` whose page has the keyboard in something you type into, and what kind of thing it is. */
const editableKinds = new Map<number, EditableKind>();

/**
 * Starts tracking which pages have their caret in a text box. Shortcuts that
 * are also editing keys (Ctrl+←/→ jumps a word) ask `hasEditableFocus` and
 * stand aside when the answer is yes — main can't look inside a page
 * synchronously from a key event, so each page tells it as focus moves.
 * Call once.
 */
export function trackEditableFocus(): void {
  ipcMain.on(EDITABLE_FOCUS_CHANNEL, (event, editable: unknown) => {
    const contents = event.sender;
    // `true` is the plain report every preload sent before rich editors were told apart; it still means a text box.
    const kind: EditableKind | null = editable === 'rich' ? 'rich' : editable === true || editable === 'plain' ? 'plain' : null;
    if (kind !== null) {
      if (!editableKinds.has(contents.id)) {
        // A page that goes away (or navigates) can't say its box lost focus, so that is assumed.
        contents.once('destroyed', () => editableKinds.delete(contents.id));
        contents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
          if (isMainFrame) {
            editableKinds.delete(contents.id);
          }
        });
      }
      editableKinds.set(contents.id, kind);
    } else {
      editableKinds.delete(contents.id);
    }
  });
}

/** @returns Whether the page with this `webContents` id has the keyboard in a text box. */
export function hasEditableFocus(webContentsId: number): boolean {
  return editableKinds.has(webContentsId);
}

/** @returns What kind of text box has the keyboard in the page with this `webContents` id, or `null` if none does. */
export function editableKindOf(webContentsId: number): EditableKind | null {
  return editableKinds.get(webContentsId) ?? null;
}
