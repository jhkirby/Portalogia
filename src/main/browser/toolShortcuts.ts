// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-19

import type { KeyChord } from './textEditingChords';

/** A key event with the physical key it came from, as Electron's `Input` reports it. */
export interface PhysicalKeyChord extends KeyChord {
  /** The physical key (`'KeyE'`), whatever character the layout makes of it. */
  readonly code: string;
}

/**
 * The Ctrl+letter keys that pick a toolbar tool: the laser pointer (I), pen
 * (P), highlighter (J), comments (M), text box (E), and the Pan (1) and
 * Select (2) pointer modes.
 */
const TOOL_KEYS = new Set(['i', 'p', 'j', 'm', 'e', '1', '2']);

/** The Ctrl+Shift+letter keys that work a tool: Crop (X) and Revert Annotations (R). */
const SHIFTED_TOOL_KEYS = new Set(['x', 'r']);

/**
 * Whether a key is one of the toolbar tools' shortcuts — the keys a browser
 * tab in edit mode leaves to its page, since a web app (Google Docs: italic,
 * print, justify, comment, center) binds the same ones.
 * @param input The key event.
 * @returns `true` for a tool's shortcut.
 */
export function isToolShortcut(input: KeyChord): boolean {
  if (!(input.control || input.meta) || input.alt) {
    return false;
  }
  const key = input.key.toLowerCase();
  return input.shift ? SHIFTED_TOOL_KEYS.has(key) : TOOL_KEYS.has(key);
}

/**
 * Whether a key is edit mode's own on/off switch, Ctrl+Alt+Shift+E: three
 * modifiers, so no web page has a use for it, and E for edit. Matched by
 * physical key, since on Windows Ctrl+Alt is AltGr and can turn `key` into
 * another character (€ on many layouts).
 * @param input The key event.
 * @returns `true` for the switch.
 */
export function isEditModeToggle(input: PhysicalKeyChord): boolean {
  return (input.control || input.meta) && input.alt && input.shift && input.code === 'KeyE';
}
