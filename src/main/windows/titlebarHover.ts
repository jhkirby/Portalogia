// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

import { screen, type BrowserWindow } from 'electron';
import { TAB_STRIP_HEIGHT_PX } from '@shared/constants';
import { IpcChannel } from '@shared/ipc-contract';

/** How often, in ms, the pointer's place is checked: quick enough that the controls appear as it arrives. */
const POLL_MS = 100;

/**
 * Tells a window's chrome whenever the pointer comes onto or leaves its tab
 * row, so the window controls and the "+" can show for the whole row. The
 * chrome can't see this itself over the row's empty space: that's the OS
 * drag region (for moving the window), which gets no mouse events at all, so
 * `:hover` never fires there. Main follows the pointer on the screen instead
 * and reports only the changes.
 * @param window The window to watch; stops by itself once it's closed.
 */
export function watchTitlebarHover(window: BrowserWindow): void {
  let inside = false;
  const timer = setInterval(() => {
    if (window.isDestroyed()) {
      clearInterval(timer);
      return;
    }
    let next = false;
    if (window.isVisible() && !window.isMinimized()) {
      const cursor = screen.getCursorScreenPoint();
      const bounds = window.getContentBounds();
      next =
        cursor.x >= bounds.x &&
        cursor.x < bounds.x + bounds.width &&
        cursor.y >= bounds.y &&
        cursor.y < bounds.y + TAB_STRIP_HEIGHT_PX;
    }
    if (next !== inside) {
      inside = next;
      window.webContents.send(IpcChannel.UiTitlebarPointer, inside);
    }
  }, POLL_MS);
  window.once('closed', () => clearInterval(timer));
}
