// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-21

import type { ElectronApplication, Page } from 'playwright';
import { test, expect } from './fixtures';

/** Sends one key event to the chrome window, the way the keyboard does (through main's `before-input-event`). */
async function key(app: ElectronApplication, type: 'keyDown' | 'keyUp', keyCode: string, modifiers: ('control')[] = []): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, { type: eventType, keyCode: code, modifiers: mods }) => {
      const win = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible());
      win!.webContents.sendInputEvent({ type: eventType, keyCode: code, modifiers: mods });
    },
    { type, keyCode, modifiers },
  );
}

async function state(page: Page): Promise<{ tabs: { id: string }[]; activeTabId: string; grabbedTabId: string | null }> {
  const result = await page.evaluate(() => window.portalogia.getState());
  return ((result as { data?: unknown }).data ?? result) as { tabs: { id: string }[]; activeTabId: string; grabbedTabId: string | null };
}

test.describe('moving a tab with Ctrl+Space and the arrows', () => {
  test('the tab stays grabbed between steps for as long as Ctrl+Space is held', async ({ window, electronApp }) => {
    for (let count = 1; count < 3; count += 1) {
      await window.evaluate(() => window.portalogia.createTab());
    }
    await window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab').first().click();
    const before = await state(window);
    const moving = before.activeTabId;
    expect(before.tabs[0]!.id).toBe(moving);

    await key(electronApp, 'keyDown', 'Control', ['control']);
    await key(electronApp, 'keyDown', 'Space', ['control']);
    await expect.poll(async () => (await state(window)).grabbedTabId).toBe(moving);

    // One step right, then a pause well past the old grace period with Ctrl+Space still down, then another.
    await key(electronApp, 'keyDown', 'Right', ['control']);
    await key(electronApp, 'keyUp', 'Right', ['control']);
    await window.waitForTimeout(1200);
    expect((await state(window)).grabbedTabId).toBe(moving);
    await key(electronApp, 'keyDown', 'Right', ['control']);
    await key(electronApp, 'keyUp', 'Right', ['control']);
    await expect.poll(async () => (await state(window)).tabs.map((tab) => tab.id).indexOf(moving)).toBe(2);

    // Letting go of Ctrl ends it. (A simulated keyUp never reaches main's `before-input-event`, so this is the other
    // signal main reads: the next key comes without Ctrl.) That key is an ordinary key: the tab doesn't move.
    await key(electronApp, 'keyUp', 'Control');
    await key(electronApp, 'keyDown', 'Left');
    await key(electronApp, 'keyUp', 'Left');
    await expect.poll(async () => (await state(window)).grabbedTabId).toBeNull();
    expect((await state(window)).tabs.map((tab) => tab.id).indexOf(moving)).toBe(2);
  });

  test('letting go of Ctrl+Space after a move ends the grab at once', async ({ window, electronApp }) => {
    await window.evaluate(() => window.portalogia.createTab());
    await window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab').first().click();
    const moving = (await state(window)).activeTabId;

    await key(electronApp, 'keyDown', 'Control', ['control']);
    await key(electronApp, 'keyDown', 'Space', ['control']);
    await key(electronApp, 'keyDown', 'Right', ['control']);
    await key(electronApp, 'keyUp', 'Right', ['control']);
    await expect.poll(async () => (await state(window)).grabbedTabId).toBe(moving);
    await key(electronApp, 'keyUp', 'Space', ['control']);
    await key(electronApp, 'keyUp', 'Control');
    // Well inside the 15-second limit: the release itself ends it.
    await expect.poll(async () => (await state(window)).grabbedTabId, { timeout: 2000 }).toBeNull();
  });
});
