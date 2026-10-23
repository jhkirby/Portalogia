// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

import { test, expect } from './fixtures';

test.describe('workspaces', () => {
  test('creating a workspace switches to it with a fresh home tab', async ({ window }) => {
    const workspaces = window.getByRole('tablist', { name: 'Workspaces' }).getByRole('tab');
    await expect(workspaces).toHaveCount(1);

    await window.getByRole('button', { name: 'New workspace' }).click();

    await expect(workspaces).toHaveCount(2);
    await expect(workspaces.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(window.getByLabel('Search the internet...')).toHaveValue('');
    await expect(window.getByLabel('Search the internet...')).toBeFocused();
  });

  test('switching workspaces shows only that workspace\'s tabs', async ({ window }) => {
    const tabs = window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab');
    const workspaces = window.getByRole('tablist', { name: 'Workspaces' }).getByRole('tab');

    await window.getByRole('button', { name: 'New tab', exact: true }).click();
    await expect(tabs).toHaveCount(2);

    await window.getByRole('button', { name: 'New workspace' }).click();
    await expect(tabs).toHaveCount(1); // the new workspace's own fresh home tab

    await workspaces.first().click();
    await expect(tabs).toHaveCount(2); // back to Home's two tabs
  });

  test('double-clicking a workspace pill renames it', async ({ window }) => {
    const pill = window.getByRole('tablist', { name: 'Workspaces' }).getByRole('tab').first();
    await pill.dblclick();

    const input = pill.getByRole('textbox');
    await input.fill('Research');
    await input.press('Enter');

    await expect(pill).toContainText('Research');
  });

  test('a workspace can only be removed once there is more than one', async ({ window }) => {
    const workspaces = window.getByRole('tablist', { name: 'Workspaces' }).getByRole('tab');
    await expect(workspaces.first().getByRole('button', { name: /Remove/ })).toHaveCount(0);

    await window.getByRole('button', { name: 'New workspace' }).click();
    await expect(workspaces).toHaveCount(2);

    await workspaces.first().getByRole('button', { name: /Remove/ }).click();
    await expect(workspaces).toHaveCount(1);
  });
});

test.describe('the collapsed sidebar', () => {
  test('a double-click does nothing: no rename box, and the workspaces stay where they are', async ({ window }) => {
    await window.getByRole('button', { name: 'New workspace' }).click();
    await window.locator('.sidebar__toggle').click();
    await expect(window.locator('.sidebar--hidden')).toHaveCount(1);
    const pill = window.locator('.workspace-bar__pill').first();
    await expect.poll(async () => (await pill.boundingBox())?.width).toBeLessThan(40);
    const box = (await pill.boundingBox())!;

    await window.mouse.dblclick(box.x + 8, box.y + box.height / 2);
    await window.waitForTimeout(300);

    await expect(window.locator('.workspace-bar__name-input')).toHaveCount(0);
    expect(await window.locator('.workspace-bar').evaluate((list) => list.scrollLeft)).toBe(0);
    // Within a pixel: the collapse may still be settling by a fraction of one; the shift this guards against was 17px.
    expect(Math.abs((await pill.boundingBox())!.x - box.x)).toBeLessThan(1);
  });
});
