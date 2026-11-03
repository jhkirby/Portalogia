// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-24

import type { ITheme } from '@xterm/xterm';
import { DEFAULT_ACCENT, readStoredAccent } from '../../lib/accentStorage';

/**
 * xterm.js's default ANSI palette (bright yellow/white especially) is
 * tuned for a dark background and goes near-illegible on a light one, so
 * light mode needs its own full palette rather than just swapping
 * background/foreground — this one reuses the same accent colors as the
 * chrome's own light theme (`colors.css`'s `:root[data-theme='light']`)
 * so a terminal tab doesn't look like it wandered in from a different app.
 *
 * `selectionBackground` is intentionally missing here — it's the one
 * color this palette can't hard-code, since it has to track
 * `ColorPicker`'s own accent (same reasoning `colors.css`'s light theme
 * has for deriving `--color-selection-bg` from `--color-accent-rgb`
 * instead of a fixed blue); `currentXtermTheme` fills it in fresh on
 * every call instead.
 */
export const XTERM_LIGHT_THEME: Omit<ITheme, 'selectionBackground'> = {
  background: '#ffffff',
  foreground: '#1a1a1a',
  cursor: '#1a1a1a',
  cursorAccent: '#ffffff',
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
 * mechanism the `portalogia://home` page already relies on.
 *
 * For the dark theme that's the whole story — `XTERM_DARK_THEME` is a
 * complete, static `ITheme`, its own `selectionBackground` deliberately
 * a neutral white rather than accent-tinted (same reasoning
 * `colors.css`'s own `--color-selection-bg` has for staying neutral in
 * dark mode). The light theme's `selectionBackground` isn't static the
 * same way: `terminal.html` doesn't read `--color-accent-rgb` at all
 * (there's no CSS token to inherit it from — xterm paints its own canvas,
 * not chrome-drawn DOM), so it's computed fresh here from whatever
 * `useAccentColor` last wrote to `localStorage`, the same source
 * `watchAccentColor` reads for this app's other, DOM-rendered pages.
 * Call this again (see `Terminal.tsx`'s own `storage` listener) whenever
 * that might have changed, not just once at creation — unlike a CSS
 * custom property, re-assigning `term.options.theme` is the only way
 * xterm ever picks up a new value.
 * @returns The theme to pass to `new XTerm({ theme })` or assign to `term.options.theme`.
 */
export function currentXtermTheme(): ITheme {
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return XTERM_DARK_THEME;
  }
  const { r, g, b } = readStoredAccent() ?? DEFAULT_ACCENT;
  return { ...XTERM_LIGHT_THEME, selectionBackground: `rgba(${r}, ${g}, ${b}, 0.2)` };
}
