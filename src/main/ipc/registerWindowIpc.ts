// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-22

import { BrowserWindow, ipcMain } from 'electron';
import { IpcChannel } from '@shared/ipc-contract';

/**
 * Registers the frameless window's own minimize/maximize/close controls
 * (see MainWindow.ts's `frame: false`) — fire-and-forget `ipcMain.on`
 * channels, same as `terminal:input`, since there's nothing meaningful to
 * reply with. Each resolves its target window from the sending
 * `webContents` rather than a captured reference, so it stays correct if
 * more than one window is ever open.
 *
 * Call this exactly once for the app's lifetime, same as `registerTabIpc`.
 */
export function registerWindowIpc(): void {
  ipcMain.on(IpcChannel.WindowMinimize, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.on(IpcChannel.WindowToggleMaximize, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      return;
    }
    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
  });

  // `close()` still goes through the window's own 'close' handler in
  // MainWindow.ts, which prevents it by product decision — this channel
  // exists so the custom close button behaves identically to the (removed)
  // native one, not to actually close the window.
  ipcMain.on(IpcChannel.WindowClose, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
}
