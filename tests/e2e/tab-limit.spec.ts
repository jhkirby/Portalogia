// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-30

import { MAX_TABS_PER_WORKSPACE, MAX_WORKSPACES } from '../../src/shared/constants';
import { test, expect } from './fixtures';

test.describe('tabs per workspace limit', () => {
  test('the "+" disappears at the limit and returns when a tab closes', async ({ window }) => {
    const tabs = window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab');
    const newTab = window.getByRole('button', { name: 'New tab', exact: true });

    while ((await tabs.count()) < MAX_TABS_PER_WORKSPACE) {
      await newTab.click();
    }
    await expect(tabs).toHaveCount(MAX_TABS_PER_WORKSPACE);
    await expect(newTab).toHaveCount(0);

    await tabs.last().getByRole('button', { name: /^Close/ }).click();
    await expect(tabs).toHaveCount(MAX_TABS_PER_WORKSPACE - 1);
    await expect(newTab).toBeVisible();
  });

  test('the main process refuses a ninth tab even when the button is bypassed', async ({ window }) => {
    const tabs = window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab');
    const newTab = window.getByRole('button', { name: 'New tab', exact: true });
    while ((await tabs.count()) < MAX_TABS_PER_WORKSPACE) {
      await newTab.click();
    }

    // A terminal tab, a duplicate, and a direct create all go through other paths than the button.
    await window.evaluate(() => window.northstar.createTab({}));
    await window.evaluate(() => window.northstar.createTerminalTab());
    await window.waitForTimeout(500);
    await expect(tabs).toHaveCount(MAX_TABS_PER_WORKSPACE);
  });

  test('another workspace still has room, and a full one rejects a dragged-in tab', async ({ window }) => {
    const tabs = window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab');
    const workspaces = window.getByRole('tablist', { name: 'Workspaces' }).getByRole('tab');
    const newTab = window.getByRole('button', { name: 'New tab', exact: true });
    while ((await tabs.count()) < MAX_TABS_PER_WORKSPACE) {
      await newTab.click();
    }

    await window.getByRole('button', { name: 'New workspace' }).click();
    await expect(workspaces).toHaveCount(2);
    await expect(tabs).toHaveCount(1);
    await expect(newTab).toBeVisible();

    // Move the new workspace's only tab into the full Home workspace: refused.
    const state = (await window.evaluate(() => window.northstar.getState())) as { data?: { activeTabId: string; workspaces: { id: string }[] } };
    const movingId = state.data!.activeTabId;
    const homeId = state.data!.workspaces[0]!.id;
    await window.evaluate(([id, ws]) => window.northstar.moveTabToWorkspace(id!, ws!), [movingId, homeId]);
    await window.waitForTimeout(300);
    await expect(tabs).toHaveCount(1);
    await workspaces.first().click();
    await expect(tabs).toHaveCount(MAX_TABS_PER_WORKSPACE);
  });

  test('the "New workspace" button disappears at 20 workspaces and returns when one is removed', async ({ window }) => {
    const workspaces = window.getByRole('tablist', { name: 'Workspaces' }).getByRole('tab');
    const newWorkspace = window.getByRole('button', { name: 'New workspace' });

    // Created over IPC: it's the same main-process path as the button, minus 19 slow clicks.
    for (let i = 1; i < MAX_WORKSPACES; i += 1) {
      await window.evaluate(() => window.northstar.createWorkspace());
    }
    await expect(workspaces).toHaveCount(MAX_WORKSPACES);
    await expect(newWorkspace).toHaveCount(0);

    // The main process refuses a 21st even with the button bypassed.
    await window.evaluate(() => window.northstar.createWorkspace());
    await window.waitForTimeout(400);
    await expect(workspaces).toHaveCount(MAX_WORKSPACES);

    await workspaces.last().getByRole('button', { name: /^Remove/ }).click();
    await expect(workspaces).toHaveCount(MAX_WORKSPACES - 1);
    await expect(newWorkspace).toBeVisible();
  });
});
