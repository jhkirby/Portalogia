// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-11

import { join } from 'node:path';
import { app, BrowserWindow, session } from 'electron';

/**
 * Chrome-window-only content-security-policy; tab content is exempt.
 * In dev, Vite's client injects an inline bootstrap `<script>` to wire up
 * React Fast Refresh, so `script-src` needs `'unsafe-inline'` there; the
 * packaged production build has no inline scripts and stays strict.
 */
function buildChromeCsp(isDev: boolean): string {
  const scriptSrc = isDev ? "script-src 'self' 'unsafe-inline'; " : '';
  return `default-src 'self'; ${scriptSrc}style-src 'self' 'unsafe-inline'; img-src 'self' data:`;
}

/**
 * Creates the app's single top-level window: a `BrowserWindow` that loads
 * our own React chrome (tab bar, address bar) as its page, with secure
 * `webPreferences` baked in so no window is ever created without them.
 * Tab content lives in `WebContentsView`s added to this window's
 * `contentView` by `TabManager` — never in this window's own `webContents`.
 * @returns The created window.
 */
export function createMainWindow(options: { showWhenReady?: boolean } = {}): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    show: false,
    // Packaged Windows/macOS builds get their icon baked into the exe/app
    // bundle by electron-builder (see the `build.win.icon`/`mac.icon`
    // config in package.json, both pointing at this same file) — that
    // config alone doesn't reach `npm run dev`, though, which is still
    // just bare `electron.exe` and would otherwise show Electron's own
    // default icon in the taskbar. Setting it explicitly here covers both.
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

  applyChromeContentSecurityPolicy(window);

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
 * Attaches a strict CSP to responses for the chrome window's own document,
 * identified by URL rather than applied session-wide — tabs share the same
 * default session and must be free to load whatever CSP (or none) the
 * sites they visit send.
 * @param window The chrome window to protect.
 */
function applyChromeContentSecurityPolicy(window: BrowserWindow): void {
  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  const patterns = devServerUrl ? [`${devServerUrl}/*`] : ['file://*/*'];
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: patterns },
    (details, callback) => {
      if (details.webContentsId !== window.webContents.id) {
        // exactOptionalPropertyTypes rejects passing `undefined` through
        // for an optional property — omit it entirely instead when there
        // are no headers to forward.
        callback(details.responseHeaders ? { responseHeaders: details.responseHeaders } : {});
        return;
      }
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [buildChromeCsp(devServerUrl !== undefined)],
        },
      });
    },
  );
}
