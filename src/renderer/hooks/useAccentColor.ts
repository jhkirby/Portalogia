// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-25

import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import {
  ACCENT_STORAGE_KEY,
  DEFAULT_ACCENT,
  RECENTS_MAX,
  RECENTS_STORAGE_KEY,
  readStoredAccent,
  readStoredRecents,
} from '../lib/accentStorage';
import { rgbEquals, type RGB } from '../lib/color';

/**
 * Owns the app's accent color — the "default blue" `colors.css` otherwise
 * hard-codes per theme (`--color-accent-text`, focus rings, the spinner,
 * a dragged tab's tint, selected-row backgrounds) — plus the 10 most
 * recently picked colors `ColorPicker`'s swatch grid shows. Both persist
 * across launches, same pattern as `useTheme`.
 *
 * Applying it is a single `--color-accent-rgb` custom property set on
 * `<html>` (read by every one of those tokens in `colors.css`, each as
 * `rgb(var(--color-accent-rgb))` or `rgba(var(--color-accent-rgb), ...)`)
 * — deliberately the *same* value regardless of light/dark theme, since
 * the picker offers one accent for the whole app, not one per theme.
 *
 * Also the same value across every open window (e.g. after `tearOffTab`
 * splits one tab into its own window) *and* every overlay
 * `WebContentsView` (the suggestions dropdown, the color picker's own
 * page) — every one of those is a separate renderer document, and this
 * hook (which only ever runs in the chrome's own) is the sole writer to
 * `localStorage`; everything else mirrors it via the native `storage`
 * event, which fires in every *other* document sharing that storage the
 * instant one of them writes to it (see `watchAccentColor` for the
 * lighter-weight, read-only half of this used by those other documents).
 * That event deliberately never fires back in the document that made the
 * change, so there's no risk of it fighting a color still being dragged
 * there.
 */
export function useAccentColor(): {
  accent: RGB;
  setAccent: (next: RGB) => void;
  recentColors: readonly RGB[];
  commitRecent: (color: RGB) => void;
} {
  const [accent, setAccentState] = useState<RGB>(() => readStoredAccent() ?? DEFAULT_ACCENT);
  const [recentColors, setRecentColors] = useState<RGB[]>(readStoredRecents);

  // Picks up a color/recents change made in a *different* window — see
  // this hook's own doc comment for why this never fires for a change
  // this same window just made itself.
  useEffect(() => {
    const handleStorage = (event: StorageEvent): void => {
      if (event.key === ACCENT_STORAGE_KEY) {
        setAccentState(readStoredAccent() ?? DEFAULT_ACCENT);
      } else if (event.key === RECENTS_STORAGE_KEY) {
        setRecentColors(readStoredRecents());
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // `useLayoutEffect` rather than `useEffect` so the accent is in place
  // before the browser paints, same reasoning as `useTheme`'s own — avoids
  // a flash of the old color on launch or on switching between windows.
  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--color-accent-rgb', `${accent.r}, ${accent.g}, ${accent.b}`);
  }, [accent]);

  // Mirrors this hook's own doc comment on `setNativeTheme`'s reasoning,
  // just for the accent instead of the theme — main can't read this
  // document's CSS custom properties directly, and needs the value to
  // style a tab's own page content to match (`pageSelectionAccent`),
  // which `colors.css`'s own `::selection` rule can never reach.
  useEffect(() => {
    window.portalogia.setAccentColor(accent);
  }, [accent]);

  const setAccent = useCallback((next: RGB) => {
    setAccentState(next);
    try {
      localStorage.setItem(ACCENT_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Best-effort persistence, same as `useTheme` — a locked-down
      // environment just means the choice doesn't survive a relaunch.
    }
  }, []);

  const commitRecent = useCallback((color: RGB) => {
    setRecentColors((current) => {
      const deduped = current.filter((existing) => !rgbEquals(existing, color));
      const next = [color, ...deduped].slice(0, RECENTS_MAX);
      try {
        localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Best-effort, as above.
      }
      return next;
    });
  }, []);

  return { accent, setAccent, recentColors, commitRecent };
}
