// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

/** The class on `<html>` while this page has the keyboard. */
export const PAGE_FOCUSED_CLASS = 'page-focused';

/**
 * Marks this page's `<html>` with `PAGE_FOCUSED_CLASS` while the page has the
 * keyboard, so its stylesheet can light the frame around its content in the
 * accent — a PDF, note or terminal tab's counterpart of the frame the chrome
 * draws around a web page (`BrowserState.contentFocused`). The page has it
 * after a click into it or Escape in the chrome, and loses it to Shift+Escape
 * (or its own Escape), a click into the chrome, or the window losing focus.
 * Call once, at the page's start.
 */
export function trackPageFocus(): void {
  const sync = (): void => {
    document.documentElement.classList.toggle(PAGE_FOCUSED_CLASS, document.hasFocus());
  };
  window.addEventListener('focus', sync);
  window.addEventListener('blur', sync);
  sync();
}
