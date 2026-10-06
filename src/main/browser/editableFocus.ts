// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import { ipcMain } from 'electron';

/** The channel every page's preload reports on (see `reportEditableFocus` in each preload). */
export const EDITABLE_FOCUS_CHANNEL = 'ui:editable-focus';

/** The `webContents` whose page has the keyboard in something you type into — a text box, a text area, an editor. */
const editableIds = new Set<number>();

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
    if (editable === true) {
      if (!editableIds.has(contents.id)) {
        editableIds.add(contents.id);
        // A page that goes away (or navigates) can't say its box lost focus, so that is assumed.
        contents.once('destroyed', () => editableIds.delete(contents.id));
        contents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
          if (isMainFrame) {
            editableIds.delete(contents.id);
          }
        });
      }
    } else {
      editableIds.delete(contents.id);
    }
  });
}

/** @returns Whether the page with this `webContents` id has the keyboard in a text box. */
export function hasEditableFocus(webContentsId: number): boolean {
  return editableIds.has(webContentsId);
}
