// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-21

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { EditorSelection, EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { test, expect } from '@playwright/test';
import { imageLinkFor, readImageDataUrl } from '../../src/main/browser/MarkdownVault';
import { PickedImageStore } from '../../src/main/browser/PickedImageStore';
import { markdownFormatShortcut, type PhysicalKeyChord } from '../../src/main/browser/toolShortcuts';
import { MARKDOWN_FORMAT_ACTIONS } from '../../src/shared/ipc-contract';
import { markdownApplyFormatRequestSchema } from '../../src/shared/ipc-schemas';
import { createMarkdownEngine, splitImageAlt } from '../../src/shared/markdown/parser';
import { insertBlockText, setHeadingLines, toggleListLines } from '../../src/renderer/lib/markdown/editorFormat';

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

/** The least of a CodeMirror view the raw-text tools use, so they run without a DOM. */
function fakeEditor(doc: string, from: number, to: number = from): { view: EditorView; text: () => string } {
  let state = EditorState.create({ doc, selection: EditorSelection.single(from, to) });
  const view = {
    get state() {
      return state;
    },
    dispatch: (spec: Parameters<EditorState['update']>[0]) => {
      state = state.update(spec).state;
    },
    focus: () => undefined,
  } as unknown as EditorView;
  return { view, text: () => state.doc.toString() };
}

test.describe('block shortcuts', () => {
  test('Ctrl+Alt+0–6 set the heading size, by physical key', () => {
    for (let level = 0; level <= 6; level += 1) {
      // AltGr turns the key into another character on many layouts: the code is what counts.
      expect(markdownFormatShortcut(chord('@', `Digit${level}`, 'control', 'alt'))).toBe(`heading${level}`);
    }
  });

  test('Ctrl+Shift+7/8/9 make numbered, bulleted and check lists', () => {
    expect(markdownFormatShortcut(chord('&', 'Digit7', 'control', 'shift'))).toBe('orderedList');
    expect(markdownFormatShortcut(chord('*', 'Digit8', 'control', 'shift'))).toBe('bulletList');
    expect(markdownFormatShortcut(chord('(', 'Digit9', 'control', 'shift'))).toBe('taskList');
  });

  test('Ctrl+Alt+C/D/H/I make a callout, divider, raw HTML and picture', () => {
    expect(markdownFormatShortcut(chord('c', 'KeyC', 'control', 'alt'))).toBe('callout');
    expect(markdownFormatShortcut(chord('d', 'KeyD', 'control', 'alt'))).toBe('divider');
    expect(markdownFormatShortcut(chord('h', 'KeyH', 'control', 'alt'))).toBe('html');
    expect(markdownFormatShortcut(chord('i', 'KeyI', 'control', 'alt'))).toBe('image');
  });

  test('other chords are left alone', () => {
    expect(markdownFormatShortcut(chord('1', 'Digit1', 'control'))).toBeNull();
    expect(markdownFormatShortcut(chord('1', 'Digit1', 'alt'))).toBeNull();
    expect(markdownFormatShortcut(chord('8', 'Digit8', 'control', 'alt', 'shift'))).toBeNull();
    // The window's own Ctrl+Alt keys (minimize, split screen) stay the window's.
    expect(markdownFormatShortcut(chord('m', 'KeyM', 'control', 'alt'))).toBeNull();
    expect(markdownFormatShortcut(chord('s', 'KeyS', 'control', 'alt'))).toBeNull();
    expect(markdownFormatShortcut(chord('7', 'Digit7', 'shift'))).toBeNull();
  });

  test('every action passes the IPC validator, and nothing else does', () => {
    for (const action of MARKDOWN_FORMAT_ACTIONS) {
      expect(markdownApplyFormatRequestSchema.safeParse({ id: 't', action }).success).toBe(true);
    }
    expect(markdownApplyFormatRequestSchema.safeParse({ id: 't', action: 'heading7' }).success).toBe(false);
    expect(markdownApplyFormatRequestSchema.safeParse({ id: 't', action: 'script' }).success).toBe(false);
  });
});

test.describe('picked pictures', () => {
  test('a picture is linked relative to the note, with / and each part encoded', () => {
    expect(imageLinkFor('C:\\notes\\a.md', 'C:\\notes\\pics\\my lamp.png', win32)).toBe('pics/my%20lamp.png');
    expect(imageLinkFor('C:\\notes\\deep\\a.md', 'C:\\notes\\x (1).png', win32)).toBe('../x%20(1).png');
    expect(imageLinkFor('/home/u/notes/a.md', '/home/u/notes/b.png', posix)).toBe('b.png');
  });

  test('a picture on another drive gets its absolute path', () => {
    expect(imageLinkFor('C:\\notes\\a.md', 'D:\\Photos\\sea #1.jpg', win32)).toBe('D:/Photos/sea%20%231.jpg');
  });

  test('a picked picture outside the vault can be shown; any other outside file still cannot', async () => {
    // A loose note may reach its own folder and the one above (`searchRoots`), so "elsewhere" is a cousin of both.
    const base = mkdtempSync(join(tmpdir(), 'portalogia-picked-vault-'));
    const vault = join(base, 'notes', 'inner');
    const elsewhere = join(base, 'elsewhere');
    mkdirSync(vault, { recursive: true });
    mkdirSync(elsewhere, { recursive: true });
    try {
      const notePath = join(vault, 'a.md');
      writeFileSync(notePath, '');
      const picked = join(elsewhere, 'picked.png');
      const other = join(elsewhere, 'other.png');
      writeFileSync(picked, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      writeFileSync(other, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const store = new PickedImageStore(null);
      store.add(picked);
      const isPicked = (path: string): boolean => store.has(path);
      expect(await readImageDataUrl(notePath, imageLinkFor(notePath, picked), isPicked)).toMatch(/^data:image\/png;base64,/);
      expect(await readImageDataUrl(notePath, imageLinkFor(notePath, other), isPicked)).toBeNull();
      expect(await readImageDataUrl(notePath, imageLinkFor(notePath, picked))).toBeNull();
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test('the store keeps its list across restarts and ignores a damaged file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'portalogia-picked-'));
    try {
      const file = join(dir, 'picked.json');
      new PickedImageStore(file).add(join(dir, 'a.png'));
      expect(new PickedImageStore(file).has(join(dir, 'a.png'))).toBe(true);
      expect(new PickedImageStore(file).has(join(dir, 'b.png'))).toBe(false);
      writeFileSync(file, '{not json');
      expect(new PickedImageStore(file).has(join(dir, 'a.png'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test.describe('image widths', () => {
  test('`![alt|300](path)` carries a width; other alt text is left whole', () => {
    expect(splitImageAlt('Lamp|300')).toEqual({ alt: 'Lamp', width: 300 });
    expect(splitImageAlt('|120')).toEqual({ alt: '', width: 120 });
    expect(splitImageAlt('a|b')).toEqual({ alt: 'a|b', width: null });
    expect(createMarkdownEngine().render('![Lamp|300](a.png)')).toContain('<img src="a.png" alt="Lamp" width="300">');
  });
});

test.describe('raw-text block tools', () => {
  test('headings replace whatever marker the line had', () => {
    const editor = fakeEditor('- item\n## old', 0, 10);
    setHeadingLines(editor.view, 3);
    expect(editor.text()).toBe('### item\n### old');
    setHeadingLines(editor.view, 0);
    expect(editor.text()).toBe('item\nold');
  });

  test('list buttons number the lines, and take the markers off again', () => {
    const editor = fakeEditor('one\ntwo', 0, 7);
    toggleListLines(editor.view, 'ordered');
    expect(editor.text()).toBe('1. one\n2. two');
    toggleListLines(editor.view, 'task');
    expect(editor.text()).toBe('- [ ] one\n- [ ] two');
    toggleListLines(editor.view, 'task');
    expect(editor.text()).toBe('one\ntwo');
  });

  test('a block goes on lines of its own, set off by blank lines', () => {
    const editor = fakeEditor('Text here.\nMore.', 3);
    insertBlockText(editor.view, '---');
    expect(editor.text()).toBe('Text here.\n\n---\n\nMore.');
  });
});
