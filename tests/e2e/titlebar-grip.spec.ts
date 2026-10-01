// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-01

import { test, expect } from './fixtures';

test.describe('titlebar drag strip', () => {
  test('is an ordinary element above the tabs that shows pressed and hover states', async ({ window }) => {
    const grip = window.locator('.titlebar__grip');
    await expect(grip).toBeVisible();

    const box = (await grip.boundingBox())!;
    expect(box.y).toBe(0);
    expect(box.height).toBe(8);

    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const colorOf = () => grip.evaluate((el) => getComputedStyle(el).backgroundColor);
    const restingColor = await colorOf();

    // Hover: a different (lighter in dark theme) grey and the grab cursor.
    await window.mouse.move(x, y);
    await expect.poll(colorOf).not.toBe(restingColor);
    const hoverColor = await colorOf();
    expect(await grip.evaluate((el) => getComputedStyle(el).cursor)).toBe('grab');

    // Pressed: yet another grey, the grabbing cursor, until release.
    await window.mouse.down();
    await expect(grip).toHaveClass(/titlebar__grip--dragging/);
    expect(await colorOf()).not.toBe(hoverColor);
    expect(await grip.evaluate((el) => getComputedStyle(el).cursor)).toBe('grabbing');

    await window.mouse.up();
    await expect(grip).not.toHaveClass(/titlebar__grip--dragging/);
  });

  test('sits above the tabs without covering the window controls', async ({ window }) => {
    const gripBottom = (await window.locator('.titlebar__grip').boundingBox())!.y + 8;
    const tabTop = (await window.locator('.tab-bar__tab').first().boundingBox())!.y;
    expect(tabTop).toBeGreaterThanOrEqual(gripBottom);

    // The topmost element at the close button's top edge is the button, not the grip.
    const close = (await window.getByRole('button', { name: 'Close', exact: true }).boundingBox())!;
    const topmost = await window.evaluate(
      ([x, y]) => document.elementFromPoint(x!, y!)?.closest('button')?.getAttribute('aria-label') ?? null,
      [close.x + close.width / 2, close.y + 2],
    );
    expect(topmost).toBe('Close');
  });
});
