// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-19

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { test, expect, findTabPage, openInActiveTab } from './fixtures';

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
    await expect(page.locator('style[data-northstar="pan-cursor"]')).toHaveCount(1);

    await drag(page, { x: 400, y: 300 }, { x: 300, y: 220 });
    await expect.poll(() => page.evaluate(() => [window.scrollX, window.scrollY])).toEqual([600, 580]);
  });

  test('in Pan mode a click on a link does not follow it', async ({ electronApp, window, server }) => {
    const page = await openInActiveTab(electronApp, window, server.url('/tall'));
    await panButton(window).click();
    await expect(page.locator('style[data-northstar="pan-cursor"]')).toHaveCount(1);
    await page.locator('#link').click();
    await page.waitForTimeout(300);
    expect(page.url()).toContain('/tall');
  });

  test('in Select mode a drag selects instead, and links work again', async ({ electronApp, window, server }) => {
    const page = await openInActiveTab(electronApp, window, server.url('/tall'));
    await panButton(window).click();
    await selectButton(window).click();
    await expect(page.locator('style[data-northstar="pan-cursor"]')).toHaveCount(0);
    await drag(page, { x: 400, y: 300 }, { x: 300, y: 220 });
    expect(await page.evaluate(() => [window.scrollX, window.scrollY])).toEqual([0, 0]);
    await page.locator('#link').click();
    await expect.poll(() => page.url()).toContain('/widgets');
  });

  test('Ctrl+1 and Ctrl+2 pick Pan and Select on a web page', async ({ electronApp, window, server }) => {
    const page = await openInActiveTab(electronApp, window, server.url('/tall'));
    await page.locator('body').click({ position: { x: 600, y: 600 } });
    await page.keyboard.press('Control+1');
    await expect(panButton(window)).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Control+2');
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
    await expect(page.locator('style[data-northstar="pan-cursor"]')).toHaveCount(0);

    await panButton(window).click();
    await expect(window.getByRole('button', { name: 'Turn on pen' })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('style[data-northstar="pan-cursor"]')).toHaveCount(1);
  });

  test('the modes are locked on the home page, which has nothing to pan', async ({ window }) => {
    await expect(panButton(window)).toBeDisabled();
    await expect(selectButton(window)).toBeDisabled();
  });
});

test.describe('pointer modes on a note', () => {
  let noteDir = '';

  test.beforeEach(() => {
    noteDir = mkdtempSync(join(tmpdir(), 'northstar-pan-note-'));
  });

  test.afterEach(() => {
    rmSync(noteDir, { recursive: true, force: true });
  });

  test('in Pan mode a drag scrolls the note; in Select mode it does not', async ({ window, electronApp }) => {
    const notePath = join(noteDir, 'long.md');
    writeFileSync(notePath, Array.from({ length: 400 }, (_, i) => `Line ${i + 1} of a long note.\n`).join('\n'));
    await window.getByRole('button', { name: 'Open Markdown notes' }).click();
    const tabId = await window.evaluate(async () => {
      const result = await window.northstar.getState();
      return result.ok ? result.data.activeTabId : null;
    });
    expect(tabId).not.toBeNull();
    await window.evaluate(([id, path]) => window.northstar.openMarkdownPath(id!, path), [tabId, notePath] as const);

    const note = await findTabPage(electronApp, 'markdown.html');
    const scroller = note.locator('.md-viewer__scroll');
    await expect(scroller).toContainText('Line 400');
    await expect(selectButton(window)).toHaveAttribute('aria-pressed', 'true');

    await panButton(window).click();
    await expect(note.locator('.md-viewer[data-pan]')).toHaveCount(1);
    const box = await scroller.boundingBox();
    const middle = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
    await drag(note, middle, { x: middle.x, y: middle.y - 150 });
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(150);

    await selectButton(window).click();
    await expect(note.locator('.md-viewer[data-pan]')).toHaveCount(0);
    await drag(note, middle, { x: middle.x, y: middle.y - 150 });
    expect(await scroller.evaluate((el) => el.scrollTop)).toBe(150);
  });

  test('the modes are locked on a note tab with no note open', async ({ window }) => {
    await window.getByRole('button', { name: 'Open Markdown notes' }).click();
    await expect(panButton(window)).toBeDisabled();
  });
});
