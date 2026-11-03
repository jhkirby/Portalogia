// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { test, expect, openInActiveTab, openNote, pressInTab } from './fixtures';

/**
 * Presses at one point of a page, drags to another in small steps, and lets go — away from every edge, so the pan
 * never wraps the real pointer.
 */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

const panButton = (window: Page) => window.getByRole('button', { name: /^Pan:/ });
const selectButton = (window: Page) => window.getByRole('button', { name: /^Select:/ });

test.describe('pointer modes on a web page', () => {
  test('a web page starts in Select mode, with both modes on the toolbar', async ({ electronApp, window, server }) => {
    await openInActiveTab(electronApp, window, server.url('/tall'));
    await expect(selectButton(window)).toHaveAttribute('aria-pressed', 'true');
    await expect(panButton(window)).toHaveAttribute('aria-pressed', 'false');
  });

  test('in Pan mode a drag moves the page the way the hand moves', async ({ electronApp, window, server }) => {
    const page = await openInActiveTab(electronApp, window, server.url('/tall'));
    await page.evaluate(() => window.scrollTo(500, 500));
    await panButton(window).click();
    await expect(panButton(window)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('style[data-portalogia="pan-cursor"]')).toHaveCount(1);

    await drag(page, { x: 400, y: 300 }, { x: 300, y: 220 });
    // About 100px across and 80px down, the way the hand went (a short glide after letting go may add a few pixels).
    await expect
      .poll(async () => {
        const [x, y] = await page.evaluate(() => [window.scrollX, window.scrollY]);
        return Math.abs(x! - 600) <= 8 && Math.abs(y! - 580) <= 8;
      })
      .toBe(true);
  });

  test('in Pan mode a click on a link does not follow it', async ({ electronApp, window, server }) => {
    const page = await openInActiveTab(electronApp, window, server.url('/tall'));
    await panButton(window).click();
    await expect(page.locator('style[data-portalogia="pan-cursor"]')).toHaveCount(1);
    await page.locator('#link').click();
    await page.waitForTimeout(300);
    expect(page.url()).toContain('/tall');
  });

  test('in Select mode a drag selects instead, and links work again', async ({ electronApp, window, server }) => {
    const page = await openInActiveTab(electronApp, window, server.url('/tall'));
    await panButton(window).click();
    await selectButton(window).click();
    await expect(page.locator('style[data-portalogia="pan-cursor"]')).toHaveCount(0);
    await drag(page, { x: 400, y: 300 }, { x: 300, y: 220 });
    expect(await page.evaluate(() => [window.scrollX, window.scrollY])).toEqual([0, 0]);
    await page.locator('#link').click();
    await expect.poll(() => page.url()).toContain('/widgets');
  });

  test('Alt+1 and Alt+2 pick Pan and Select on a web page', async ({ electronApp, window, server }) => {
    const page = await openInActiveTab(electronApp, window, server.url('/tall'));
    await page.locator('body').click({ position: { x: 600, y: 600 } });
    await pressInTab(electronApp, '/tall', 'Alt+1');
    await expect(panButton(window)).toHaveAttribute('aria-pressed', 'true');
    await pressInTab(electronApp, '/tall', 'Alt+2');
    await expect(selectButton(window)).toHaveAttribute('aria-pressed', 'true');
  });

  test('a tool takes the pointer from the hand, and picking a mode turns the tool off', async ({
    electronApp,
    window,
    server,
  }) => {
    const page = await openInActiveTab(electronApp, window, server.url('/tall'));
    await panButton(window).click();
    await window.getByRole('button', { name: 'Turn on pen' }).click();
    // Neither mode is shown pressed while a tool has the pointer, and the hand is gone from the page.
    await expect(panButton(window)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('style[data-portalogia="pan-cursor"]')).toHaveCount(0);

    await panButton(window).click();
    await expect(window.getByRole('button', { name: 'Turn on pen' })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('style[data-portalogia="pan-cursor"]')).toHaveCount(1);
  });

  test('in Pan mode nothing on the page reacts to a click, not even inside frames; Select mode gives it all back', async ({
    electronApp,
    window,
    server,
  }) => {
    const page = await openInActiveTab(electronApp, window, server.url('/controls'));
    await expect(page.frameLocator('#cross').locator('#button')).toBeVisible();
    const clickOn = async (selector: string, frame?: string): Promise<void> => {
      const target = frame ? page.frameLocator(frame).locator(selector) : page.locator(selector);
      const box = (await target.boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    };
    const clickEverything = async (): Promise<void> => {
      for (const [selector, frame] of [
        ['#field'],
        ['#button'],
        ['#button', '#same'],
        ['#field', '#same'],
        ['#button', '#cross'],
        ['#field', '#cross'],
      ] as const) {
        await clickOn(selector, frame);
      }
    };
    const hits = (): Promise<string[]> => page.evaluate(() => (window as unknown as { hits: string[] }).hits);

    await panButton(window).click();
    await expect(page.locator('style[data-portalogia="pan-cursor"]')).toHaveCount(1);
    await clickEverything();
    await clickOn('#link');
    await page.waitForTimeout(300);
    expect(await hits()).toEqual([]);
    expect(page.url()).toContain('/controls');

    await selectButton(window).click();
    await expect(page.locator('style[data-portalogia="pan-cursor"]')).toHaveCount(0);
    await clickEverything();
    await expect
      .poll(hits)
      .toEqual(expect.arrayContaining(['field:focus', 'button:click', 'same:click', 'same:focus', 'cross:click', 'cross:focus']));
  });

  test('the modes are locked on the home page, which has nothing to pan', async ({ window }) => {
    await expect(panButton(window)).toBeDisabled();
    await expect(selectButton(window)).toBeDisabled();
  });
});

test.describe('pointer modes on a note', () => {
  let noteDir = '';

  test.beforeEach(() => {
    noteDir = mkdtempSync(join(tmpdir(), 'portalogia-pan-note-'));
  });

  test.afterEach(() => {
    rmSync(noteDir, { recursive: true, force: true });
  });

  test('in Pan mode a drag scrolls the note; in Select mode it does not', async ({ window, electronApp }) => {
    const notePath = join(noteDir, 'long.md');
    writeFileSync(notePath, Array.from({ length: 400 }, (_, i) => `Line ${i + 1} of a long note.\n`).join('\n'));
    const note = await openNote(electronApp, window, notePath);
    const scroller = note.locator('.md-viewer__scroll');
    await expect(scroller).toContainText('Line 400');
    await expect(selectButton(window)).toHaveAttribute('aria-pressed', 'true');

    await panButton(window).click();
    await expect(note.locator('.md-viewer[data-pan]')).toHaveCount(1);
    const box = await scroller.boundingBox();
    const middle = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
    await drag(note, middle, { x: middle.x, y: middle.y - 150 });
    // About 150px, the way the hand went (a short glide after letting go may add a few pixels).
    await expect.poll(async () => Math.abs((await scroller.evaluate((el) => el.scrollTop)) - 150) <= 8).toBe(true);
    const panned = await scroller.evaluate((el) => el.scrollTop);

    await selectButton(window).click();
    await expect(note.locator('.md-viewer[data-pan]')).toHaveCount(0);
    await drag(note, middle, { x: middle.x, y: middle.y - 150 });
    // Not panned another 150px. Selecting text may nudge the scroll by a pixel or two to keep the selection in view.
    expect(Math.abs((await scroller.evaluate((el) => el.scrollTop)) - panned)).toBeLessThan(10);
  });

  test('the modes are locked on a note tab with no note open', async ({ window }) => {
    await window.evaluate(() => window.portalogia.createMarkdownTab());
    await expect(panButton(window)).toBeDisabled();
  });
});
