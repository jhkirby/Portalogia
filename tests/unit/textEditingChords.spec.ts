// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-17

import { test, expect } from '@playwright/test';
import { isTextEditingChord, type KeyChord, type TextBoxContext } from '../../src/main/browser/textEditingChords';

const PLAIN: TextBoxContext = { codeEditor: false, richText: false };
const CODE: TextBoxContext = { codeEditor: true, richText: false };
const RICH: TextBoxContext = { codeEditor: false, richText: true };

/** A key with the modifiers named in `held` down, the way Electron's `before-input-event` reports it. */
function chord(key: string, ...held: ('control' | 'meta' | 'alt' | 'shift')[]): KeyChord {
  return {
    key,
    control: held.includes('control'),
    meta: held.includes('meta'),
    alt: held.includes('alt'),
    shift: held.includes('shift'),
  };
}

test.describe('isTextEditingChord', () => {
  test('a plain Escape belongs to the text box (it leaves it); a modified one does not', () => {
    expect(isTextEditingChord(chord('Escape'), PLAIN)).toBe(true);
    expect(isTextEditingChord(chord('Escape', 'shift'), PLAIN)).toBe(false);
    expect(isTextEditingChord(chord('Escape', 'control'), PLAIN)).toBe(false);
  });

  test('Ctrl or Alt with a caret key moves the caret, Shift held or not', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Backspace', 'Delete']) {
      expect(isTextEditingChord(chord(key, 'control'), PLAIN)).toBe(true);
      expect(isTextEditingChord(chord(key, 'control', 'shift'), PLAIN)).toBe(true);
      expect(isTextEditingChord(chord(key, 'alt'), PLAIN)).toBe(true);
    }
    expect(isTextEditingChord(chord('ArrowLeft', 'meta'), PLAIN)).toBe(true);
  });

  test('an unmodified caret key is not a chord — no shortcut uses it, so it needs no protecting', () => {
    expect(isTextEditingChord(chord('ArrowLeft'), PLAIN)).toBe(false);
  });

  test('the clipboard, select-all, undo and redo belong to every text box', () => {
    for (const key of ['a', 'c', 'v', 'x', 'z', 'y']) {
      expect(isTextEditingChord(chord(key, 'control'), PLAIN)).toBe(true);
    }
    expect(isTextEditingChord(chord('z', 'control', 'shift'), PLAIN)).toBe(true);
    expect(isTextEditingChord(chord('v', 'control', 'shift'), PLAIN)).toBe(true);
  });

  test('Ctrl+Shift+C and Ctrl+Shift+X stay the app’s (Close Note, Toggle Crop)', () => {
    expect(isTextEditingChord(chord('c', 'control', 'shift'), CODE)).toBe(false);
    expect(isTextEditingChord(chord('x', 'control', 'shift'), CODE)).toBe(false);
  });

  test('Ctrl+Alt chords are never editing chords (AltGr on Windows types characters through them)', () => {
    expect(isTextEditingChord(chord('z', 'control', 'alt'), PLAIN)).toBe(false);
  });

  test('the note editor keeps its own chords; a plain box leaves them to the app', () => {
    for (const key of ['/', '[', ']', 'Enter', 'm']) {
      expect(isTextEditingChord(chord(key, 'control'), CODE)).toBe(true);
      expect(isTextEditingChord(chord(key, 'control'), PLAIN)).toBe(false);
    }
  });

  test('in the note editor Ctrl+B and Ctrl+I stay with main, which turns them into Bold and Italic', () => {
    expect(isTextEditingChord(chord('b', 'control'), CODE)).toBe(false);
    expect(isTextEditingChord(chord('i', 'control'), CODE)).toBe(false);
  });

  test('Ctrl+L stays the app’s even in the note editor (its line selection is Alt+L on Windows)', () => {
    expect(isTextEditingChord(chord('l', 'control'), CODE)).toBe(false);
  });

  test('a rich editor keeps Ctrl+B/I/U; a plain box does not', () => {
    for (const key of ['b', 'i', 'u']) {
      expect(isTextEditingChord(chord(key, 'control'), RICH)).toBe(true);
      expect(isTextEditingChord(chord(key, 'control'), PLAIN)).toBe(false);
    }
  });

  test('app shortcuts no text box uses are never held back', () => {
    for (const key of ['w', 't', 'f', 'o', 'n', 'e', 'h', 'l']) {
      expect(isTextEditingChord(chord(key, 'control'), CODE)).toBe(false);
      expect(isTextEditingChord(chord(key, 'control'), RICH)).toBe(false);
    }
  });

  test('the key is matched case-insensitively (Shift or Caps Lock can report "Z")', () => {
    expect(isTextEditingChord(chord('Z', 'control', 'shift'), PLAIN)).toBe(true);
    expect(isTextEditingChord(chord('M', 'control'), CODE)).toBe(true);
  });
});
