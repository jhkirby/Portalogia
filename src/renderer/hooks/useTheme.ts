// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-24

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ThemePreference } from '@shared/ipc-contract';
import { applyTheme } from '../lib/themeFade';

export type Theme = ThemePreference;

const STORAGE_KEY = 'northstar-theme';

/**
 * Reads back a theme the user previously toggled to, or — on first ever
 * launch, before there's anything stored — falls back to the OS's own
 * light/dark preference so the app opens matching it.
 */
function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
  } catch {
    // Storage can throw in a locked-down environment (e.g. site data
    // disabled) — fall through to the system default below.
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Owns the app's light/dark theme: persisted across launches, reflected
 * onto `<html data-theme>` for `colors.css`'s
 * `[data-theme="dark"]`/`[data-theme="light"]` rules to pick up, and
 * reported to main (`setNativeTheme`) so `nativeTheme.themeSource` — and
 * native-rendered content that follows it, like the `northstar://home`
 * page — stays in sync too. Toggleable from the toolbar's theme button and
 * from Ctrl+D (a menu accelerator, not a renderer `keydown` listener —
 * same reasoning as `onOpenTabSearch`/`onFocusAddressBar`: the chrome
 * window can lose OS focus to whichever tab's `WebContentsView` the user
 * last clicked into, which a renderer-level listener would miss).
 *
 * A toggle fades: main first lays a snapshot of the window over it
 * (`prepareThemeFade`), the theme switches underneath, and the snapshot
 * fades away. A second toggle while the first is still being prepared is
 * ignored.
 */
export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  const switchingRef = useRef(false);
  const toggleTheme = useCallback(() => {
    if (switchingRef.current) {
      return;
    }
    switchingRef.current = true;
    void window.northstar
      .prepareThemeFade()
      .catch(() => {})
      .finally(() => {
        switchingRef.current = false;
        setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
      });
  }, []);

  // `useLayoutEffect` rather than `useEffect` so the attribute (and thus
  // the right theme's colors) is in place before the browser paints,
  // rather than flashing the other theme for a frame right after mount.
  useLayoutEffect(() => {
    // Faded, not switched at once (`applyTheme`); the first theme, on mount, just applies.
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Best-effort persistence — a locked-down environment just means
      // the choice doesn't survive a relaunch, not a functional break.
    }
    window.northstar.setNativeTheme(theme);
  }, [theme]);

  useEffect(() => window.northstar.onToggleTheme(toggleTheme), [toggleTheme]);

  return { theme, toggleTheme };
}
