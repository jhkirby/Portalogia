// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-26

import { THEME_FADE_MS } from '@shared/constants';

/** On `<html>` while a light/dark switch fades: colors.css then transitions every colour (`.theme-fading`). */
const FADING_CLASS = 'theme-fading';

let fadeTimer = 0;

/**
 * Switches this page's `data-theme` (what colors.css's tokens key off),
 * fading every colour to the new theme over `THEME_FADE_MS` rather than at
 * once — live, so whatever is moving on the page (the fluids) keeps moving
 * through it. Setting the theme a page starts in doesn't fade.
 *
 * With `snapshot`, the page instead crossfades from a picture of itself in
 * the old theme to itself in the new (a view transition, colors.css's
 * `::view-transition-*`). The compositor runs that fade, so it stays smooth
 * through the main-thread work a switch sets off; transitioning every
 * colour live on the chrome dropped frames and stepped. Only the picture
 * of the old theme holds still: the page in the new one is live under it.
 * @param theme The theme to show.
 * @param options `snapshot`: crossfade by a view transition, where supported.
 */
export function applyTheme(theme: 'light' | 'dark', options: { snapshot?: boolean } = {}): void {
  const root = document.documentElement;
  const current = root.dataset['theme'];
  if (current === theme) {
    return;
  }
  if (current !== undefined && options.snapshot === true && typeof document.startViewTransition === 'function') {
    // A transition still running is skipped to its end, and this one fades from there.
    document.startViewTransition(() => {
      root.dataset['theme'] = theme;
    });
    return;
  }
  if (current !== undefined) {
    // On before the attribute changes, so the change itself is what transitions.
    root.classList.add(FADING_CLASS);
    window.clearTimeout(fadeTimer);
    fadeTimer = window.setTimeout(() => root.classList.remove(FADING_CLASS), THEME_FADE_MS + 50);
  }
  root.dataset['theme'] = theme;
}

/**
 * Keeps a page that isn't the chrome (a note, a PDF, an overlay) in the
 * system theme — which main sets to match the chrome's toggle
 * (`nativeTheme.themeSource`) — fading on each change (`applyTheme`).
 */
export function followSystemTheme(): void {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = (): void => applyTheme(query.matches ? 'dark' : 'light');
  apply();
  query.addEventListener('change', apply);
}
