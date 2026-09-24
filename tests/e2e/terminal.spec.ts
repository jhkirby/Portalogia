// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-22

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures';

// Forward-slash form of this repo's own root — a directory guaranteed to
// exist and contain known files (`package.json`), so `ls`'s output is
// deterministic regardless of whose machine/home directory the shell
// actually starts in. Backslash-free since MSYS bash (Git Bash) handles a
// forward-slash Windows path more reliably inside a quoted `cd` than one
// with backslashes.
const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..').replace(/\\/g, '/');

test.describe('terminal', () => {
  test('a real shell runs `ls` and its output actually renders', async ({ electronApp, window }) => {
    // A terminal tab is its own `WebContentsView` (`terminal.html`), a
    // separate native surface — and a separate Playwright `Page` — from
    // the chrome window that hosts the tab strip. Clicking the button
    // creates it; `waitForEvent('window', ...)` catches that new page as
    // it appears rather than guessing a fixed delay.
    const [terminalPage] = await Promise.all([
      electronApp.waitForEvent('window', { predicate: (page) => page.url().includes('terminal.html') }),
      window.getByRole('button', { name: 'New terminal' }).click(),
    ]);
    await terminalPage.waitForLoadState('domcontentloaded');

    const rows = terminalPage.locator('.xterm-rows');

    // The shell (Git Bash/WSL/PowerShell — see shell.ts) needs a moment to
    // start up and print its first prompt before it's ready for input —
    // and `Terminal.tsx`'s stale-render recovery (xterm's own render
    // scheduling can wedge itself during this exact startup burst) may
    // also need to kick in first, hence the generous timeout.
    await expect(rows).toContainText('$', { timeout: 15_000 });

    // Real OS-level focus, same as a user clicking into the terminal —
    // `Terminal.tsx` also focuses xterm on mount, but this removes any
    // doubt the keystrokes below land on the right element/page.
    await terminalPage.locator('.terminal__surface').click();

    await terminalPage.keyboard.type(`cd "${ROOT_DIR}"`);
    await terminalPage.keyboard.press('Enter');
    await terminalPage.keyboard.type('ls');
    await terminalPage.keyboard.press('Enter');

    // Proves the full round trip — keystrokes reaching the real pty
    // through this view's own preload/IPC, a real `ls` running in this
    // repo's own directory, and xterm.js actually rendering the result —
    // not just whatever the shell's own startup banner already painted,
    // which a render bug limited to "only ever shows the first paint"
    // could otherwise still pass on.
    await expect(rows).toContainText('package.json', { timeout: 10_000 });
  });
});
