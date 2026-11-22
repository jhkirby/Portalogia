// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-21

import type { Page } from 'playwright';
import { test, expect } from './fixtures';

/** The tabs' ids in the order main holds them. */
async function tabOrder(page: Page): Promise<string[]> {
  const result = await page.evaluate(() => window.portalogia.getState());
  const state = ((result as { data?: unknown }).data ?? result) as { tabs: { id: string }[] };
  return state.tabs.map((tab) => tab.id);
}

/** Opens tabs until the row has `count`. */
async function openTabs(page: Page, count: number): Promise<void> {
  const tabs = page.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab');
  while ((await tabs.count()) < count) {
    await page.evaluate(() => window.portalogia.createTab());
  }
  await expect(tabs).toHaveCount(count);
}

test.describe('dragging a tab', () => {
  test('reorders the row, and the tab stays where it was let go', async ({ window }) => {
    await openTabs(window, 3);
    const before = await tabOrder(window);
    const tabs = window.locator('.tab-bar__tab[data-tab-id]');
    // Measured once the new tabs have finished growing into the row.
    await expect(window.locator('.tab-bar__tab--entering')).toHaveCount(0);
    await window.waitForTimeout(300);
    const first = await tabs.nth(0).boundingBox();
    const third = await tabs.nth(2).boundingBox();
    await window.mouse.move(first!.x + 20, first!.y + first!.height / 2);
    await window.mouse.down();
    // Past the last tab's right edge: the end of the row (the tab itself stops at the row's end).
    await window.mouse.move(third!.x + third!.width + 30, first!.y + first!.height / 2, { steps: 12 });
    await window.mouse.up();
    await expect.poll(() => tabOrder(window)).toEqual([before[1], before[2], before[0]]);
    // Drawn in that order too, the moved tab in the last slot.
    await expect(tabs.nth(2)).toHaveAttribute('data-tab-id', before[0]!);
  });

  test('can\'t take the tab out of the row: no new window, no other workspace', async ({ window, electronApp }) => {
    await openTabs(window, 2);
    const before = await tabOrder(window);
    const tab = await window.locator('.tab-bar__tab[data-tab-id]').nth(0).boundingBox();
    await window.mouse.move(tab!.x + 20, tab!.y + tab!.height / 2);
    await window.mouse.down();
    // Down through the toolbar and across the workspace sidebar, then off the bottom of the window.
    await window.mouse.move(tab!.x + 40, tab!.y + 200, { steps: 10 });
    await window.mouse.move(60, 160, { steps: 10 });
    // Let go off the bottom of the window, level with where the tab started: the order is decided by where along the
    // row the pointer is, so this leaves it as it was.
    await window.mouse.move(tab!.x + 20, 2000, { steps: 10 });
    await window.mouse.up();
    // The dragged tab stays within the row while it's held, and nothing leaves it.
    await expect.poll(() => tabOrder(window)).toEqual(before);
    expect(electronApp.windows().filter((page) => !page.isClosed()).length).toBeGreaterThanOrEqual(1);
    const windows = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((win) => win.isVisible()).length);
    expect(windows).toBe(1);
  });

  test('a press that doesn\'t move is still a click', async ({ window }) => {
    await openTabs(window, 2);
    const tabs = window.locator('.tab-bar__tab[data-tab-id]');
    const firstId = await tabs.nth(0).getAttribute('data-tab-id');
    await tabs.nth(0).click();
    await expect(tabs.nth(0)).toHaveClass(/tab-bar__tab--active/);
    expect((await tabOrder(window))[0]).toBe(firstId);
  });
});
