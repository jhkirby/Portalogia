// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-15

import { test, expect } from './fixtures';

test.describe('app launch', () => {
  test('opens the Portalogia chrome with one home tab and one workspace', async ({ window }) => {
    await expect(window).toHaveTitle('Portalogia');

    const tabs = window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab');
    await expect(tabs).toHaveCount(1);

    const workspaces = window.getByRole('tablist', { name: 'Workspaces' }).getByRole('tab');
    await expect(workspaces).toHaveCount(1);
    await expect(workspaces.first()).toContainText('Home');

    // The home page shows no URL in the omnibox.
    await expect(window.getByLabel('Search the internet...')).toHaveValue('');

    // A fresh tab has nowhere to go back or forward to yet.
    await expect(window.getByRole('button', { name: 'Back' })).toBeDisabled();
    await expect(window.getByRole('button', { name: 'Forward' })).toBeDisabled();
  });
});
