// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

import { test, expect } from './fixtures';

/** The `-webkit-app-region` an element has, which decides whether pressing it moves the window. */
const appRegion = (el: Element): string => getComputedStyle(el).getPropertyValue('-webkit-app-region');

test.describe('title bar drag region', () => {
  test('the empty part of the tab row is an OS drag region', async ({ window }) => {
    expect(await window.locator('.titlebar').evaluate(appRegion)).toBe('drag');
    // No custom grip strip is left over it.
    await expect(window.locator('.titlebar__grip')).toHaveCount(0);
  });

  test('tabs, the new-tab button and the window controls opt out of it', async ({ window }) => {
    expect(await window.locator('.tab-bar__tab').first().evaluate(appRegion)).toBe('no-drag');
    expect(await window.locator('.tab-bar__new').evaluate(appRegion)).toBe('no-drag');
    expect(await window.locator('.titlebar__corner').evaluate(appRegion)).toBe('no-drag');
  });
});
