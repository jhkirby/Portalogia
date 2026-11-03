// Project: Portalogia
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
    ).toContainText('localhost');

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

  test('the blank default page cannot be bookmarked', async ({ window }) => {
    const bookmarkButton = window.getByRole('button', { name: 'Bookmark this page' });
    await expect(bookmarkButton).toBeDisabled();

    // The Ctrl+B accelerator goes straight to the main process, past the button.
    await window.keyboard.press('Control+b');
    await expect(window.locator('.bookmark-popup')).toHaveCount(0);
    await expect(bookmarkButton).toHaveAttribute('aria-pressed', 'false');
  });

  test('a bookmarked page shows its saved name in a bubble until the address bar is focused', async ({ window, server }) => {
    const addressBar = window.getByLabel('Search the internet...');
    await addressBar.fill(server.url('/widgets'));
    await addressBar.press('Enter');
    const tab = window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab');
    await expect(tab).toContainText('localhost');

    const bubble = window.locator('.address-bar__bubble');
    // Not bookmarked yet: the bubble shows the site's domain instead of a saved name.
    await expect(bubble).toHaveText('localhost');
    await expect(bubble).toHaveClass(/address-bar__bubble--domain/);

    await window.getByRole('button', { name: 'Bookmark this page' }).click();
    await window.locator('.bookmark-popup__save').click();
    await expect(bubble).toHaveText('Widgets Catalog');
    // The tab shows the very same text as the bubble.
    await expect(tab).toContainText('Widgets Catalog');

    // Clicking into the bar brings the real URL back.
    await window.locator('.address-bar').click();
    await expect(bubble).toHaveCount(0);
    // ...and focusing it doesn't highlight the URL.
    expect(await addressBar.evaluate((input: HTMLInputElement) => input.selectionStart === input.selectionEnd)).toBe(true);
    await expect(addressBar).toHaveValue(server.url('/widgets'));

    // Leaving it puts the bubble back, and clears the URL's selection.
    await addressBar.press('Escape');
    await window.locator('.toolbar').click({ position: { x: 5, y: 5 } });
    await expect(bubble).toHaveText('Widgets Catalog');
    expect(await addressBar.evaluate((input: HTMLInputElement) => input.selectionStart === input.selectionEnd)).toBe(true);
    // The bubble's text uses the address bar's own text color, not the accent.
    const colors = await window.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.color = 'var(--color-address-text)';
      document.body.append(probe);
      const text = getComputedStyle(probe).color;
      probe.remove();
      return { bubble: getComputedStyle(document.querySelector('.address-bar__bubble')!).color, text };
    });
    expect(colors.bubble).toBe(colors.text);
  });
});
