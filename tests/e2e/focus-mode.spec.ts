// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-15

import { test, expect } from './fixtures';

test.describe('focus mode', () => {
  test('toggling focus mode hides the workspace/tab row and back', async ({ window }) => {
    const tabRow = window.getByRole('tablist', { name: 'Open tabs' });
    await expect(tabRow).toBeVisible();

    const enter = window.getByRole('button', { name: 'Enter Focus Mode' });
    await enter.click();

    // App.tsx doesn't render `.tab-row` at all while focusMode is on.
    await expect(tabRow).toBeHidden();
    const exit = window.getByRole('button', { name: 'Exit Focus Mode' });
    await expect(exit).toHaveAttribute('aria-pressed', 'true');

    await exit.click();
    await expect(tabRow).toBeVisible();
  });
});
