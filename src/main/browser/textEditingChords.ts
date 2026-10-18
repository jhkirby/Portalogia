// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-17

/** The parts of a key event the check reads — the same names as Electron's `Input`, so one can be passed straight in. */
export interface KeyChord {
  readonly key: string;
  readonly control: boolean;
  readonly meta: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

/** The keys that move the caret or delete with a modifier held: Ctrl+← jumps a word, Ctrl+Home goes to the start. */
const CARET_KEYS = new Set(['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'home', 'end', 'pageup', 'pagedown', 'backspace', 'delete']);

/** Ctrl+letter chords every text box gives a meaning: select all, the clipboard, undo and redo. */
const CLIPBOARD_AND_HISTORY_KEYS = new Set(['a', 'c', 'v', 'x', 'z', 'y']);

/** Ctrl chords a `contenteditable` rich editor uses for formatting. */
const RICH_TEXT_KEYS = new Set(['b', 'i', 'u']);

/**
 * Ctrl chords the note editor (CodeMirror's default keymap, on Windows and
 * Linux) binds for itself: toggle comment (Ctrl+/), indent (Ctrl+[ and
 * Ctrl+]), insert a blank line (Ctrl+Enter) and tab-focus mode (Ctrl+M).
 * Ctrl+B and Ctrl+I aren't here: in the editor they are the app's own Bold
 * and Italic, which main hands to the editor itself
 * (`TabManager.formatMarkdown`). Its line selection is Alt+L, which no app
 * shortcut uses.
 */
const CODE_EDITOR_KEYS = new Set(['/', '[', ']', 'enter', 'm']);

/** Where the keyboard is, for `isTextEditingChord`: which extra chords the text box with the caret gives a meaning to. */
export interface TextBoxContext {
  /** The caret is in the note editor, which binds the chords in `CODE_EDITOR_KEYS`. */
  readonly codeEditor: boolean;
  /** The caret is in a web page's `contenteditable` editor, which binds Ctrl+B/I/U. */
  readonly richText: boolean;
}

/**
 * Whether a key is one a text box acts on, so an app shortcut on the same
 * key must leave it to the box while the caret is there: plain Escape (which
 * the page uses to leave the box), Ctrl/Alt with a caret-moving or deleting
 * key, the clipboard and undo/redo chords, and whatever the particular kind
 * of box binds for itself. Leaving the box (Escape) gives the shortcuts back.
 * @param input The key event, as Electron's `before-input-event` reports it (`Electron.Input` fits).
 * @param context Which kind of text box has the caret.
 * @returns `true` if the box should get the key instead of any shortcut.
 */
export function isTextEditingChord(input: KeyChord, context: TextBoxContext): boolean {
  const key = input.key.toLowerCase();
  const ctrl = input.control || input.meta;
  if (key === 'escape') {
    return !ctrl && !input.alt && !input.shift;
  }
  if (CARET_KEYS.has(key)) {
    return ctrl || input.alt;
  }
  if (!ctrl || input.alt) {
    return false;
  }
  if (CLIPBOARD_AND_HISTORY_KEYS.has(key)) {
    // With Shift only redo (Ctrl+Shift+Z) and plain-text paste (Ctrl+Shift+V) edit; Ctrl+Shift+C is still Close Note.
    return !input.shift || key === 'z' || key === 'v';
  }
  if (context.richText && !input.shift && RICH_TEXT_KEYS.has(key)) {
    return true;
  }
  return context.codeEditor && !input.shift && CODE_EDITOR_KEYS.has(key);
}
