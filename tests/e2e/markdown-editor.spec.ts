// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, openNote } from './fixtures';

const NOTE = [
  'Intro paragraph.',
  '',
  '- First bullet',
  '  - Nested bullet',
  '    - Deeper bullet',
  '- Second bullet',
  '',
  'Closing paragraph.',
].join('\n');

test.describe('editing a note', () => {
  let noteDir = '';

  test.beforeEach(() => {
    noteDir = mkdtempSync(join(tmpdir(), 'portalogia-edit-note-'));
  });

  test.afterEach(() => {
    rmSync(noteDir, { recursive: true, force: true });
  });

  test('Down and Up move exactly one line, even into and out of a drawn list', async ({ window, electronApp }) => {
    const notePath = join(noteDir, 'list.md');
    writeFileSync(notePath, NOTE);
    const note = await openNote(electronApp, window, notePath);
    await expect(note.locator('.md-viewer__scroll')).toContainText('Closing paragraph.');

    await window.getByRole('button', { name: 'Switch to editing' }).click();
    const editor = note.locator('.cm-content');
    await expect(editor).toBeVisible();
    await editor.click();
    await note.keyboard.press('Control+Home');

    // The caret's line, read from the active-line highlight (its source line, once its block turns back into text),
    // compared by its words: the live preview draws a bullet's `-` as a dot.
    const lines = NOTE.split('\n');
    const words = (text: string): string => text.replace(/^\s*-\s*/, '').replace(/[•◦▪]/g, '').trim();
    const expectCaretOn = async (index: number): Promise<void> => {
      await expect
        .poll(async () => words(await note.locator('.cm-activeLine').first().innerText()), { message: `caret on line ${index + 1}` })
        .toBe(words(lines[index]!));
    };
    await expectCaretOn(0);
    for (let index = 1; index < lines.length; index += 1) {
      await note.keyboard.press('ArrowDown');
      await expectCaretOn(index);
    }
    for (let index = lines.length - 2; index >= 0; index -= 1) {
      await note.keyboard.press('ArrowUp');
      await expectCaretOn(index);
    }
  });
});
