// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { test, expect, pressInTab, pressInChrome } from './fixtures';

test.describe('tabs', () => {
  test('the new-tab button opens another tab and focuses the address bar', async ({ window }) => {
    const tabs = window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab');
    await expect(tabs).toHaveCount(1);

    await window.evaluate(() => window.portalogia.createTab());

    await expect(tabs).toHaveCount(2);
    await expect(window.getByLabel('Search the internet...')).toBeFocused();
  });

  test('closing a tab removes it and leaves the other active', async ({ window }) => {
    const tabs = window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab');
    await window.evaluate(() => window.portalogia.createTab());
    await expect(tabs).toHaveCount(2);

    await tabs.last().getByRole('button', { name: /Close/ }).click();

    await expect(tabs).toHaveCount(1);
  });

  test('closing the only tab in a workspace replaces it with a fresh home tab', async ({ window }) => {
    const tabs = window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab');
    await expect(tabs).toHaveCount(1);

    await tabs.first().getByRole('button', { name: /Close/ }).click();

    // Never zero tabs — TabManager.closeTab opens a fresh home tab instead.
    await expect(tabs).toHaveCount(1);
    await expect(window.getByLabel('Search the internet...')).toHaveValue('');
  });

  test('Ctrl+W closes only the tab, never the window, even with one tab left', async ({
    electronApp,
    window,
  }) => {
    const tabs = window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab');
    await expect(tabs).toHaveCount(1);
    const pageCountBefore = electronApp.windows().length;

    await window.keyboard.press('Control+w');

    await expect(tabs).toHaveCount(1);
    await expect(window.getByLabel('Search the internet...')).toHaveValue('');
    expect(window.isClosed()).toBe(false);
    expect(electronApp.windows()).toHaveLength(pageCountBefore);
  });

  test('Ctrl+W with focus on the sidebar (not tab content) never closes the window', async ({
    electronApp,
    window,
  }) => {
    // Regression test: focus here reaches the OS-level menu accelerator
    // directly, unlike tab content where TabManager's `before-input-event`
    // handler consumes the key first — that's exactly the path that used
    // to collide with the built-in `windowMenu` role's Close item.
    const tabs = window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab');
    await expect(tabs).toHaveCount(1);
    const pageCountBefore = electronApp.windows().length;

    await window.getByRole('tablist', { name: 'Workspaces' }).getByRole('tab').first().click();
    await window.keyboard.press('Control+w');

    await expect(tabs).toHaveCount(1);
    expect(window.isClosed()).toBe(false);
    expect(electronApp.windows()).toHaveLength(pageCountBefore);
  });

  test('navigating updates the tab title, the address bar, and back/forward state', async ({
    window,
    server,
  }) => {
    const addressBar = window.getByLabel('Search the internet...');
    await addressBar.fill(server.url('/widgets'));
    await addressBar.press('Enter');

    const tabs = window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab');
    // The tab shows the site's domain (like the address bar's bubble), not the page title.
    await expect(tabs.first()).toContainText('localhost');
    await expect(addressBar).toHaveValue(server.url('/widgets'));
    await expect(window.getByRole('button', { name: 'Back' })).toBeEnabled();

    await window.getByRole('button', { name: 'Home' }).click();
    await expect(addressBar).toHaveValue('');
  });
});

test.describe('jumping to a tab by number', () => {
  test('F1 to F7 pick that tab, from a page or from the chrome; a key past the last tab does nothing', async ({
    electronApp,
    window,
  }) => {
    const tabs = window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab');
    for (let count = 2; count <= 3; count += 1) {
      await window.evaluate(() => window.portalogia.createTab());
      await expect(tabs).toHaveCount(count);
    }
    const selected = (): Promise<number> =>
      tabs.evaluateAll((all) => all.findIndex((tab) => tab.getAttribute('aria-selected') === 'true'));
    await expect.poll(selected).toBe(2);

    // From a tab's own page (every tab here is the home page).
    await pressInTab(electronApp, 'portalogia://home', 'F1');
    await expect.poll(selected).toBe(0);

    // From the chrome.
    await pressInChrome(electronApp, 'F2');
    await expect.poll(selected).toBe(1);

    await pressInChrome(electronApp, 'F7');
    await window.waitForTimeout(300);
    expect(await selected()).toBe(1);
  });
});
