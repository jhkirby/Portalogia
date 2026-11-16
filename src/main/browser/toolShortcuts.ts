// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-12

import type { KeyChord } from './textEditingChords';

/** A key event with the physical key it came from, as Electron's `Input` reports it. */
export interface PhysicalKeyChord extends KeyChord {
  /** The physical key (`'KeyE'`), whatever character the layout makes of it. */
  readonly code: string;
}

/**
 * The Ctrl+letter keys that pick a toolbar tool: the laser pointer (I), pen
 * (P), highlighter (J), comments (M) and text box (E). Pan and Select are
 * Alt+1 and Alt+2 (`pointerModeShortcut`); F1–F7 jump to tabs.
 */
const TOOL_KEYS = new Set(['i', 'p', 'j', 'm', 'e']);

/** The physical keys Alt+1 and Alt+2 come from, and the pointer mode each picks. */
const POINTER_MODE_CODES: Readonly<Record<string, 'pan' | 'select'>> = { Digit1: 'pan', Digit2: 'select' };

/** The physical keys F1 to F7, in order: each jumps to that tab. */
const TAB_JUMP_CODES = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7'];

/** The Ctrl+Shift+letter keys that work a tool: Crop (X) and Revert Annotations (R). */
const SHIFTED_TOOL_KEYS = new Set(['x', 'r']);

/**
 * Whether a key is one of the toolbar tools' shortcuts — pressed in the
 * chrome only: a page with the keyboard keeps them, since a web app (Google
 * Docs: italic, print, justify, comment, center) binds the same ones.
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
 * The pointer mode a key picks: Alt+1 Pan, Alt+2 Select. Matched by physical
 * key, so the shifted row of another layout still works. Like the tools'
 * keys, a page with the keyboard keeps these.
 * @param input The key event.
 * @returns The mode, or `null` for any other key.
 */
export function pointerModeShortcut(input: PhysicalKeyChord): 'pan' | 'select' | null {
  if (!input.alt || input.control || input.meta || input.shift) {
    return null;
  }
  return POINTER_MODE_CODES[input.code] ?? null;
}

/**
 * Which tab F1 to F7 jumps to: the first to the seventh of the workspace.
 * Only the bare key counts, so a page's own Ctrl/Alt/Shift+F-key chords are
 * left alone. Matched by physical key.
 * @param input The key event.
 * @returns The tab's 0-based place, or `null` for any other key.
 */
export function tabJumpIndex(input: PhysicalKeyChord): number | null {
  if (input.control || input.meta || input.alt || input.shift) {
    return null;
  }
  const at = TAB_JUMP_CODES.indexOf(input.code);
  return at === -1 ? null : at;
}
