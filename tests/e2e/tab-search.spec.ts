// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-15

import { test, expect } from './fixtures';

test.describe('tab search', () => {
  test('opens via the search button and closes on Escape', async ({ window }) => {
    await window.getByRole('button', { name: 'Search tabs' }).click();

    const dialog = window.getByRole('dialog', { name: 'Search tabs' });
    await expect(dialog).toBeVisible();

    await window.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('filters results by title as you type', async ({ window, server }) => {
    await window.getByRole('button', { name: 'New tab', exact: true }).click();
    const addressBar = window.getByLabel('Search the internet...');
    await addressBar.fill(server.url('/widgets'));
    await addressBar.press('Enter');
    await expect(
      window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab').filter({ hasText: 'localhost' }),
    ).toHaveCount(1);

    await window.getByRole('button', { name: 'Search tabs' }).click();
    const results = window.getByRole('dialog', { name: 'Search tabs' }).getByRole('listitem');
    await expect(results).toHaveCount(2);

    const searchInput = window.getByRole('textbox', { name: 'Search tabs' });
    await searchInput.fill('widgets');
    await expect(results).toHaveCount(1);
    await expect(results.first()).toContainText('Widgets Catalog');

    await searchInput.fill('gadgets');
    await expect(window.getByText('No matching tabs')).toBeVisible();
  });

  test('splitting from a search result shows the split indicator; exiting removes it', async ({
    window,
    server,
  }) => {
    await window.getByRole('button', { name: 'New tab', exact: true }).click();
    const addressBar = window.getByLabel('Search the internet...');
    await addressBar.fill(server.url('/widgets'));
    await addressBar.press('Enter');
    const tabs = window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab');
    await expect(tabs.filter({ hasText: 'localhost' })).toHaveCount(1);

    // Make the home tab active again so it's the split's primary pane.
    await tabs.first().click();

    await window.getByRole('button', { name: 'Search tabs' }).click();
    await window.getByRole('button', { name: 'Split' }).click();

    const indicator = window.locator('.split-indicator');
    await expect(indicator).toContainText('Widgets Catalog');

    await window.getByRole('button', { name: 'Exit split view' }).click();
    await expect(indicator).toHaveCount(0);
  });
});
