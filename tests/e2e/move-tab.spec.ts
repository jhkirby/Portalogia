// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-21

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { MAX_TABS_PER_WORKSPACE } from '../../src/shared/constants';
import { test, expect } from './fixtures';

interface Snapshot {
  tabs: { id: string; workspaceId: string }[];
  activeTabId: string;
  workspaces: { id: string; name: string }[];
  activeWorkspaceId: string;
}

async function stateOf(page: Page): Promise<Snapshot> {
  const result = await page.evaluate(() => window.portalogia.getState());
  return ((result as { data?: unknown }).data ?? result) as Snapshot;
}

test.describe('moving a tab to another workspace', () => {
  test('the toolbar button lists the other workspaces with room, and a pick moves the tab there', async ({ window }) => {
    const moveButton = window.getByRole('button', { name: 'Move tab to workspace' });
    // One workspace: nowhere to move to.
    await expect(moveButton).toBeDisabled();

    await window.getByRole('button', { name: 'New workspace' }).click();
    const workspaces = window.getByRole('tablist', { name: 'Workspaces' }).getByRole('tab');
    await expect(workspaces).toHaveCount(2);
    await workspaces.first().click();
    await window.evaluate(() => window.portalogia.createTab());
    const before = await stateOf(window);
    const moving = before.activeTabId;
    const [home, other] = before.workspaces;

    await expect(moveButton).toBeEnabled();
    await moveButton.click();
    const popup = window.getByRole('dialog', { name: /to a workspace/ });
    await expect(popup).toBeVisible();
    // Only the other workspace is offered, not the tab's own.
    const rows = popup.getByRole('option');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(other!.name);
    await window.screenshot({ path: join(process.env['SHOTS'] ?? tmpdir(), 'move-tab-popup.png') });
    await rows.first().click();
    await expect(popup).toHaveCount(0);

    await expect.poll(async () => (await stateOf(window)).tabs.find((tab) => tab.id === moving)?.workspaceId).toBe(other!.id);
    expect((await stateOf(window)).tabs.some((tab) => tab.workspaceId === home!.id)).toBe(true);
  });

  test('a workspace with no room is left out', async ({ window }) => {
    await window.getByRole('button', { name: 'New workspace' }).click();
    const workspaces = window.getByRole('tablist', { name: 'Workspaces' }).getByRole('tab');
    await expect(workspaces).toHaveCount(2);
    // Fill the new workspace, then go back to the first.
    const tabs = window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab');
    while ((await tabs.count()) < MAX_TABS_PER_WORKSPACE) {
      await window.evaluate(() => window.portalogia.createTab());
    }
    await workspaces.first().click();
    await expect(window.getByRole('button', { name: 'Move tab to workspace' })).toBeDisabled();
  });
});
