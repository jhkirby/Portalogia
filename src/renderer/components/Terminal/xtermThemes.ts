// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-24

import type { ITheme } from '@xterm/xterm';

/**
 * xterm.js's default ANSI palette (bright yellow/white especially) is
 * tuned for a dark background and goes near-illegible on a light one, so
 * light mode needs its own full palette rather than just swapping
 * background/foreground — this one reuses the same accent colors as the
 * chrome's own light theme (`colors.css`'s `:root[data-theme='light']`)
 * so a terminal tab doesn't look like it wandered in from a different app.
 */
export const XTERM_LIGHT_THEME: ITheme = {
  background: '#ffffff',
  foreground: '#1a1a1a',
  cursor: '#1a1a1a',
  cursorAccent: '#ffffff',
  selectionBackground: 'rgba(26, 115, 232, 0.2)',
  black: '#3c4043',
  red: '#d93025',
  green: '#188038',
  yellow: '#ea8600',
  blue: '#1967d2',
  magenta: '#a142f4',
  cyan: '#12b5cb',
  white: '#5f6368',
  brightBlack: '#80868b',
  brightRed: '#c5221f',
  brightGreen: '#137333',
  brightYellow: '#e37400',
  brightBlue: '#1a73e8',
  brightMagenta: '#9334e6',
  brightCyan: '#129eaf',
  brightWhite: '#202124',
};

/** The dark counterpart to {@link XTERM_LIGHT_THEME} — xterm's own built-in ANSI defaults are already tuned for a dark background, so only the handful of colors that were previously hardcoded need setting explicitly here. */
export const XTERM_DARK_THEME: ITheme = {
  background: '#1e1e1e',
  foreground: '#e8eaed',
  cursor: '#e8eaed',
  cursorAccent: '#1e1e1e',
  selectionBackground: 'rgba(255, 255, 255, 0.25)',
};

/**
 * Picks the theme matching the app's current light/dark choice.
 * `terminal.html` has no access to the chrome's own `useTheme` state
 * (separate `WebContentsView`, separate JS context) — but `useTheme`
 * reports every theme change to main via `setNativeTheme`, which sets
 * `nativeTheme.themeSource` process-wide, and that in turn drives
 * `prefers-color-scheme` for every renderer, this one included. Same
 * mechanism the `northstar://home` page already relies on.
 * @returns The theme to pass to `new XTerm({ theme })`.
 */
export function currentXtermTheme(): ITheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? XTERM_DARK_THEME : XTERM_LIGHT_THEME;
}
