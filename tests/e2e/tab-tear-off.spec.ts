// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-30

import type { ElectronApplication, Page } from 'playwright';
import { test, expect } from './fixtures';

/**
 * Dragging a tab out of the tab strip tears it off into its own window while
 * the drag is still in flight (see `main/index.ts`'s `followCursor`).
 *
 * A real OS drag can't be driven from Playwright, so these tests replay the
 * exact DOM events the browser would produce — `dragstart`, a stream of
 * `drag` events carrying client/screen coordinates, `dragend` — against the
 * real tab element, and pin the main process's cursor to the same point
 * (`screen.getCursorScreenPoint` is what the follow loop polls).
 */

/** Number of top-level windows currently visible on screen. */
async function visibleWindowCount(app: ElectronApplication): Promise<number> {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.isVisible()).length);
}

/** Pins the main process's idea of where the mouse is, in screen coordinates. */
async function pinCursor(app: ElectronApplication, x: number, y: number): Promise<void> {
  await app.evaluate(({ screen }, point) => {
    (screen as { getCursorScreenPoint: () => { x: number; y: number } }).getCursorScreenPoint = () => point;
  }, { x, y });
}

/** The tab strip's last tab's own client-space center, plus where the window's client origin sits on screen. */
async function geometry(window: Page): Promise<{ tabX: number; tabY: number; originX: number; originY: number; stripBottom: number }> {
  return window.evaluate(() => {
    const tabs = document.querySelectorAll('.tab-bar__tab');
    const rect = tabs[tabs.length - 1]!.getBoundingClientRect();
    const bar = document.querySelector('.tab-bar')!.getBoundingClientRect();
    return {
      tabX: rect.left + rect.width / 2,
      tabY: rect.top + rect.height / 2,
      originX: window.screenX,
      originY: window.screenY,
      stripBottom: bar.bottom,
    };
  });
}

/** Replays `dragstart` on the last tab, then one `drag` event at the given client point. */
async function dragTabTo(window: Page, clientX: number, clientY: number): Promise<void> {
  await window.evaluate(
    ([x, y]) => {
      const tabs = document.querySelectorAll('.tab-bar__tab');
      const tab = tabs[tabs.length - 1]!;
      const dataTransfer = new DataTransfer();
      tab.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
      tab.dispatchEvent(
        new DragEvent('drag', {
          bubbles: true,
          dataTransfer,
          clientX: x!,
          clientY: y!,
          screenX: window.screenX + x!,
          screenY: window.screenY + y!,
        }),
      );
    },
    [clientX, clientY],
  );
}

/**
 * Replays `dragstart` on a tab, then a stream of `drag` events at one client
 * point for `durationMs` — what a real drag produces while the cursor rests
 * somewhere (the tear-off dwell timer needs more than a single event).
 * @param tabIndex Which tab to grab; defaults to the last one.
 */
async function dragTabAndHold(window: Page, clientX: number, clientY: number, durationMs = 450, tabIndex = -1): Promise<void> {
  await window.evaluate(
    async ([x, y, ms, index]) => {
      const tabs = Array.from(document.querySelectorAll('.tab-bar__tab'));
      const tab = tabs.at(index!)!;
      const dataTransfer = new DataTransfer();
      tab.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
      const end = Date.now() + ms!;
      while (Date.now() < end) {
        tab.dispatchEvent(
          new DragEvent('drag', {
            bubbles: true,
            dataTransfer,
            clientX: x!,
            clientY: y!,
            screenX: window.screenX + x!,
            screenY: window.screenY + y!,
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
    },
    [clientX, clientY, durationMs, tabIndex],
  );
}

/** Collects uncaught main-process exceptions (which would otherwise pop an error dialog). */
async function captureMainErrors(app: ElectronApplication): Promise<() => Promise<string[]>> {
  await app.evaluate(() => {
    const g = globalThis as { __mainErrors?: string[] };
    g.__mainErrors = [];
    process.on('uncaughtException', (error) => g.__mainErrors!.push(String(error.stack ?? error)));
  });
  return () => app.evaluate(() => (globalThis as { __mainErrors?: string[] }).__mainErrors ?? []);
}

test.describe('dragging a tab out of the tab strip', () => {
  test('a tab over the sidebar column can be pulled straight down and out', async ({ electronApp, window }) => {
    await window.getByRole('button', { name: 'New tab', exact: true }).click();
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), {
      timeout: 15_000,
    }).toBeGreaterThanOrEqual(2);

    // The first tab sits at the far left, inside the sidebar's 180px column.
    const first = await window.evaluate(() => {
      const rect = document.querySelector('.tab-bar__tab')!.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, stripBottom: document.querySelector('.tab-bar')!.getBoundingClientRect().bottom };
    });
    const geo = await geometry(window);
    const clientY = first.stripBottom + 250;
    await pinCursor(electronApp, geo.originX + first.x, geo.originY + clientY);

    await dragTabAndHold(window, first.x, clientY, 450, 0);

    await expect.poll(() => visibleWindowCount(electronApp), { timeout: 3_000, intervals: [25] }).toBe(2);
  });

  test('dropping onto a workspace moves the tab there and discards the new window, without errors', async ({ electronApp, window }) => {
    const readErrors = await captureMainErrors(electronApp);
    const workspaces = window.getByRole('tablist', { name: 'Workspaces' }).getByRole('tab');

    await window.getByRole('button', { name: 'New workspace' }).click();
    await expect(workspaces).toHaveCount(2);
    await workspaces.first().click();
    await window.getByRole('button', { name: 'New tab', exact: true }).click();
    const tabs = window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab');
    await expect(tabs).toHaveCount(2);
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), {
      timeout: 15_000,
    }).toBeGreaterThanOrEqual(2);
    const windowsBefore = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);

    // 1. Pull the last tab out into its own window.
    const state = await window.evaluate(() => window.northstar.getState());
    const draggedTabId = ((state as { data?: { activeTabId: string } }).data ?? (state as { activeTabId: string })).activeTabId;
    const geo = await geometry(window);
    const outX = geo.tabX + 300;
    const outY = geo.stripBottom + 200;
    await pinCursor(electronApp, geo.originX + outX, geo.originY + outY);
    await dragTabAndHold(window, outX, outY, 300);
    await expect.poll(() => visibleWindowCount(electronApp), { timeout: 3_000 }).toBe(2);

    // 2. Move the cursor over the second workspace's pill: the torn-off window must get out of the way.
    const pill = await workspaces.nth(1).boundingBox();
    const pillX = pill!.x + pill!.width / 2;
    const pillY = pill!.y + pill!.height / 2;
    await pinCursor(electronApp, geo.originX + pillX, geo.originY + pillY);
    await expect.poll(() => visibleWindowCount(electronApp), { timeout: 3_000 }).toBe(1);

    // 3. Drop on the pill, then the drag ends.
    await window.evaluate(
      ([x, y, id]) => {
        const ghost = Array.from(document.querySelectorAll('.tab-bar__tab')).at(-1)!;
        const target = document.elementFromPoint(x!, y!)!.closest('.workspace-bar__pill')!;
        const dataTransfer = new DataTransfer();
        dataTransfer.setData('text/plain', String(id));
        target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
        dataTransfer.dropEffect = 'move';
        ghost.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
      },
      [pillX, pillY, draggedTabId],
    );

    // The torn-off window is destroyed once the tab has demonstrably moved.
    await expect
      .poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), { timeout: 5_000 })
      .toBeLessThanOrEqual(windowsBefore);
    expect(await visibleWindowCount(electronApp)).toBe(1);
    // The tab is now in Workspace 2, alongside that workspace's own home tab.
    await workspaces.nth(1).click();
    await expect(tabs).toHaveCount(2);
    expect(await readErrors()).toEqual([]);
  });

  test('dropping back onto the original workspace removes the scratch workspace and re-appends the tab', async ({ electronApp, window }) => {
    const readErrors = await captureMainErrors(electronApp);
    const workspaces = window.getByRole('tablist', { name: 'Workspaces' }).getByRole('tab');
    const tabs = window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab');
    const getState = async (): Promise<{ tabs: { id: string; workspaceId: string }[]; workspaces: { id: string }[]; activeTabId: string }> => {
      const result = await window.evaluate(() => window.northstar.getState());
      return ((result as { data?: unknown }).data ?? result) as never;
    };

    await window.getByRole('button', { name: 'New tab', exact: true }).click();
    await expect(tabs).toHaveCount(2);
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), {
      timeout: 15_000,
    }).toBeGreaterThanOrEqual(2);
    const before = await getState();
    const draggedTabId = before.activeTabId;
    const homeWorkspaceId = before.tabs[0]!.workspaceId;
    expect(before.workspaces).toHaveLength(1);

    // Pull the (last) tab out: it gets its own scratch workspace and window.
    const geo = await geometry(window);
    await pinCursor(electronApp, geo.originX + geo.tabX + 300, geo.originY + geo.stripBottom + 200);
    await dragTabAndHold(window, geo.tabX + 300, geo.stripBottom + 200, 300);
    await expect.poll(() => visibleWindowCount(electronApp), { timeout: 3_000 }).toBe(2);
    await expect(workspaces).toHaveCount(2);

    // Hover and drop on the Home pill (where it came from).
    const pill = await workspaces.first().boundingBox();
    const pillX = pill!.x + pill!.width / 2;
    const pillY = pill!.y + pill!.height / 2;
    await pinCursor(electronApp, geo.originX + pillX, geo.originY + pillY);
    await expect.poll(() => visibleWindowCount(electronApp), { timeout: 3_000 }).toBe(1);
    await window.evaluate(
      ([x, y, id]) => {
        const ghost = Array.from(document.querySelectorAll('.tab-bar__tab')).at(-1)!;
        const target = document.elementFromPoint(x!, y!)!.closest('.workspace-bar__pill')!;
        const dataTransfer = new DataTransfer();
        dataTransfer.setData('text/plain', String(id));
        target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
        dataTransfer.dropEffect = 'move';
        ghost.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
      },
      [pillX, pillY, draggedTabId],
    );

    // The scratch workspace is gone, and the tab is back in Home — on the right.
    await expect(workspaces).toHaveCount(1, { timeout: 5_000 });
    await expect(tabs).toHaveCount(2);
    const after = await getState();
    expect(after.workspaces.map((w) => w.id)).toEqual([homeWorkspaceId]);
    expect(after.tabs.map((t) => t.id).at(-1)).toBe(draggedTabId);
    expect(await visibleWindowCount(electronApp)).toBe(1);
    expect(await readErrors()).toEqual([]);
  });

  test("a window's only tab dragged onto another window's tab strip moves, and the emptied window closes", async ({ electronApp, window }) => {
    const readErrors = await captureMainErrors(electronApp);
    const tabsOf = (page: Page) => page.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab');
    const workspacesOf = (page: Page) => page.getByRole('tablist', { name: 'Workspaces' }).getByRole('tab');
    const chromePages = async (): Promise<Page[]> => {
      const pages: Page[] = [];
      for (const page of electronApp.windows()) {
        // The hidden spare window also has a tab bar, but never any tabs.
        if (!page.isClosed() && (await page.locator('.tab-bar__tab').count().catch(() => 0)) > 0) {
          pages.push(page);
        }
      }
      return pages;
    };
    const stateOf = async (page: Page): Promise<{ activeTabId: string }> => {
      const result = await page.evaluate(() => window.northstar.getState());
      return ((result as { data?: unknown }).data ?? result) as never;
    };

    // Window 1: Home with two tabs. Window 2: a twin window, switched to its own new workspace (one tab).
    await window.getByRole('button', { name: 'New tab', exact: true }).click();
    await expect(tabsOf(window)).toHaveCount(2);
    await window.evaluate(() => window.northstar.openWorkspaceInNewWindow());
    await expect.poll(async () => (await chromePages()).length, { timeout: 15_000 }).toBe(2);
    const second = (await chromePages()).find((page) => page !== window)!;
    await second.getByRole('button', { name: 'New workspace' }).click();
    await expect(workspacesOf(second)).toHaveCount(2);
    await expect(tabsOf(second)).toHaveCount(1);
    const movingTabId = (await stateOf(second)).activeTabId;
    const windowCountBefore = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);

    // Drag that only tab out of window 2: no new window — window 2 itself follows the cursor.
    const geo2 = await geometry(second);
    const outX = geo2.tabX + 300;
    const outY = geo2.stripBottom + 200;
    await pinCursor(electronApp, geo2.originX + outX, geo2.originY + outY);
    await dragTabAndHold(second, outX, outY, 300, 0);
    await window.waitForTimeout(300);
    expect(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(windowCountBefore);
    expect(await visibleWindowCount(electronApp)).toBe(2);

    // Hover window 1's tab strip: window 2 gets out of the way.
    const geo1 = await geometry(window);
    await pinCursor(electronApp, geo1.originX + geo1.tabX, geo1.originY + 20);
    await expect
      .poll(() => second.evaluate(() => window.screenX), { timeout: 3_000 })
      .toBeLessThan(-10_000);

    // Release over window 1's tab strip.
    // `dragover` and `drop` are separate events in a real drag; React needs to
    // re-render in between for the tab bar to know which tab it's hovering.
    await window.evaluate((id) => {
      const lastTab = Array.from(document.querySelectorAll('.tab-bar__tab')).at(-1)!;
      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/plain', String(id));
      lastTab.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
    }, movingTabId);
    await window.waitForTimeout(100);
    await window.evaluate((id) => {
      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/plain', String(id));
      document.querySelector('.tab-bar')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
    }, movingTabId);
    await second.evaluate(() => {
      const dataTransfer = new DataTransfer();
      dataTransfer.dropEffect = 'move';
      (Array.from(document.querySelectorAll('.tab-bar__tab')).at(0) ?? document.body).dispatchEvent(
        new DragEvent('dragend', { bubbles: true, dataTransfer }),
      );
    });

    // Window 2 closes, its workspace is gone, and the tab joined window 1's strip.
    await expect.poll(() => visibleWindowCount(electronApp), { timeout: 5_000 }).toBe(1);
    await expect(workspacesOf(window)).toHaveCount(1);
    await expect(tabsOf(window)).toHaveCount(3);
    expect(await readErrors()).toEqual([]);
  });

  test('opens the new window right away, not after a delay', async ({ electronApp, window }) => {
    await window.getByRole('button', { name: 'New tab', exact: true }).click();
    await expect(window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab')).toHaveCount(2);

    // The hidden spare window is prepared a few seconds after launch.
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), {
      timeout: 15_000,
    }).toBeGreaterThanOrEqual(2);
    expect(await visibleWindowCount(electronApp)).toBe(1);

    const geo = await geometry(window);
    // Well below the strip, over the page area (right of the sidebar column).
    const clientX = geo.tabX + 300;
    const clientY = geo.stripBottom + 200;
    await pinCursor(electronApp, geo.originX + clientX, geo.originY + clientY);

    const startedAt = Date.now();
    await dragTabTo(window, clientX, clientY);

    await expect.poll(() => visibleWindowCount(electronApp), { timeout: 3_000, intervals: [25] }).toBe(2);
    expect(Date.now() - startedAt).toBeLessThan(1_500);
  });

  test('does not tear off while the cursor stays within the tab strip', async ({ electronApp, window }) => {
    await window.getByRole('button', { name: 'New tab', exact: true }).click();
    const geo = await geometry(window);
    await pinCursor(electronApp, geo.originX + geo.tabX, geo.originY + geo.tabY);

    await dragTabTo(window, geo.tabX + 40, geo.tabY);
    await window.waitForTimeout(600);

    expect(await visibleWindowCount(electronApp)).toBe(1);
  });

  test('releasing over empty space leaves the new window open with the tab in it', async ({ electronApp, window }) => {
    await window.getByRole('button', { name: 'New tab', exact: true }).click();
    const geo = await geometry(window);
    const clientX = geo.tabX + 300;
    const clientY = geo.stripBottom + 200;
    await pinCursor(electronApp, geo.originX + clientX, geo.originY + clientY);
    await dragTabTo(window, clientX, clientY);
    await expect.poll(() => visibleWindowCount(electronApp), { timeout: 5_000 }).toBe(2);

    await window.evaluate(() => {
      const tabs = document.querySelectorAll('.tab-bar__tab');
      const dataTransfer = new DataTransfer();
      dataTransfer.dropEffect = 'none';
      (tabs[tabs.length - 1] ?? document.body).dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
    });
    // The settle checks run for ~0.5s; the window must still be there after.
    await window.waitForTimeout(1_500);

    expect(await visibleWindowCount(electronApp)).toBe(2);
  });
});
