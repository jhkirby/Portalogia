// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

import type { WebContents } from 'electron';
import type { RGB } from '@shared/color';
import { IpcChannel } from '@shared/ipc-contract';

/** Same default `useAccentColor` (renderer) falls back to before it's ever reported anything via `setAccentColor` — matches so a tab created before that first report (essentially only ever the very first tab of a fresh launch) doesn't show a different blue than everything else briefly does. */
let currentAccent: RGB = { r: 26, g: 115, b: 232 };

/** Every browser tab's `webContents` currently wired to track the accent — see `trackPageSelectionAccent`. A `Set` rather than deriving this from `TabManager`'s own `views` map each time, since a destroyed tab has to stop being re-styled immediately, not just next time something else iterates that map. */
const trackedWebContents = new Set<WebContents>();

/** The key `insertCSS` returned for whatever's currently injected into a given `webContents`, so a later re-style (`setPageSelectionAccent`) can remove the stale rule before adding the new one instead of the two stacking up as separate stylesheets across every accent change for as long as that tab's document stays loaded. */
const insertedCssKeys = new WeakMap<WebContents, string>();

/**
 * The accent for the page's text selection and its focus ring. Electron never gives Chromium a focus-ring colour, so a
 * focused element's default ring (`outline: auto`) falls back to Blink's orange; this colours it with the accent
 * instead. `:where()` keeps it at no specificity, so a page's own focus styles still win.
 */
function selectionCss(rgb: RGB): string {
  return (
    `::selection { background-color: rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4); } ` +
    `:where(:focus, :focus-visible) { outline-color: rgb(${rgb.r}, ${rgb.g}, ${rgb.b}); }`
  );
}

/**
 * (Re-)applies `rgb` to every tracked tab's live document, and remembers
 * it as what a newly-loaded document should get too. A tab's own page
 * content is a separate document `colors.css`'s own `::selection` rule
 * (which covers every one of this app's *own* renderer documents) can
 * never reach, so this is the other half of keeping the browser's native
 * text-selection highlight on-brand everywhere — see `NorthstarApi.setAccentColor`'s
 * own doc comment for why main has to be told this at all rather than
 * reading it off a renderer's DOM directly.
 * @param rgb The chrome's current accent — whichever window last reported
 *   it (see `setAccentColor`); every window shows the same one anyway
 *   (`useAccentColor`'s own cross-window sync), so it doesn't matter which.
 */
export function setPageSelectionAccent(rgb: RGB): void {
  currentAccent = rgb;
  for (const wc of trackedWebContents) {
    applyCss(wc);
    // The new-tab page's fluid recolours itself too (`tabHomeFluid.ts`).
    if (!wc.isDestroyed()) {
      wc.send(IpcChannel.TabAccentChanged, rgb);
    }
  }
}

/**
 * The chrome's current accent, as last reported by `setAccentColor` — read
 * by `HighlighterController` so a highlight created before a page-specific
 * color has ever been requested still gets a sane, on-brand color, without
 * duplicating the tracking `setPageSelectionAccent` already does.
 */
export function getCurrentAccent(): RGB {
  return currentAccent;
}

/**
 * Starts keeping one browser tab's page content styled with the current
 * accent — re-applied on every fresh document (`dom-ready`, since a
 * navigation's new document has none of the previous one's injected CSS)
 * and again on every subsequent `setPageSelectionAccent` call for as long
 * as this tab's view exists. Call once per browser tab's `webContents`
 * (see `TabManager.wireEvents`) — a terminal tab's own view renders
 * `terminal.html`, one of this app's own documents already covered by
 * `colors.css`'s `::selection` rule, so it has no reason to call this.
 * @param wc The browser tab's `webContents` to track.
 */
export function trackPageSelectionAccent(wc: WebContents): void {
  trackedWebContents.add(wc);
  wc.on('dom-ready', () => applyCss(wc));
  // The new-tab page's fluid (`tabHomeFluid.ts`) asks for the accent to colour itself with.
  wc.ipc.on(IpcChannel.TabAccent, (event) => {
    event.returnValue = currentAccent;
  });
  wc.on('destroyed', () => trackedWebContents.delete(wc));
}

function applyCss(wc: WebContents): void {
  if (wc.isDestroyed()) {
    return;
  }
  const previousKey = insertedCssKeys.get(wc);
  const insert = (): void => {
    wc.insertCSS(selectionCss(currentAccent))
      .then((key) => insertedCssKeys.set(wc, key))
      .catch(() => {
        // The document can navigate away between this call starting and
        // resolving — nothing to clean up, the next `dom-ready` for
        // whatever loaded instead will insert its own fresh copy.
      });
  };
  if (previousKey) {
    wc.removeInsertedCSS(previousKey)
      .catch(() => {
        // Already gone (e.g. the document that owned it navigated away) —
        // fine either way, `insert` below still applies to whatever's
        // current now.
      })
      .finally(insert);
  } else {
    insert();
  }
}
