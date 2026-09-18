// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-15

import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect } from '@playwright/test';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Static pages for navigation tests, served locally so they never depend on
 * (or get flaked by) real internet access. Each has its own `<title>` so
 * tests can assert the chrome picked up a real page-title-updated event,
 * and so tab search has more than one distinct title to filter between.
 */
const PAGES: Record<string, string> = {
  '/widgets': '<!doctype html><title>Widgets Catalog</title><h1>Widgets</h1>',
  '/gadgets': '<!doctype html><title>Gadgets Catalog</title><h1>Gadgets</h1>',
};

interface TestFixtures {
  /** A local HTTP server hosting `PAGES`, torn down after the test. */
  server: { url: (path: string) => string };
  /** The launched app, using a fresh, isolated `userData` dir per test. */
  electronApp: ElectronApplication;
  /** The chrome window's page, already past its first render. */
  window: Page;
}

export const test = base.extend<TestFixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixture signature requires the destructure even with no dependencies.
  server: async ({}, use) => {
    const httpServer: Server = createServer((request, response) => {
      const body = PAGES[request.url ?? ''];
      if (!body) {
        response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html' }).end(body);
    });
    // No explicit host: binds the unspecified address so both the "::1"
    // and "127.0.0.1" a client resolves "localhost" to (Windows tries
    // "::1" first) actually reach it — binding to "127.0.0.1" alone left
    // an "::1" connection attempt hanging until the test timed out.
    await new Promise<void>((resolvePromise) => httpServer.listen(0, resolvePromise));
    const { port } = httpServer.address() as AddressInfo;

    // `looksLikeUrl` (src/shared/url.ts) only special-cases the literal
    // hostname "localhost", not "127.0.0.1" — use that name in generated
    // URLs even though the socket is bound to the loopback address.
    await use({ url: (path: string) => `http://localhost:${port}${path}` });

    await new Promise<void>((resolvePromise) => httpServer.close(() => resolvePromise()));
  },

  // eslint-disable-next-line no-empty-pattern -- Playwright fixture signature requires the destructure even with no dependencies.
  electronApp: async ({}, use) => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'northstar-e2e-'));
    const app = await electron.launch({
      args: [join(ROOT_DIR, 'out/main/index.js'), `--user-data-dir=${userDataDir}`],
      cwd: ROOT_DIR,
    });

    await use(app);

    await app.close();
    rmSync(userDataDir, { recursive: true, force: true });
  },

  window: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    // The main process creates the first tab asynchronously after
    // `did-finish-load`; wait for it so every test starts from one settled
    // home tab instead of racing the initial state push.
    await window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab').first().waitFor();
    // Also wait for that first load to actually finish (spinner gone).
    // Firing a second navigation while the first is still pending aborts
    // it before it commits, so it never becomes a back/forward history
    // entry — a real Electron race, not just test flakiness.
    await expect(window.locator('.tab-bar__spinner')).toHaveCount(0);

    await use(window);
  },
});

export { expect };
