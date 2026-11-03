// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { test, expect, findTabPage, openInActiveTab, openNote } from './fixtures';

let dir = '';

test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'portalogia-stat-bars-'));
});

test.afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test.describe('the web page stat bar', () => {
  test("counts the page, follows the pointer and the selection, and hides in Focus Mode", async ({
    electronApp,
    window,
    server,
  }) => {
    const page = await openInActiveTab(electronApp, window, server.url('/controls'));
    const bar = window.locator('.web-status');
    await expect(bar).toContainText('1 link');
    await expect(bar).toContainText('0 images');
    await expect(bar).toContainText(/\d+ elements/);

    await page.locator('#button').hover();
    await expect(bar).toContainText('Hovering: button#button');

    await page.locator('#link').selectText();
    await expect(bar.locator('.web-status__selection')).toContainText('2 words');
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await expect(bar.locator('.web-status__selection')).toHaveCount(0);

    await window.getByRole('button', { name: 'Enter Focus Mode' }).click();
    await expect(bar).toHaveCount(0);
  });

  test('the address bar shows the load as a line and a percentage, held a second at 100%, then gone', async ({
    electronApp,
    window,
    server,
  }) => {
    await openInActiveTab(electronApp, window, server.url('/widgets'));
    const percent = window.getByRole('progressbar', { name: 'Page loading' });
    await expect(percent).toHaveText('100%');
    await expect(window.locator('.address-bar__progress')).toHaveCount(1);
    await expect(percent).toHaveCount(0, { timeout: 3000 });
    await expect(window.locator('.address-bar__progress')).toHaveCount(0);
  });
});

test.describe('the note stat bar', () => {
  test('shows no byte count, shows the selection while there is one, and hides in Focus Mode', async ({
    electronApp,
    window,
  }) => {
    const notePath = join(dir, 'note.md');
    writeFileSync(notePath, 'One two three.\nFour five.\n');
    const note = await openNote(electronApp, window, notePath);
    const bar = note.locator('.md-status');
    await expect(bar).toContainText('characters');
    await expect(bar).not.toContainText('bytes');
    await expect(bar.locator('.md-status__selection')).toHaveCount(0);

    await window.getByRole('button', { name: 'Switch to editing' }).click();
    await note.locator('.cm-content').click();
    await note.keyboard.press('Control+a');
    const selection = bar.locator('.md-status__selection');
    await expect(selection).toContainText('2 lines');
    await expect(selection).toContainText('5 words');
    await note.keyboard.press('ArrowRight');
    await expect(selection).toHaveCount(0);

    await window.getByRole('button', { name: 'Enter Focus Mode' }).click();
    await expect(bar).toHaveCount(0);
    await window.getByRole('button', { name: 'Exit Focus Mode' }).click();
    await expect(bar).toHaveCount(1);
  });
});

test.describe('the PDF stat bar', () => {
  test("starts with the page box, counts the document and the file, and hides in Focus Mode", async ({
    electronApp,
    window,
  }) => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    for (const words of ['alpha beta gamma', 'delta epsilon']) {
      document.addPage([600, 800]).drawText(words, { x: 50, y: 700, size: 24, font });
    }
    const bytes = await document.save();
    const pdfPath = join(dir, 'words.pdf');
    writeFileSync(pdfPath, bytes);
    await electronApp.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog;
    }, pdfPath);
    await window.evaluate(() => window.portalogia.createPdfTab());
    await window.locator('.pdf-toolbar').getByRole('button', { name: /^Open/ }).first().click();

    const pdf = await findTabPage(electronApp, 'pdf.html');
    const bar = pdf.locator('.pdf-status');
    await expect(bar.locator('.pdf-status__item').first()).toContainText('/ 2');
    await expect(bar).toContainText('5 words');
    await expect(bar).toContainText('0 links');
    await expect(bar).toContainText(`${bytes.length.toLocaleString()} bytes`);
    // The toolbar has no page box of its own any more.
    await expect(window.locator('.pdf-toolbar').getByLabel('Current page')).toHaveCount(0);

    await window.getByRole('button', { name: 'Enter Focus Mode' }).click();
    await expect(bar).toHaveCount(0);
  });
});
