// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-19

import type { Page } from 'playwright';
import { test, expect, openInActiveTab } from './fixtures';

/** Which tab (by position) the chrome shows as selected; the editor page is the second, at 1. */
async function selectedTabIndex(window: Page): Promise<number> {
  return window
    .getByRole('tablist', { name: 'Open tabs' })
    .getByRole('tab')
    .evaluateAll((tabs) => tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true'));
}

test.describe('Ctrl+Left/Right in a web page text box', () => {
  // Two tabs, the editor page active and last, so a tab switch would be plain to see.
  test.beforeEach(async ({ window }) => {
    await window.getByRole('button', { name: 'New tab', exact: true }).click();
    await expect(window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab')).toHaveCount(2);
  });

  test('in a plain text box, it moves the caret instead of switching tabs', async ({ electronApp, window, server }) => {
    const page = await openInActiveTab(electronApp, window, server.url('/editor'));
    await expect.poll(() => selectedTabIndex(window)).toBe(1);
    await page.locator('#box').click();
    await page.keyboard.press('Control+ArrowLeft');
    await expect.poll(() => selectedTabIndex(window)).toBe(1);
  });

  test('in an editor inside a frame (as Google Docs has), it moves the caret instead of switching tabs', async ({
    electronApp,
    window,
    server,
  }) => {
    const page = await openInActiveTab(electronApp, window, server.url('/editor'));
    await page.frameLocator('#frame').locator('body').click();
    await page.keyboard.press('Control+ArrowLeft');
    await page.waitForTimeout(300);
    expect(await selectedTabIndex(window)).toBe(1);
    // The keys reached the frame's editor, which moved its caret: typing lands at the start of a word.
    await page.keyboard.type('X');
    await expect(page.frameLocator('#frame').locator('body')).toContainText(/(^|\s)X\w*/);
  });

  test('Escape takes the caret out of the frame’s editor, and Ctrl+Left switches tabs again', async ({
    electronApp,
    window,
    server,
  }) => {
    const page = await openInActiveTab(electronApp, window, server.url('/editor'));
    await page.frameLocator('#frame').locator('body').click();
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).not.toBe('IFRAME');
    await page.keyboard.press('Control+ArrowLeft');
    await expect.poll(() => selectedTabIndex(window)).toBe(0);
  });

  test('Escape in a plain text box leaves it too', async ({ electronApp, window, server }) => {
    const page = await openInActiveTab(electronApp, window, server.url('/editor'));
    await page.locator('#box').click();
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => document.activeElement?.id ?? '')).not.toBe('box');
    await page.keyboard.press('Control+ArrowLeft');
    await expect.poll(() => selectedTabIndex(window)).toBe(0);
  });

  test('a frame’s editor counts as rich text: Ctrl+I is italic for the page, not the laser pointer', async ({
    electronApp,
    window,
    server,
  }) => {
    const page = await openInActiveTab(electronApp, window, server.url('/editor'));
    await page.frameLocator('#frame').locator('body').click();
    await page.keyboard.press('Control+i');
    await page.waitForTimeout(300);
    await expect(window.getByRole('button', { name: 'Turn on laser pointer' })).toHaveAttribute('aria-pressed', 'false');
  });
});
