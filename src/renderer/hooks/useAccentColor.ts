// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-25

import { useCallback, useLayoutEffect, useState } from 'react';
import { rgbEquals, type RGB } from '../lib/color';

const ACCENT_STORAGE_KEY = 'northstar-accent-color';
const RECENTS_STORAGE_KEY = 'northstar-accent-recent-colors';
const RECENTS_MAX = 10;

/** Northstar's original brand blue (Material "Blue 600") — `colors.css`'s light-theme `--color-accent-text` before `ColorPicker` made it user-editable, and still the fallback for a first-ever launch with nothing in storage yet. */
export const DEFAULT_ACCENT: RGB = { r: 26, g: 115, b: 232 };

function isRgb(value: unknown): value is RGB {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as RGB).r === 'number' &&
    typeof (value as RGB).g === 'number' &&
    typeof (value as RGB).b === 'number'
  );
}

function readStoredAccent(): RGB | null {
  try {
    const raw = localStorage.getItem(ACCENT_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return isRgb(parsed) ? parsed : null;
  } catch {
    // Storage can throw in a locked-down environment (e.g. site data
    // disabled) — fall back to the default below, same as `useTheme`.
    return null;
  }
}

function readStoredRecents(): RGB[] {
  try {
    const raw = localStorage.getItem(RECENTS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter(isRgb).slice(0, RECENTS_MAX) : [];
  } catch {
    return [];
  }
}

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
 */
export function useAccentColor(): {
  accent: RGB;
  setAccent: (next: RGB) => void;
  recentColors: readonly RGB[];
  commitRecent: (color: RGB) => void;
} {
  const [accent, setAccentState] = useState<RGB>(() => readStoredAccent() ?? DEFAULT_ACCENT);
  const [recentColors, setRecentColors] = useState<RGB[]>(readStoredRecents);

  // `useLayoutEffect` rather than `useEffect` so the accent is in place
  // before the browser paints, same reasoning as `useTheme`'s own — avoids
  // a flash of the old color on launch or on switching between windows.
  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--color-accent-rgb', `${accent.r}, ${accent.g}, ${accent.b}`);
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
