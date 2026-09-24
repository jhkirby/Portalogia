// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-15

import { test, expect } from './fixtures';

test.describe('bookmarks', () => {
  test('the star opens a popup to add a bookmark, and removes it instantly once already saved', async ({
    window,
    server,
  }) => {
    const addressBar = window.getByLabel('Search the internet...');
    await addressBar.fill(server.url('/widgets'));
    await addressBar.press('Enter');
    await expect(
      window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab'),
    ).toContainText('Widgets Catalog');

    const bookmarkButton = window.getByRole('button', { name: 'Bookmark this page' });
    await expect(bookmarkButton).toHaveAttribute('aria-pressed', 'false');

    // Not yet bookmarked: the star opens the add-bookmark popup rather than
    // saving immediately (see BookmarkPopup.tsx) — nothing is saved until
    // its own Save button is clicked.
    await bookmarkButton.click();
    const popup = window.locator('.bookmark-popup');
    await expect(popup).toBeVisible();
    await expect(bookmarkButton).toHaveAttribute('aria-pressed', 'false');

    await window.locator('.bookmark-popup__save').click();
    await expect(popup).toHaveCount(0);

    const removeButton = window.getByRole('button', { name: 'Remove bookmark' });
    await expect(removeButton).toHaveAttribute('aria-pressed', 'true');

    // Already bookmarked: the star removes it instantly, no popup.
    await removeButton.click();
    await expect(window.getByRole('button', { name: 'Bookmark this page' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});
