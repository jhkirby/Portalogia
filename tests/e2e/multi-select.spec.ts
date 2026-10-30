// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import type { Page } from 'playwright';
import { clickMenuItem, test, expect } from './fixtures';

interface SnapshotState {
  tabs: { id: string; workspaceId: string }[];
  activeTabId: string;
  workspaces: { id: string }[];
  activeWorkspaceId: string;
  selectedTabIds: string[];
  selectedWorkspaceIds: string[];
}

async function stateOf(page: Page): Promise<SnapshotState> {
  const result = await page.evaluate(() => window.northstar.getState());
  return ((result as { data?: unknown }).data ?? result) as SnapshotState;
}

/** Opens tabs until the workspace has `count` of them; the last one opened is active. */
async function openTabs(page: Page, count: number): Promise<void> {
  const tabs = page.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab');
  while ((await tabs.count()) < count) {
    await page.evaluate(() => window.northstar.createTab());
  }
  await expect(tabs).toHaveCount(count);
}

test.describe('multi-selecting tabs', () => {
  test('Ctrl+click selects along with the active tab, without switching to it', async ({ window }) => {
    await openTabs(window, 4);
    const tabs = window.locator('.tab-bar__tab');
    const before = await stateOf(window);

    await tabs.nth(0).click({ modifiers: ['Control'] });
    await expect(window.locator('.tab-bar__tab--selected')).toHaveCount(2); // the clicked one + the active one
    await expect(tabs.nth(0)).toHaveClass(/tab-bar__tab--selected/);
    await expect(tabs.nth(3)).toHaveClass(/tab-bar__tab--active/);
    expect((await stateOf(window)).activeTabId).toBe(before.activeTabId);

    await tabs.nth(1).click({ modifiers: ['Control'] });
    await expect(window.locator('.tab-bar__tab--selected')).toHaveCount(3);

    // Ctrl+click again removes it; a selection of one is no selection.
    await tabs.nth(1).click({ modifiers: ['Control'] });
    await tabs.nth(0).click({ modifiers: ['Control'] });
    await expect(window.locator('.tab-bar__tab--selected')).toHaveCount(0);
  });

  test('a plain click switches tabs and ends the selection', async ({ window }) => {
    await openTabs(window, 4);
    const tabs = window.locator('.tab-bar__tab');
    await tabs.nth(0).click({ modifiers: ['Control'] });
    await expect(window.locator('.tab-bar__tab--selected')).toHaveCount(2);

    await tabs.nth(2).click();
    await expect(window.locator('.tab-bar__tab--selected')).toHaveCount(0);
    await expect(tabs.nth(2)).toHaveClass(/tab-bar__tab--active/);
  });

  test('Shift+click selects every tab between the active one and the clicked one', async ({ window }) => {
    await openTabs(window, 5);
    const tabs = window.locator('.tab-bar__tab');
    await tabs.nth(1).click(); // active = second tab

    await tabs.nth(3).click({ modifiers: ['Shift'] });
    const selected = (await stateOf(window)).selectedTabIds;
    const ids = (await stateOf(window)).tabs.map((tab) => tab.id);
    expect(selected).toEqual([ids[1], ids[2], ids[3]]);
    await expect(window.locator('.tab-bar__tab--selected')).toHaveCount(3);

    // Backwards works too.
    await tabs.nth(0).click({ modifiers: ['Shift'] });
    expect((await stateOf(window)).selectedTabIds).toEqual([ids[0], ids[1]]);
  });

  test('Ctrl+W (Close Tab) closes every selected tab at once', async ({ electronApp, window }) => {
    await openTabs(window, 5);
    const tabs = window.locator('.tab-bar__tab');
    await tabs.nth(0).click({ modifiers: ['Control'] });
    await tabs.nth(1).click({ modifiers: ['Control'] });
    await expect(window.locator('.tab-bar__tab--selected')).toHaveCount(3); // + the active one

    await clickMenuItem(electronApp, 'Close Tab');
    await expect(tabs).toHaveCount(2);
    await expect(window.locator('.tab-bar__tab--selected')).toHaveCount(0);
  });

  test('dropping one selected tab onto a workspace moves them all', async ({ window }) => {
    await openTabs(window, 5);
    await window.getByRole('button', { name: 'New workspace' }).click();
    const workspaces = window.getByRole('tablist', { name: 'Workspaces' }).getByRole('tab');
    await expect(workspaces).toHaveCount(2);
    await workspaces.first().click();

    const tabs = window.locator('.tab-bar__tab');
    await expect(tabs).toHaveCount(5);
    await tabs.nth(0).click({ modifiers: ['Control'] });
    await tabs.nth(1).click({ modifiers: ['Control'] });
    const state = await stateOf(window);
    expect(state.selectedTabIds).toHaveLength(3);

    // What a drop on the second workspace's pill sends: one tab's id.
    const secondWorkspaceId = state.workspaces[1]!.id;
    await window.evaluate(([id, ws]) => window.northstar.moveTabToWorkspace(id!, ws!), [state.selectedTabIds[0], secondWorkspaceId]);

    await expect(tabs).toHaveCount(2); // Home keeps the two that weren't selected
    await workspaces.nth(1).click();
    await expect(tabs).toHaveCount(4); // its own home tab + the three moved ones
  });

  test('tearing a selected tab out moves the whole selection into one new window', async ({ electronApp, window }) => {
    await openTabs(window, 5);
    const tabs = window.locator('.tab-bar__tab');
    await tabs.nth(0).click({ modifiers: ['Control'] });
    await tabs.nth(1).click({ modifiers: ['Control'] });
    const state = await stateOf(window);
    expect(state.selectedTabIds).toHaveLength(3);
    const selected = state.selectedTabIds;

    // A release far outside the window is a tear-off (not live).
    await window.evaluate((id) => window.northstar.tearOffTab(id!, 6000, 6000), selected[0]);

    await expect
      .poll(async () => {
        for (const page of electronApp.windows()) {
          if (page !== window && !page.isClosed() && (await page.locator('.tab-bar__tab').count().catch(() => 0)) > 0) {
            return page.locator('.tab-bar__tab').count();
          }
        }
        return 0;
      }, { timeout: 15_000 })
      .toBe(3);
    await expect(tabs).toHaveCount(2);
  });
});

test.describe('multi-selecting workspaces', () => {
  test('Ctrl+click and Shift+click select workspaces, and Ctrl+Alt+W (Close Workspace) removes them all', async ({ electronApp, window }) => {
    const workspaces = window.getByRole('tablist', { name: 'Workspaces' }).getByRole('tab');
    for (let i = 0; i < 3; i += 1) {
      await window.getByRole('button', { name: 'New workspace' }).click();
    }
    await expect(workspaces).toHaveCount(4); // the last created one is active

    // Ctrl+click adds the first one without leaving the active (last) workspace.
    const activeBefore = (await stateOf(window)).activeWorkspaceId;
    await workspaces.nth(0).click({ modifiers: ['Control'] });
    await expect(window.locator('.workspace-bar__pill--selected')).toHaveCount(2);
    expect((await stateOf(window)).activeWorkspaceId).toBe(activeBefore);

    // Shift+click selects the whole range from the active workspace.
    await workspaces.nth(1).click({ modifiers: ['Shift'] });
    await expect(window.locator('.workspace-bar__pill--selected')).toHaveCount(3);

    await clickMenuItem(electronApp, 'Close Workspace');
    await expect(workspaces).toHaveCount(1);
  });

  test('a plain click on a workspace switches to it and ends the selection', async ({ window }) => {
    const workspaces = window.getByRole('tablist', { name: 'Workspaces' }).getByRole('tab');
    await window.getByRole('button', { name: 'New workspace' }).click();
    await window.getByRole('button', { name: 'New workspace' }).click();
    await workspaces.nth(0).click({ modifiers: ['Control'] });
    await expect(window.locator('.workspace-bar__pill--selected')).toHaveCount(2);

    await workspaces.nth(1).click();
    await expect(window.locator('.workspace-bar__pill--selected')).toHaveCount(0);
    await expect(workspaces.nth(1)).toHaveAttribute('aria-selected', 'true');
  });
});

test.describe('keyboard shortcuts with the hidden spare window present', () => {
  // Regression: the spare window (kept ready for tab tear-off) used to become
  // "the active window" for menu accelerators, so Ctrl+W / Ctrl+Alt+W — which
  // act on that window — silently did nothing to the window the user was in.
  test('Ctrl+W and Ctrl+Alt+W act on the visible window', async ({ electronApp, window }) => {
    await expect
      .poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(2);

    // Real key events through the chrome window's own input pipeline (the path a physical key press takes).
    const press = (modifiers: ('control' | 'alt')[]): Promise<void> =>
      electronApp.evaluate(({ BrowserWindow }, mods) => {
        const win = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible())!;
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'W', modifiers: mods });
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'W', modifiers: mods });
      }, modifiers);

    await openTabs(window, 4);
    const tabs = window.locator('.tab-bar__tab');
    await tabs.nth(0).click({ modifiers: ['Control'] });
    await expect(window.locator('.tab-bar__tab--selected')).toHaveCount(2);
    await press(['control']);
    await expect(tabs).toHaveCount(2); // the selected pair (the active tab and the Ctrl+clicked one) closed

    const workspaces = window.getByRole('tablist', { name: 'Workspaces' }).getByRole('tab');
    await window.getByRole('button', { name: 'New workspace' }).click();
    await window.getByRole('button', { name: 'New workspace' }).click();
    await expect(workspaces).toHaveCount(3);
    await workspaces.nth(0).click({ modifiers: ['Control'] });
    await expect(window.locator('.workspace-bar__pill--selected')).toHaveCount(2);
    await press(['control', 'alt']);
    await expect(workspaces).toHaveCount(1);
  });
});

