// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

import { test, expect } from '@playwright/test';
import {
  isEditModeToggle,
  isToolShortcut,
  pointerModeShortcut,
  tabJumpIndex,
  type PhysicalKeyChord,
} from '../../src/main/browser/toolShortcuts';

/** A key with the modifiers named in `held` down, the way Electron's `before-input-event` reports it. */
function chord(key: string, code: string, ...held: ('control' | 'meta' | 'alt' | 'shift')[]): PhysicalKeyChord {
  return {
    key,
    code,
    control: held.includes('control'),
    meta: held.includes('meta'),
    alt: held.includes('alt'),
    shift: held.includes('shift'),
  };
}

test.describe('isToolShortcut', () => {
  test('every tool key with Ctrl is a tool shortcut', () => {
    for (const key of ['i', 'p', 'j', 'm', 'e']) {
      expect(isToolShortcut(chord(key, ''))).toBe(false);
      expect(isToolShortcut(chord(key, '', 'control'))).toBe(true);
    }
  });

  test('Cmd counts the same as Ctrl', () => {
    expect(isToolShortcut(chord('j', 'KeyJ', 'meta'))).toBe(true);
  });

  test('crop and revert need Shift, and Shift turns the other tool keys into something else', () => {
    expect(isToolShortcut(chord('X', 'KeyX', 'control', 'shift'))).toBe(true);
    expect(isToolShortcut(chord('R', 'KeyR', 'control', 'shift'))).toBe(true);
    expect(isToolShortcut(chord('x', 'KeyX', 'control'))).toBe(false);
    expect(isToolShortcut(chord('r', 'KeyR', 'control'))).toBe(false);
    // Ctrl+Shift+P opens a PDF tab and Ctrl+Shift+M a note: not tools.
    expect(isToolShortcut(chord('P', 'KeyP', 'control', 'shift'))).toBe(false);
    expect(isToolShortcut(chord('M', 'KeyM', 'control', 'shift'))).toBe(false);
  });

  test('Alt takes a key out of the tools (Ctrl+Alt is AltGr on Windows)', () => {
    expect(isToolShortcut(chord('e', 'KeyE', 'control', 'alt'))).toBe(false);
    expect(isToolShortcut(chord('X', 'KeyX', 'control', 'alt', 'shift'))).toBe(false);
  });

  test('app shortcuts that are not tools are left alone', () => {
    // Ctrl+1–8 jump to tabs now, so the digits are no tool's.
    for (const key of ['w', 'n', 't', 'b', 'f', 'l', 'z', 'arrowleft', '1', '2', '3']) {
      expect(isToolShortcut(chord(key, '', 'control'))).toBe(false);
    }
  });
});

test.describe('isEditModeToggle', () => {
  test('Ctrl+Alt+Shift+E switches edit mode', () => {
    expect(isEditModeToggle(chord('E', 'KeyE', 'control', 'alt', 'shift'))).toBe(true);
    expect(isEditModeToggle(chord('E', 'KeyE', 'meta', 'alt', 'shift'))).toBe(true);
  });

  test('matched by the physical key, whatever character AltGr makes of it', () => {
    expect(isEditModeToggle(chord('€', 'KeyE', 'control', 'alt', 'shift'))).toBe(true);
    expect(isEditModeToggle(chord('E', 'KeyQ', 'control', 'alt', 'shift'))).toBe(false);
  });

  test('every one of the three modifiers is needed', () => {
    expect(isEditModeToggle(chord('e', 'KeyE', 'control'))).toBe(false);
    expect(isEditModeToggle(chord('E', 'KeyE', 'control', 'shift'))).toBe(false);
    expect(isEditModeToggle(chord('e', 'KeyE', 'control', 'alt'))).toBe(false);
    expect(isEditModeToggle(chord('E', 'KeyE', 'alt', 'shift'))).toBe(false);
  });

  test('the switch is not itself a tool shortcut, so edit mode never leaves it to the page', () => {
    expect(isToolShortcut(chord('E', 'KeyE', 'control', 'alt', 'shift'))).toBe(false);
  });
});

test.describe('pointerModeShortcut', () => {
  test('Alt+1 is Pan and Alt+2 is Select, by physical key', () => {
    expect(pointerModeShortcut(chord('1', 'Digit1', 'alt'))).toBe('pan');
    expect(pointerModeShortcut(chord('2', 'Digit2', 'alt'))).toBe('select');
    // Another layout's character on the same key still counts.
    expect(pointerModeShortcut(chord('&', 'Digit1', 'alt'))).toBe('pan');
  });

  test('needs Alt alone: Ctrl+1 is a tab, and other digits are nothing', () => {
    expect(pointerModeShortcut(chord('1', 'Digit1'))).toBeNull();
    expect(pointerModeShortcut(chord('1', 'Digit1', 'control'))).toBeNull();
    expect(pointerModeShortcut(chord('1', 'Digit1', 'control', 'alt'))).toBeNull();
    expect(pointerModeShortcut(chord('!', 'Digit1', 'alt', 'shift'))).toBeNull();
    expect(pointerModeShortcut(chord('3', 'Digit3', 'alt'))).toBeNull();
  });
});

test.describe('tabJumpIndex', () => {
  test('Ctrl+1 to Ctrl+8 pick the first to the eighth tab, number pad too', () => {
    for (let digit = 1; digit <= 8; digit += 1) {
      expect(tabJumpIndex(chord(String(digit), `Digit${digit}`, 'control'))).toBe(digit - 1);
      expect(tabJumpIndex(chord(String(digit), `Numpad${digit}`, 'control'))).toBe(digit - 1);
    }
    expect(tabJumpIndex(chord('3', 'Digit3', 'meta'))).toBe(2);
  });

  test('9, 0, and any other modifier are not tab jumps', () => {
    expect(tabJumpIndex(chord('9', 'Digit9', 'control'))).toBeNull();
    expect(tabJumpIndex(chord('0', 'Digit0', 'control'))).toBeNull();
    expect(tabJumpIndex(chord('1', 'Digit1'))).toBeNull();
    expect(tabJumpIndex(chord('1', 'Digit1', 'control', 'shift'))).toBeNull();
    expect(tabJumpIndex(chord('1', 'Digit1', 'control', 'alt'))).toBeNull();
  });
});
