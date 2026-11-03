// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import { BrowserWindow, type WebContents } from 'electron';

/**
 * The window whose own chrome page (tab bar, toolbar, sidebar) sent an IPC
 * message, or `null` if anything else sent it.
 *
 * `BrowserWindow.fromWebContents` alone is not enough to tell: it also
 * returns the window for a tab's `WebContentsView` mounted in it, so a tab's
 * page — an arbitrary website, if its renderer is compromised — would pass
 * as the chrome. Requiring the sender to be the window's *own* webContents
 * is what keeps the chrome-only channels chrome-only.
 * @param sender The `event.sender` of an IPC message.
 */
export function chromeWindowOf(sender: WebContents): BrowserWindow | null {
  const window = BrowserWindow.fromWebContents(sender);
  return window && !window.isDestroyed() && window.webContents === sender ? window : null;
}

/**
 * Whether an IPC message came from a chrome page rather than a tab's page.
 * @param event Any IPC event.
 */
export function isChromeSender(event: { sender: WebContents }): boolean {
  return chromeWindowOf(event.sender) !== null;
}
