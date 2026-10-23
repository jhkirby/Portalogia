// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

import { ipcRenderer } from 'electron';

// Hardcoded rather than imported from `@shared/ipc-contract` — see `tabZoom.ts`'s own comment on `ZoomApply`.
const TabLoadBlur = 'tab:load-blur';
/** How long, in ms, a page stays blurred at most, so one whose `load` never comes (a stalled ad) still shows. */
const MAX_BLUR_MS = 8000;
/** How long, in ms, the blur takes to clear: `transition` below. */
const CLEAR_MS = 300;
/** How long, in ms, a page stays blurred at least, so one that loads at once (from the cache) still shows the blur. */
const MIN_BLUR_MS = 450;

// A page arriving from a different site starts out blurred and clears once it has loaded (main decides which:
// `domainLoadBlur.ts`). Asked synchronously, before the page's first paint, so it never shows sharp first.
if (ipcRenderer.sendSync(TabLoadBlur) === true) {
  const style = document.createElement('style');
  style.textContent = 'html { filter: blur(16px) !important; transition: filter 300ms ease-out !important; }';
  const attach = (): void => {
    (document.head ?? document.documentElement).appendChild(style);
  };
  if (document.documentElement) {
    attach();
  } else {
    const observer = new MutationObserver(() => {
      if (document.documentElement) {
        observer.disconnect();
        attach();
      }
    });
    observer.observe(document, { childList: true });
  }

  const blurredAt = performance.now();
  let cleared = false;
  const clear = (): void => {
    if (cleared) {
      return;
    }
    cleared = true;
    // Waits out the shortest blur, then a painted frame, so the page has been shown blurred before the transition
    // starts; otherwise a page that loads before its first paint never shows the blur, or its fade, at all.
    setTimeout(
      () =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            style.textContent = 'html { filter: blur(0) !important; transition: filter 300ms ease-out !important; }';
            setTimeout(() => style.remove(), CLEAR_MS);
          }),
        ),
      Math.max(0, MIN_BLUR_MS - (performance.now() - blurredAt)),
    );
  };
  if (document.readyState === 'complete') {
    clear();
  } else {
    window.addEventListener('load', clear, { once: true });
  }
  setTimeout(clear, MAX_BLUR_MS);
}
