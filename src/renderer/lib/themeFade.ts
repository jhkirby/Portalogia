// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-24

import { THEME_FADE_MS } from '@shared/constants';

/** On `<html>` while a light/dark switch fades: colors.css then transitions every colour (`.theme-fading`). */
const FADING_CLASS = 'theme-fading';

let fadeTimer = 0;

/**
 * Switches this page's `data-theme` (what colors.css's tokens key off),
 * fading every colour to the new theme over `THEME_FADE_MS` rather than at
 * once — live, so whatever is moving on the page (the fluids) keeps moving
 * through it. Setting the theme a page starts in doesn't fade.
 * @param theme The theme to show.
 */
export function applyTheme(theme: 'light' | 'dark'): void {
  const root = document.documentElement;
  const current = root.dataset['theme'];
  if (current === theme) {
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
