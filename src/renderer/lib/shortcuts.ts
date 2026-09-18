// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-18

const isMac = navigator.platform.toLowerCase().includes('mac');

/** Maps a modifier's cross-platform name to its macOS glyph; anything absent here (the trailing key) passes through as-is. */
const MAC_SYMBOLS: Record<string, string> = {
  Shift: '⇧',
  Alt: '⌥',
};

/**
 * Formats an accelerator for display in a button's tooltip, matching each
 * platform's own convention — `⌘⇧F` on macOS, `Ctrl+Shift+F` elsewhere —
 * so a single call site doesn't need to know which OS it's running on.
 * @param keys The accelerator's modifiers and key after "CmdOrCtrl", e.g.
 *   `'B'` or `'Shift+F'`.
 * @returns The platform-appropriate shortcut string, e.g. `'Ctrl+B'` or `'⌘⇧F'`.
 */
export function formatShortcut(keys: string): string {
  if (!isMac) {
    return `Ctrl+${keys}`;
  }
  return `⌘${keys
    .split('+')
    .map((part) => MAC_SYMBOLS[part] ?? part)
    .join('')}`;
}

/**
 * Same as {@link formatShortcut}, but for an accelerator built on Alt
 * rather than CmdOrCtrl (e.g. back/forward's `Alt+Left`) — `⌥←` on macOS,
 * `Alt+←` elsewhere.
 * @param key The key after "Alt", e.g. `'←'`.
 * @returns The platform-appropriate shortcut string, e.g. `'Alt+←'` or `'⌥←'`.
 */
export function formatAltShortcut(key: string): string {
  return isMac ? `⌥${key}` : `Alt+${key}`;
}
