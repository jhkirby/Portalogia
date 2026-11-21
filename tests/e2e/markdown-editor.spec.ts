// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-21

import { copyFileSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, openNote, pressInTab } from './fixtures';

const NOTE = ['Intro *paragraph*   with   spacing.', '', '```js', 'let x = 1;', '```', '', '* star bullet', '', 'End.', ''].join('\n');

test.describe('the formatted editor', () => {
  let noteDir = '';
  let notePath = '';

  test.beforeEach(() => {
    noteDir = mkdtempSync(join(tmpdir(), 'portalogia-edit-note-'));
    notePath = join(noteDir, 'note.md');
    writeFileSync(notePath, NOTE);
  });

  test.afterEach(() => {
    rmSync(noteDir, { recursive: true, force: true });
  });

  test('opening a note for editing and leaving it changes nothing', async ({ window, electronApp }) => {
    const before = statSync(notePath).mtimeMs;
    const note = await openNote(electronApp, window, notePath);
    await window.getByRole('button', { name: 'Switch to editing' }).click();
    await expect(note.locator('.fm-editor')).toBeVisible();
    await window.getByRole('button', { name: 'Switch to viewing' }).click();
    await expect(note.locator('.md-reader')).toContainText('End.');
    expect(readFileSync(notePath, 'utf8')).toBe(NOTE);
    expect(statSync(notePath).mtimeMs).toBe(before);
  });

  test('draws elements without their Markdown, keeps typing literal, and makes elements from shortcuts', async ({
    window,
    electronApp,
  }) => {
    const note = await openNote(electronApp, window, notePath);
    await window.getByRole('button', { name: 'Switch to editing' }).click();
    const editor = note.locator('.fm-editor');
    await expect(editor).toBeVisible();

    // A code block is a box with its language, and no fences; no line is highlighted.
    await expect(editor).not.toContainText('```');
    await expect(note.locator('.fm-code__language')).toHaveValue('js');
    await expect(note.locator('.cm-activeLine')).toHaveCount(0);
    await expect(editor.locator('ul > li')).toHaveText('star bullet');

    // Markdown typed into the text stays text.
    await editor.locator('p', { hasText: 'End.' }).click();
    await note.keyboard.press('End');
    await note.keyboard.type(' **hi** [[x]] $y$');
    await expect(editor.locator('p', { hasText: 'End.' })).toHaveText('End. **hi** [[x]] $y$');
    await expect(editor.locator('strong')).toHaveCount(0);
    await expect.poll(() => readFileSync(notePath, 'utf8')).toContain('End. \\*\\*hi\\*\\* \\[\\[x\\]\\] \\$y\\$');

    // Ctrl+Shift+8 makes a bulleted list; Ctrl+Alt+2 a heading, with its size bar.
    await note.keyboard.press('Enter');
    await note.keyboard.type('Bullet item');
    await pressInTab(electronApp, 'markdown.html', 'Control+Shift+8');
    await expect.poll(() => readFileSync(notePath, 'utf8')).toContain('\n- Bullet item');
    await note.keyboard.press('Enter');
    await note.keyboard.press('Enter');
    await note.keyboard.type('A title');
    await pressInTab(electronApp, 'markdown.html', 'Control+Alt+2');
    await expect(editor.locator('h2')).toHaveText('A title');
    await expect(note.getByRole('toolbar', { name: 'Heading size' })).toBeVisible();
    await expect.poll(() => readFileSync(notePath, 'utf8')).toContain('\n## A title');

    // The blocks that weren't touched are exactly as they were written.
    const written = readFileSync(notePath, 'utf8');
    expect(written.startsWith('Intro *paragraph*   with   spacing.\n\n```js\nlet x = 1;\n```\n\n* star bullet\n\n')).toBe(true);
  });

  test('tables, callouts, formulas and pictures are edited through their own controls', async ({ window, electronApp }) => {
    writeFileSync(notePath, '| A | B |\n| --- | --- |\n| 1 | 2 |\n\n$$\nx^2\n$$\n\nEnd.\n');
    // A picture outside the note's folder, picked in the dialog.
    const picDir = mkdtempSync(join(tmpdir(), 'portalogia-pic-'));
    const picPath = join(picDir, 'my lamp.png');
    copyFileSync(join(process.cwd(), 'resources', 'icon.png'), picPath);
    try {
      const note = await openNote(electronApp, window, notePath);
      await window.getByRole('button', { name: 'Switch to editing' }).click();
      const editor = note.locator('.fm-editor');
      await expect(editor).toBeVisible();

      // The caret in a table brings its bar; a row is added below.
      await editor.locator('td', { hasText: '1' }).click();
      const tableBar = note.getByRole('toolbar', { name: 'Table' });
      await expect(tableBar).toBeVisible();
      await tableBar.getByRole('button', { name: 'Row below' }).click();
      await expect(editor.locator('tr')).toHaveCount(3);
      await expect.poll(() => readFileSync(notePath, 'utf8')).toContain('| 1 | 2 |\n|   |   |');

      // A click on a formula opens its TeX; what's typed is written back.
      await editor.locator('.fm-atom--math_block').click();
      const tex = note.locator('.fm-source__input');
      await expect(tex).toBeFocused();
      await tex.fill('y^3');
      await expect.poll(() => readFileSync(notePath, 'utf8')).toContain('$$\ny^3\n$$');
      await note.keyboard.press('Escape');

      // The callout shortcut opens the type picker; the pick wraps the caret's paragraph.
      await editor.locator('p', { hasText: 'End.' }).click();
      await pressInTab(electronApp, 'markdown.html', 'Control+Alt+C');
      await note.getByRole('menuitem', { name: 'Warning' }).click();
      await expect(editor.locator('.md-callout--orange')).toContainText('End.');
      await expect.poll(() => readFileSync(notePath, 'utf8')).toContain('> [!warning]\n> End.');

      // The picture shortcut asks for a file and links it relative to the note.
      await electronApp.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog;
      }, picPath);
      await editor.locator('.md-callout__body p').click();
      await note.keyboard.press('End');
      await pressInTab(electronApp, 'markdown.html', 'Control+Alt+I');
      await expect(editor.locator('.fm-image img[src^="data:image/png"]')).toHaveCount(1);
      await expect.poll(() => readFileSync(notePath, 'utf8')).toMatch(/!\[\]\(\.\.\/portalogia-pic-\w+\/my%20lamp\.png\)/);
    } finally {
      rmSync(picDir, { recursive: true, force: true });
    }
  });
});
