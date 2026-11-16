// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-12

import { test, expect, openInActiveTab, pressInChrome, pressInTab } from './fixtures';

test.describe('tool shortcuts', () => {
  test('a tool shortcut works from the chrome', async ({ electronApp, window, server }) => {
    await openInActiveTab(electronApp, window, server.url('/editor'));
    await pressInChrome(electronApp, 'Control+j');
    await expect(window.getByRole('button', { name: 'Turn off highlighter' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('with the keyboard in the page, the tools’ keys are the page’s and no tool turns on', async ({
    electronApp,
    window,
    server,
  }) => {
    const page = await openInActiveTab(electronApp, window, server.url('/editor'));
    await page.locator('body').click({ position: { x: 600, y: 300 } });
    for (const key of ['j', 'p', 'm', 'e', 'i']) {
      await pressInTab(electronApp, '/editor', `Control+${key}`);
    }
    await pressInTab(electronApp, '/editor', 'Alt+1');
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { seenKeys: string[] }).seenKeys))
      .toEqual(expect.arrayContaining(['Ctrl+j', 'Ctrl+p', 'Ctrl+m', 'Ctrl+e', 'Ctrl+i', '1']));
    for (const name of [
      'Turn on highlighter',
      'Turn on pen',
      'Turn on comments',
      'Turn on text box',
      'Turn on laser pointer',
    ]) {
      await expect(window.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
    }
    // Alt+1 is Pan, which the page keeps too.
    await expect(window.getByRole('button', { name: /^Select:/ })).toHaveAttribute('aria-pressed', 'true');
  });

  test('app shortcuts that are not tools still work with the keyboard in the page', async ({
    electronApp,
    window,
    server,
  }) => {
    const page = await openInActiveTab(electronApp, window, server.url('/editor'));
    await page.locator('body').click({ position: { x: 600, y: 300 } });
    await pressInTab(electronApp, '/editor', 'Control+l');
    await expect(window.locator('.sidebar--hidden')).toHaveCount(1);
  });

  test('there is no edit mode to switch: the page having the keyboard is what hands it the keys', async ({
    window,
  }) => {
    await expect(window.getByRole('button', { name: /edit mode/i })).toHaveCount(0);
  });
});
