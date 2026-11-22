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
 * after a click into it or Escape in the chrome, and loses it to Shift+Escape,
 * a click into the chrome, or the window losing focus.
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

/** The class on `<html>` while the pointer is over this page. */
export const PAGE_HOVERED_CLASS = 'page-hovered';

/**
 * Marks this page's `<html>` with `PAGE_HOVERED_CLASS` while the pointer is over it, so its stylesheet can give the
 * frame around its content a soft glow — the counterpart of the chrome's hovered frame around a web page
 * (`BrowserState`'s `hoveredContentTabId`). The keyboard's accent (`PAGE_FOCUSED_CLASS`) wins over it.
 * Call once, at the page's start.
 */
export function trackPageHover(): void {
  const root = document.documentElement;
  root.addEventListener('mouseenter', () => root.classList.add(PAGE_HOVERED_CLASS));
  root.addEventListener('mouseleave', () => root.classList.remove(PAGE_HOVERED_CLASS));
  window.addEventListener('blur', () => {
    // A press that leaves the window (onto the chrome or another app) can skip the page's own mouseleave.
    if (!root.matches(':hover')) {
      root.classList.remove(PAGE_HOVERED_CLASS);
    }
  });
}
