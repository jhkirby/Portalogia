// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-25

import type { RGB } from '@shared/color';
import { migrateLegacyKey } from './legacyStorage';

export const ACCENT_STORAGE_KEY = 'portalogia-accent-color';
export const RECENTS_STORAGE_KEY = 'portalogia-accent-recent-colors';
export const RECENTS_MAX = 10;

migrateLegacyKey(ACCENT_STORAGE_KEY);
migrateLegacyKey(RECENTS_STORAGE_KEY);

/** Portalogia's original brand blue (Material "Blue 600") — `colors.css`'s light-theme `--color-accent-text` before `ColorPicker` made it user-editable, and still the fallback for a first-ever launch with nothing in storage yet. */
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

export function readStoredAccent(): RGB | null {
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

export function readStoredRecents(): RGB[] {
  try {
    const raw = localStorage.getItem(RECENTS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter(isRgb).slice(0, RECENTS_MAX) : [];
  } catch {
    return [];
  }
}

/**
 * Applies the currently-stored accent to *this* document
 * (`--color-accent-rgb` on `<html>`) and keeps it live from then on — for
 * a window that only ever needs to *display* colors derived from the
 * accent (the address bar's suggestions overlay, the color picker's own
 * overlay), never edit it, so it doesn't need the full `useAccentColor`
 * hook (React state, `setAccent`, the recents list).
 *
 * Every one of this app's windows and overlay `WebContentsView`s loads
 * `colors.css`, whose tokens (`--color-accent-text`, focus rings, the
 * spinner, a dragged tab's tint, selected-row backgrounds) all key off
 * `--color-accent-rgb` — but each is its own separate renderer document,
 * and setting a CSS custom property in one document has no effect on any
 * other. `useAccentColor` (the chrome's own copy) is the only one that
 * ever *writes* the choice, to `localStorage`; this is what lets every
 * other document mirror it, the same `storage`-event mechanism
 * `useAccentColor`'s own doc comment explains for syncing across whole
 * windows — an overlay's own page counts as "a different document" just
 * as much as a second window does.
 *
 * Call this once, synchronously, alongside each such page's own
 * `applyTheme()` (see `suggestions-main.tsx`) — before the first paint,
 * so there's no flash of the hard-coded default before the real accent
 * loads in.
 */
export function watchAccentColor(): void {
  const apply = (): void => {
    const accent = readStoredAccent() ?? DEFAULT_ACCENT;
    document.documentElement.style.setProperty('--color-accent-rgb', `${accent.r}, ${accent.g}, ${accent.b}`);
  };
  apply();
  window.addEventListener('storage', (event) => {
    if (event.key === ACCENT_STORAGE_KEY) {
      apply();
    }
  });
}
