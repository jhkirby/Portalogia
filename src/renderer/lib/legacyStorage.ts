// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-03

/**
 * Copies a value saved under the app's old `northstar-` key prefix to its
 * new `portalogia-` key, then drops the old one, so preferences such as the
 * theme and accent color survive the rename from Northstar.
 *
 * Args:
 *   newKey: the current `portalogia-…` key.
 *   storage: the store to migrate in; defaults to `localStorage`.
 *
 * Does nothing when the new key already holds a value, when there is no old
 * value, or when storage throws (site data disabled).
 */
export function migrateLegacyKey(newKey: string, storage?: Storage): void {
  try {
    const store = storage ?? localStorage;
    const oldKey = newKey.replace(/^portalogia-/, 'northstar-');
    if (oldKey === newKey || store.getItem(newKey) !== null) {
      return;
    }
    const value = store.getItem(oldKey);
    if (value !== null) {
      store.setItem(newKey, value);
      store.removeItem(oldKey);
    }
  } catch {
    // Storage unavailable: the app falls back to its defaults.
  }
}
