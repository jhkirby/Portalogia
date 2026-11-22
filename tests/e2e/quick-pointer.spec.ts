// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-21

import type { ElectronApplication, Page } from 'playwright';
import { test, expect, openInActiveTab } from './fixtures';

const panButton = (window: Page) => window.getByRole('button', { name: /^Pan:/ });
const selectButton = (window: Page) => window.getByRole('button', { name: /^Select:/ });
const penButton = (window: Page) => window.getByRole('button', { name: /^Turn (on|off) pen$/ });

/**
 * Presses or lets go of Ctrl in a tab's page the way the keyboard does: through Electron's input pipeline, so main's
 * `before-input-event` sees it (Playwright's own keyboard goes straight to the renderer).
 */
async function ctrl(app: ElectronApplication, type: 'keyDown' | 'keyUp', also?: string): Promise<void> {
  await app.evaluate(
    ({ webContents }, { type: eventType, also: key }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('/tall'));
      if (!page) {
        throw new Error('No page');
      }
      page.sendInputEvent({ type: eventType, keyCode: 'Control', modifiers: eventType === 'keyDown' ? ['control'] : [] });
      if (key) {
        page.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers: ['control'] });
        page.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers: ['control'] });
      }
    },
    { type, also },
  );
}

test.describe('holding Ctrl for quick access', () => {
  test('Pan and Select trade places while Ctrl is held, and come back when it is let go', async ({ electronApp, window, server }) => {
    await openInActiveTab(electronApp, window, server.url('/tall'));
    await expect(selectButton(window)).toHaveAttribute('aria-pressed', 'true');
    await ctrl(electronApp, 'keyDown');
    await expect(panButton(window)).toHaveAttribute('aria-pressed', 'true');
    await ctrl(electronApp, 'keyUp');
    await expect(selectButton(window)).toHaveAttribute('aria-pressed', 'true');
  });

  test('a marking tool steps aside for the pointer while Ctrl is held, and comes back after', async ({ electronApp, window, server }) => {
    test.setTimeout(90_000);
    await openInActiveTab(electronApp, window, server.url('/tall'));
    await penButton(window).click();
    await expect(penButton(window)).toHaveAttribute('aria-pressed', 'true');
    await ctrl(electronApp, 'keyDown');
    await expect(penButton(window)).toHaveAttribute('aria-pressed', 'false');
    await expect(selectButton(window)).toHaveAttribute('aria-pressed', 'true');
    await ctrl(electronApp, 'keyUp');
    await expect(penButton(window)).toHaveAttribute('aria-pressed', 'true');
  });

  test('a Ctrl shortcut does not swap the pointer', async ({ electronApp, window, server }) => {
    await openInActiveTab(electronApp, window, server.url('/tall'));
    // Ctrl and another key at once: a shortcut, called off before the hold's short wait is up.
    await ctrl(electronApp, 'keyDown', 'A');
    await window.waitForTimeout(400);
    await expect(selectButton(window)).toHaveAttribute('aria-pressed', 'true');
    await ctrl(electronApp, 'keyUp');
    await expect(selectButton(window)).toHaveAttribute('aria-pressed', 'true');
  });
});
