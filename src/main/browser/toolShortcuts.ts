// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-21

import type { MarkdownFormatAction } from '@shared/ipc-contract';
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

/** Ctrl+Alt + a physical key, in a note being edited, and the block it makes (Google Docs' headings, plus four more). */
const MARKDOWN_ALT_CODES: Readonly<Record<string, MarkdownFormatAction>> = {
  Digit0: 'heading0',
  Digit1: 'heading1',
  Digit2: 'heading2',
  Digit3: 'heading3',
  Digit4: 'heading4',
  Digit5: 'heading5',
  Digit6: 'heading6',
  KeyC: 'callout',
  KeyD: 'divider',
  KeyH: 'html',
  KeyI: 'image',
};

/** Ctrl+Shift + a physical digit, as in Google Docs: numbered list, bulleted list, checklist. */
const MARKDOWN_SHIFT_CODES: Readonly<Record<string, MarkdownFormatAction>> = {
  Digit7: 'orderedList',
  Digit8: 'bulletList',
  Digit9: 'taskList',
};

/**
 * The note editor's block shortcut a key is, if any: Ctrl+Alt+0–6 (normal
 * text, headings), Ctrl+Alt+C/D/H/I (callout, divider, raw HTML, picture), and
 * Ctrl+Shift+7/8/9 (numbered, bulleted, checklist). By physical key, since
 * Ctrl+Alt is AltGr on many layouts and Shift turns the digits into symbols.
 * @param input The key event.
 * @returns The formatting action, or `null`.
 */
export function markdownFormatShortcut(input: PhysicalKeyChord): MarkdownFormatAction | null {
  if (!(input.control || input.meta)) {
    return null;
  }
  if (input.alt && !input.shift) {
    return MARKDOWN_ALT_CODES[input.code] ?? null;
  }
  if (input.shift && !input.alt) {
    return MARKDOWN_SHIFT_CODES[input.code] ?? null;
  }
  return null;
}
