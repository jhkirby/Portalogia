// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { test, expect } from './fixtures';

test.describe('tab search', () => {
  test('opens via the search button and closes on Escape', async ({ window }) => {
    await window.getByRole('button', { name: 'Search tabs' }).click();

    const dialog = window.getByRole('dialog', { name: 'Search tabs' });
    await expect(dialog).toBeVisible();
    // It takes the keyboard straight away, so typing needs no extra click.
    await expect(window.getByRole('combobox', { name: 'Search tabs' })).toBeFocused();

    await window.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('is a modal over the page: blurred still of the tab behind it', async ({ window }) => {
    await window.getByRole('button', { name: 'Search tabs' }).click();
    await expect(window.locator('.bookmark-popup__preview')).toHaveAttribute('src', /^data:image/);
  });

  test('lists every tab with its workspace, and filters as you type', async ({ window, server }) => {
    await window.evaluate(() => window.portalogia.createTab());
    const addressBar = window.getByLabel('Search the internet...');
    await addressBar.fill(server.url('/widgets'));
    await addressBar.press('Enter');
    await expect(
      window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab').filter({ hasText: 'localhost' }),
    ).toHaveCount(1);

    await window.getByRole('button', { name: 'Search tabs' }).click();
    const results = window.getByRole('dialog', { name: 'Search tabs' }).getByRole('option');
    await expect(results).toHaveCount(2);
    await expect(results.first()).toContainText('Home');

    const searchInput = window.getByRole('combobox', { name: 'Search tabs' });
    await searchInput.fill('widgets');
    await expect(results).toHaveCount(1);
    await expect(results.first()).toContainText('Widgets Catalog');

    await searchInput.fill('gadgets');
    await expect(window.getByText('No matching tabs')).toBeVisible();
  });

  test('Up/Down move the highlight and Enter jumps to that tab', async ({ window, server }) => {
    await window.evaluate(() => window.portalogia.createTab());
    const addressBar = window.getByLabel('Search the internet...');
    await addressBar.fill(server.url('/widgets'));
    await addressBar.press('Enter');
    const tabs = window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab');
    await expect(tabs.filter({ hasText: 'localhost' })).toHaveCount(1);
    // Make the first tab active, so jumping to the other is a real change.
    await tabs.first().click();
    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');

    await window.getByRole('button', { name: 'Search tabs' }).click();
    const results = window.getByRole('dialog', { name: 'Search tabs' }).getByRole('option');
    await expect(results.first()).toHaveAttribute('aria-selected', 'true');

    await window.keyboard.press('ArrowDown');
    await expect(results.nth(1)).toHaveAttribute('aria-selected', 'true');
    await window.keyboard.press('ArrowUp');
    await expect(results.first()).toHaveAttribute('aria-selected', 'true');
    await window.keyboard.press('ArrowDown');
    await window.keyboard.press('Enter');

    await expect(window.getByRole('dialog', { name: 'Search tabs' })).toBeHidden();
    await expect(tabs.filter({ hasText: 'localhost' })).toHaveAttribute('aria-selected', 'true');
  });

  test('clicking a row jumps to that tab', async ({ window, server }) => {
    await window.evaluate(() => window.portalogia.createTab());
    const addressBar = window.getByLabel('Search the internet...');
    await addressBar.fill(server.url('/widgets'));
    await addressBar.press('Enter');
    const tabs = window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab');
    await expect(tabs.filter({ hasText: 'localhost' })).toHaveCount(1);
    await tabs.first().click();

    await window.getByRole('button', { name: 'Search tabs' }).click();
    await window.getByRole('option').filter({ hasText: 'Widgets Catalog' }).click();

    await expect(window.getByRole('dialog', { name: 'Search tabs' })).toBeHidden();
    await expect(tabs.filter({ hasText: 'localhost' })).toHaveAttribute('aria-selected', 'true');
  });

  test('reaches tabs in other workspaces and switches to their workspace', async ({ window }) => {
    // A second workspace, with a tab of its own, made active.
    const research = await window.evaluate(async () => {
      const created = await window.portalogia.createWorkspace('Research');
      if (!created.ok) {
        throw new Error('could not create a workspace');
      }
      return created.data.activeWorkspaceId;
    });
    await window.evaluate(() => window.portalogia.createTerminalTab());
    // Back to the first workspace, so the terminal tab is out of sight.
    await window.evaluate(async () => {
      const state = await window.portalogia.getState();
      if (state.ok) {
        const first = state.data.workspaces[0];
        if (first) {
          await window.portalogia.switchWorkspace(first.id);
        }
      }
    });

    await window.getByRole('button', { name: 'Search tabs' }).click();
    const results = window.getByRole('dialog', { name: 'Search tabs' }).getByRole('option');
    await window.getByRole('combobox', { name: 'Search tabs' }).fill('terminal');
    await expect(results).toHaveCount(1);
    await expect(results.first()).toContainText('Research');
    await results.first().click();

    await expect
      .poll(() =>
        window.evaluate(async () => {
          const state = await window.portalogia.getState();
          return state.ok ? state.data.activeWorkspaceId : null;
        }),
      )
      .toBe(research);
  });
});
