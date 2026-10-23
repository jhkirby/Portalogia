// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

import type { WebContents } from 'electron';
import { SEARCH_URL_TEMPLATE } from '@shared/constants';
import { IpcChannel } from '@shared/ipc-contract';

/** The page's look while blurred: the same on the page being left (inserted here) and the one arriving (its preload). */
const BLUR_CSS = 'html { filter: blur(16px) !important; transition: filter 300ms ease-out !important; }';

/** A URL's host, or `null` for one without (the app's own pages, `about:blank`) or one that doesn't parse. */
function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) ? parsed.hostname : null;
  } catch {
    return null;
  }
}

/** The search engine's results page (an address-bar search and any later search there), without its query. */
const SEARCH_RESULTS_PAGE = (() => {
  const url = new URL(SEARCH_URL_TEMPLATE);
  return `${url.origin}${url.pathname}`;
})();

/** Whether going to `target` from `current` blurs: a different site, or the search engine's results. */
function blursFor(target: string, current: string): boolean {
  const host = hostOf(target);
  if (host === null) {
    return false;
  }
  return host !== hostOf(current) || target.startsWith(SEARCH_RESULTS_PAGE);
}

/**
 * Blurs a browser tab's page while it goes to a different site, until the new page has loaded: the page being left
 * blurs as soon as the navigation starts, and the arriving page starts out blurred (its preload, `tabLoadBlur.ts`,
 * asks here before its first paint) and clears once its `load` event fires. Search results blur too, though they stay
 * on one site; any other link or reload within the same site doesn't. Call once per browser tab's `webContents` (`TabManager.wireEvents`).
 * @param wc The browser tab's `webContents`.
 */
export function trackDomainLoadBlur(wc: WebContents): void {
  // Whether the next document to ask should start out blurred.
  let blurNext = false;
  // The blur put on the page being left, so a navigation that never replaces it (a download, an error) can lift it.
  let leavingKey: string | null = null;

  const unblurLeaving = (): void => {
    const key = leavingKey;
    leavingKey = null;
    if (key && !wc.isDestroyed()) {
      // Fails harmlessly once the page it was put on is gone.
      wc.removeInsertedCSS(key).catch(() => {});
    }
  };

  wc.on('did-start-navigation', (details) => {
    if (!details.isMainFrame || details.isSameDocument) {
      return;
    }
    blurNext = blursFor(details.url, wc.getURL());
    if (blurNext && !leavingKey) {
      wc.insertCSS(BLUR_CSS)
        .then((key) => {
          leavingKey = key;
        })
        .catch(() => {});
    }
  });

  // The preload's question, asked synchronously so the answer is in before the page first paints.
  wc.ipc.on(IpcChannel.TabLoadBlur, (event) => {
    const blur = blurNext && event.senderFrame === wc.mainFrame;
    if (event.senderFrame === wc.mainFrame) {
      blurNext = false;
      // The page being left is gone; its blur went with it.
      leavingKey = null;
    }
    event.returnValue = blur;
  });

  // The navigation ended without a new page asking (a download, a 204, a failed load showing nothing new).
  wc.on('did-stop-loading', () => {
    blurNext = false;
    unblurLeaving();
  });
}
