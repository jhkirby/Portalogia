// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { test, expect, openInActiveTab, pressInTab } from './fixtures';

test.describe('edit mode', () => {
  test('its button sits just left of the laser pointer, with its shortcut in the tooltip', async ({ window }) => {
    const editMode = window.getByRole('button', { name: 'Turn on edit mode' });
    await expect(editMode).toBeVisible();
    await expect(editMode).toHaveAttribute('aria-pressed', 'false');
    await expect(editMode).toHaveAttribute('data-tooltip', /\(Ctrl\+Alt\+Shift\+E\)$/);
    const next = await editMode.evaluate((el) => el.nextElementSibling?.getAttribute('aria-label'));
    expect(next).toBe('Turn on laser pointer');
  });

  test('the button turns it on and off', async ({ window }) => {
    await window.getByRole('button', { name: 'Turn on edit mode' }).click();
    const off = window.getByRole('button', { name: 'Turn off edit mode' });
    await expect(off).toHaveAttribute('aria-pressed', 'true');
    await off.click();
    await expect(window.getByRole('button', { name: 'Turn on edit mode' })).toHaveAttribute('aria-pressed', 'false');
  });

  test('Ctrl+Alt+Shift+E turns it on and off from the page', async ({ electronApp, window, server }) => {
    const page = await openInActiveTab(electronApp, window, server.url('/editor'));
    await pressInTab(electronApp, '/editor', 'Control+Alt+Shift+E');
    await expect(window.getByRole('button', { name: 'Turn off edit mode' })).toBeVisible();
    await pressInTab(electronApp, '/editor', 'Control+Alt+Shift+E');
    await expect(window.getByRole('button', { name: 'Turn on edit mode' })).toBeVisible();
  });

  test('is kept per tab: another tab still has its tool shortcuts', async ({ electronApp, window, server }) => {
    await openInActiveTab(electronApp, window, server.url('/editor'));
    await window.getByRole('button', { name: 'Turn on edit mode' }).click();
    await window.evaluate(() => window.portalogia.createTab());
    await expect(window.getByRole('button', { name: 'Turn on edit mode' })).toHaveAttribute('aria-pressed', 'false');
  });

  test('a tool shortcut works as usual with edit mode off, and the page never sees the key', async ({
    electronApp,
    window,
    server,
  }) => {
    const page = await openInActiveTab(electronApp, window, server.url('/editor'));
    await page.locator('body').click({ position: { x: 600, y: 300 } });
    await pressInTab(electronApp, '/editor', 'Control+j');
    await expect(window.getByRole('button', { name: 'Turn off highlighter' })).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => (window as unknown as { seenKeys: string[] }).seenKeys)).not.toContain('Ctrl+j');
  });

  test('with edit mode on, the page gets the tools’ keys and no tool turns on', async ({ electronApp, window, server }) => {
    const page = await openInActiveTab(electronApp, window, server.url('/editor'));
    await window.getByRole('button', { name: 'Turn on edit mode' }).click();
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
    // Alt+1 is Pan, which edit mode also leaves to the page.
    await expect(window.getByRole('button', { name: /^Select:/ })).toHaveAttribute('aria-pressed', 'true');
  });

  test('app shortcuts that are not tools still work in edit mode', async ({ electronApp, window, server }) => {
    const page = await openInActiveTab(electronApp, window, server.url('/editor'));
    await window.getByRole('button', { name: 'Turn on edit mode' }).click();
    await page.locator('body').click({ position: { x: 600, y: 300 } });
    await pressInTab(electronApp, '/editor', 'Control+l');
    await expect(window.locator('.sidebar--hidden')).toHaveCount(1);
  });

  test('is not offered on a note, which has no web page to hand keys to', async ({ window }) => {
    await window.evaluate(() => window.portalogia.createMarkdownTab());
    await expect(window.getByRole('button', { name: /edit mode/ })).toHaveCount(0);
  });
});
