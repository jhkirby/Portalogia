// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-22

import { BrowserWindow, ipcMain } from 'electron';
import { IpcChannel } from '@shared/ipc-contract';
import { WindowDragController } from '../windows/WindowDragController';

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
  // Moving the window by its drag strip (with edge snapping) lives in
  // `WindowDragController` — see there for why it isn't an OS drag region.
  const dragController = new WindowDragController();

  ipcMain.on(IpcChannel.WindowDragStart, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      dragController.begin(window);
    }
  });

  ipcMain.on(IpcChannel.WindowDragEnd, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      dragController.end(window);
    }
  });

  ipcMain.handle(IpcChannel.WindowGetState, (event) => ({
    isMaximized: BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false,
  }));

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

  // Closes the window the same way the (removed) native close button
  // would — the app quits once every window is closed (see `main/index.ts`'s
  // `window-all-closed` handler).
  ipcMain.on(IpcChannel.WindowClose, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
}
