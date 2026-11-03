// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-24

import { screen, type BrowserWindow } from 'electron';
import { TAB_STRIP_HEIGHT_PX } from '@shared/constants';
import { IpcChannel } from '@shared/ipc-contract';

/** How often, in ms, the pointer's place is checked while it's off the row: quick enough that the controls appear as it arrives. */
const POLL_MS = 100;

/** How often, in ms, it's checked while it's on the row, so the glow that follows it there moves smoothly. */
const POLL_INSIDE_MS = 16;

/**
 * Tells a window's chrome whenever the pointer comes onto or leaves its tab
 * row, so the window controls and the "+" can show for the whole row, and
 * where on the row it is while it's there, for the glow that follows it. The
 * chrome can't see this itself over the row's empty space: that's the OS
 * drag region (for moving the window), which gets no mouse events at all, so
 * `:hover` never fires there. Main follows the pointer on the screen instead
 * and reports only the changes.
 * @param window The window to watch; stops by itself once it's closed.
 */
export function watchTitlebarHover(window: BrowserWindow): void {
  let inside = false;
  let last: { x: number; y: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const check = (): void => {
    if (window.isDestroyed()) {
      return;
    }
    let next = false;
    let point: { x: number; y: number } | null = null;
    if (window.isVisible() && !window.isMinimized()) {
      const cursor = screen.getCursorScreenPoint();
      const bounds = window.getContentBounds();
      point = { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
      next = point.x >= 0 && point.x < bounds.width && point.y >= 0 && point.y < TAB_STRIP_HEIGHT_PX;
    }
    if (next !== inside) {
      inside = next;
      window.webContents.send(IpcChannel.UiTitlebarPointer, inside);
    }
    if (inside && point && (last === null || last.x !== point.x || last.y !== point.y)) {
      last = point;
      window.webContents.send(IpcChannel.UiTitlebarPointerPosition, point);
    }
    timer = setTimeout(check, inside ? POLL_INSIDE_MS : POLL_MS);
  };
  check();
  window.once('closed', () => {
    if (timer !== null) {
      clearTimeout(timer);
    }
  });
}
