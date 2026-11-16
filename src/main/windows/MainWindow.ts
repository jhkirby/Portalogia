// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { buildAppPageCsp } from '@shared/csp';
import type { AdBlocker } from '../adblock/AdBlocker';

/**
 * Creates the app's single top-level window: a `BrowserWindow` that loads
 * our own React chrome (tab bar, address bar) as its page, with secure
 * `webPreferences` baked in so no window is ever created without them.
 * Tab content lives in `WebContentsView`s added to this window's
 * `contentView` by `TabManager` — never in this window's own `webContents`.
 * @returns The created window.
 */
export function createMainWindow(adBlocker: AdBlocker, options: { showWhenReady?: boolean } = {}): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    // No smaller than it opens: below this the toolbar's buttons and the tab row no longer fit.
    minWidth: 1280,
    minHeight: 800,
    show: false,
    // The app always runs as bare `electron.exe`, which would otherwise
    // show Electron's own default icon in the taskbar.
    icon: join(__dirname, '../../resources/icon.ico'),
    // No native titlebar at all — `.titlebar` (App.tsx) is our own drag
    // region and window-control buttons, with no OS-drawn icon or title
    // text alongside them.
    frame: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      // This window's own webContents renders the chrome, including every
      // terminal tab's xterm.js instance — but a tab's *content* lives in
      // a separate WebContentsView layered on top and typically holds OS
      // keyboard focus, which left this one "backgrounded" from
      // Chromium's perspective. Defends against that throttling timers
      // and rendering; see `Terminal.tsx` for the separate recovery this
      // window still needs against xterm's own internal render-scheduling
      // getting stuck regardless of this setting.
      backgroundThrottling: false,
    },
  });

  // The chrome page is our own trusted code; it should never navigate away
  // from itself or spawn a bare OS window.
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  applyChromeContentSecurityPolicy(window, adBlocker);

  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // A spare window (see `main/index.ts`'s `prepareSpareWindow`) loads hidden and
  // is shown later, when a tab needs a window instantly.
  if (options.showWhenReady ?? true) {
    window.once('ready-to-show', () => window.show());
  }

  return window;
}

/**
 * Attaches a strict CSP (`buildAppPageCsp`) to responses for the chrome
 * window's own document — needed for the dev server, whose page has no CSP
 * `<meta>`; the packaged build's pages carry it in the page itself (see
 * `electron.vite.config.ts`), since a header isn't a sure thing for `file://`.
 * The document is identified by URL and by which window it's for rather than applied
 * session-wide - tabs share the same default session and must be free to
 * load whatever CSP (or none) the sites they visit send. Registered with the
 * ad blocker, which owns the session's single `onHeadersReceived` listener.
 * @param window The chrome window to protect.
 * @param adBlocker Where to register the CSP.
 */
function applyChromeContentSecurityPolicy(window: BrowserWindow, adBlocker: AdBlocker): void {
  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  const prefix = devServerUrl ? `${devServerUrl}/` : 'file://';
  const csp = buildAppPageCsp(devServerUrl !== undefined);
  const remove = adBlocker.addHeadersInterceptor((details) => {
    if (details.webContentsId !== window.webContents.id || !details.url.startsWith(prefix)) {
      return null;
    }
    return { responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } };
  });
  window.once('closed', remove);
}
