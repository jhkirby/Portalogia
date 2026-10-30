// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import type { Page } from 'playwright';
import { formatClockDate } from '../../src/renderer/lib/clockFormat';
import { test, expect } from './fixtures';

/** Moves the pointer onto the toolbar row, off the tab row. */
async function pointAtToolbar(window: Page): Promise<void> {
  const box = await window.locator('.toolbar').boundingBox();
  if (!box) {
    throw new Error('The toolbar has no box');
  }
  await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

/** Moves the pointer onto the first tab. */
async function pointAtTabRow(window: Page): Promise<void> {
  await window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab').first().hover();
}

test.describe('titlebar corner', () => {
  test('away from the tab row, the clock shows today and the new-tab button and window controls are hidden', async ({
    window,
  }) => {
    await pointAtToolbar(window);
    await expect(window.locator('.titlebar-clock__date')).toHaveText(formatClockDate(new Date()));
    await expect(window.locator('.titlebar-clock__time')).toHaveText(/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/);
    await expect(window.locator('.titlebar-clock')).toHaveCSS('opacity', '1');
    await expect(window.locator('.tab-bar__new')).toHaveCSS('opacity', '0');
    await expect(window.locator('.window-controls')).toHaveCSS('opacity', '0');
  });

  test('on the tab row, the buttons show and the clock hides; leaving swaps them back', async ({ window }) => {
    await pointAtTabRow(window);
    await expect(window.locator('.tab-bar__new')).toHaveCSS('opacity', '1');
    await expect(window.locator('.window-controls')).toHaveCSS('opacity', '1');
    await expect(window.locator('.titlebar-clock')).toHaveCSS('opacity', '0');

    await pointAtToolbar(window);
    await expect(window.locator('.tab-bar__new')).toHaveCSS('opacity', '0');
    await expect(window.locator('.titlebar-clock')).toHaveCSS('opacity', '1');
  });

  test('the hidden buttons still work once the pointer reaches them', async ({ window }) => {
    const tabs = window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab');
    await expect(tabs).toHaveCount(1);
    await window.getByRole('button', { name: 'New tab', exact: true }).click();
    await expect(tabs).toHaveCount(2);
  });

  test('the clock never takes the pointer, so the window-drag strip above it keeps working', async ({ window }) => {
    await expect(window.locator('.titlebar-clock')).toHaveCSS('pointer-events', 'none');
  });

  test('the clock does not sit over the last tab: the corner is as wide as the wider of it and the controls', async ({
    window,
  }) => {
    const corner = await window.locator('.titlebar__corner').boundingBox();
    const clock = await window.locator('.titlebar-clock').boundingBox();
    const controls = await window.locator('.window-controls').boundingBox();
    expect(corner && clock && controls).toBeTruthy();
    expect(corner!.width).toBeGreaterThanOrEqual(Math.max(clock!.width, controls!.width) - 0.5);
    expect(clock!.x).toBeGreaterThanOrEqual(corner!.x - 0.5);
  });
});
