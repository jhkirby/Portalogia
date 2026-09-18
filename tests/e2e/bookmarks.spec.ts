// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-15

import { test, expect } from './fixtures';

test.describe('bookmarks', () => {
  test('toggling the bookmark button flips its pressed state and glyph', async ({ window, server }) => {
    const addressBar = window.getByLabel('Search the internet...');
    await addressBar.fill(server.url('/widgets'));
    await addressBar.press('Enter');
    await expect(
      window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab'),
    ).toContainText('Widgets Catalog');

    const bookmarkButton = window.getByRole('button', { name: 'Bookmark this page' });
    await expect(bookmarkButton).toHaveAttribute('aria-pressed', 'false');
    await expect(bookmarkButton).toHaveText('☆');

    await bookmarkButton.click();

    const removeButton = window.getByRole('button', { name: 'Remove bookmark' });
    await expect(removeButton).toHaveAttribute('aria-pressed', 'true');
    await expect(removeButton).toHaveText('★');

    await removeButton.click();
    await expect(window.getByRole('button', { name: 'Bookmark this page' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});
