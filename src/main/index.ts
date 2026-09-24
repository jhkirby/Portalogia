// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-12

import { join } from 'node:path';
import { app, BrowserWindow, protocol, session } from 'electron';
import { NORTHSTAR_SCHEME } from '@shared/constants';
import { IpcChannel } from '@shared/ipc-contract';
import { BookmarkStore } from './browser/BookmarkStore';
import { TabManager } from './browser/TabManager';
import { registerTabIpc } from './ipc/registerTabIpc';
import { registerThemeIpc } from './ipc/registerThemeIpc';
import { registerWindowIpc } from './ipc/registerWindowIpc';
import { buildMenu } from './menu/buildMenu';
import { buildHomePageHtml } from './protocol/homePage';
import { createMainWindow } from './windows/MainWindow';

// Electron requires this to be set before `app.whenReady()`.
app.setName('Northstar');

// Custom schemes must be registered as privileged before the app is ready.
// `standard: true` gives it normal URL parsing (host, path); `secure: true`
// treats it like https for mixed-content purposes; script isn't needed
// since the home page is pure server-rendered markup, so fetch/CORS stay off.
protocol.registerSchemesAsPrivileged([
  {
    scheme: NORTHSTAR_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false },
  },
]);

// Tracks whichever window is currently frontmost, so the one set of
// `ipcMain.handle` registrations (below) and the application menu always
// act on the right window's tabs even if more than one is ever opened.
let activeTabManager: TabManager | null = null;

// Bookmarks aren't scoped to a window — one store, shared by every
// `TabManager` and by the `northstar://home` page each of them can show.
const bookmarkStore = new BookmarkStore(join(app.getPath('userData'), 'bookmarks.json'));

void app.whenReady().then(() => {
  // Deny every site permission request (camera, mic, geolocation, ...) by
  // default. A future version should replace this with a per-origin
  // prompt; refusing everything is the safe default until that exists.
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  protocol.handle(NORTHSTAR_SCHEME, (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'home') {
      return new Response('Not found', { status: 404 });
    }
    return new Response(buildHomePageHtml(), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        // No script runs on this page at all, so this is defense in depth
        // rather than a load-bearing protection — but it's free, and it's
        // the delivery method the rest of the app's chrome CSP also uses.
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action https:;",
      },
    });
  });

  registerTabIpc(() => {
    if (!activeTabManager) {
      throw new Error('No window is open yet');
    }
    return activeTabManager;
  });
  registerWindowIpc();
  registerThemeIpc();
  buildMenu(
    () => activeTabManager,
    () => activeTabManager?.getState().activeTabId ?? null,
  );

  launchWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      launchWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

/** Creates a window and its `TabManager`, and makes it the active one. */
function launchWindow(): void {
  const window = createMainWindow();
  const tabManager = new TabManager(
    window,
    (state) => window.webContents.send(IpcChannel.TabsStateChanged, state),
    bookmarkStore,
  );

  window.on('focus', () => {
    activeTabManager = tabManager;
  });
  activeTabManager = tabManager;

  window.on('resize', () => tabManager.updateBounds());
  window.on('closed', () => tabManager.disposeAllTerminals());
  window.webContents.once('did-finish-load', () => tabManager.createTab());

  // Drives WindowControls' maximize/restore icon — the frameless window has
  // no native titlebar to show that state itself (see MainWindow.ts).
  window.on('maximize', () => window.webContents.send(IpcChannel.WindowStateChanged, { isMaximized: true }));
  window.on('unmaximize', () => window.webContents.send(IpcChannel.WindowStateChanged, { isMaximized: false }));
}
