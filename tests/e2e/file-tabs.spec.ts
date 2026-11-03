// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { test, expect, findTabPage, openNote } from './fixtures';

let dir = '';

test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'portalogia-file-tabs-'));
});

test.afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test.describe('a PDF tab', () => {
  test('Back and Forward step through jumps made with the page box', async ({ electronApp, window }) => {
    const document = await PDFDocument.create();
    for (let page = 0; page < 6; page += 1) {
      document.addPage([600, 800]);
    }
    const pdfPath = join(dir, 'six.pdf');
    writeFileSync(pdfPath, await document.save());
    await electronApp.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog;
    }, pdfPath);

    await window.evaluate(() => window.portalogia.createPdfTab());
    const toolbar = window.locator('.pdf-toolbar');
    await toolbar.getByRole('button', { name: /^Open/ }).first().click();
    // The page box is in the PDF page's own stat bar.
    const pdf = await findTabPage(electronApp, 'pdf.html');
    await expect(pdf.locator('.pdf-status__total')).toHaveText('/ 6');

    const back = toolbar.getByRole('button', { name: 'Back' });
    const forward = toolbar.getByRole('button', { name: 'Forward' });
    const pageBox = pdf.getByLabel('Current page');
    await expect(back).toBeDisabled();
    await expect(forward).toBeDisabled();

    await pageBox.fill('5');
    await pageBox.press('Enter');
    await expect(pageBox).toHaveValue('5');
    await expect(back).toBeEnabled();

    await back.click();
    await expect(pageBox).toHaveValue('1');
    await expect(back).toBeDisabled();
    await expect(forward).toBeEnabled();

    await forward.click();
    await expect(pageBox).toHaveValue('5');
    await expect(forward).toBeDisabled();
  });
});

test.describe('the bookmark popup', () => {
  test('a note starts with its file name less the extension, and Save sits alone in the middle', async ({
    electronApp,
    window,
  }) => {
    const notePath = join(dir, 'iot.md');
    writeFileSync(notePath, '# IoT\n');
    await openNote(electronApp, window, notePath);
    await window.getByRole('button', { name: 'Bookmark this note' }).click();

    const popup = window.locator('.bookmark-popup');
    await expect(popup).toBeVisible();
    await expect(popup.getByRole('textbox').nth(1)).toHaveValue('iot');
    // The × is the only way out (its accessible name is "Cancel"); the separate Cancel button is gone.
    await expect(popup.locator('.bookmark-popup__cancel')).toHaveCount(0);
    const actions = popup.locator('.bookmark-popup__actions');
    expect(await actions.evaluate((el) => getComputedStyle(el).justifyContent)).toBe('center');
  });

  test('a box not being typed in lightens its border on hover, like the address bar', async ({ electronApp, window }) => {
    const notePath = join(dir, 'iot.md');
    writeFileSync(notePath, '# IoT\n');
    await openNote(electronApp, window, notePath);
    await window.getByRole('button', { name: 'Bookmark this note' }).click();

    // The name box has the caret; the path box above it doesn't.
    const pathBox = window.locator('.bookmark-popup').getByRole('textbox').first();
    const border = (): Promise<string> => pathBox.evaluate((el) => getComputedStyle(el).borderTopColor);
    await window.mouse.move(5, 5);
    const resting = await border();
    await pathBox.hover();
    await expect.poll(border).not.toBe(resting);
  });

  test('closing plays its way out before the popup goes', async ({ electronApp, window }) => {
    const notePath = join(dir, 'iot.md');
    writeFileSync(notePath, '# IoT\n');
    await openNote(electronApp, window, notePath);
    await window.getByRole('button', { name: 'Bookmark this note' }).click();
    const popup = window.locator('.bookmark-popup');
    await expect(popup).toBeVisible();

    await popup.getByRole('button', { name: 'Cancel' }).click();
    // Still there for the closing motion, marked as leaving…
    await expect(window.locator('.popup-transition[data-closing]')).toHaveCount(1);
    // …then gone.
    await expect(popup).toHaveCount(0);
  });
});
