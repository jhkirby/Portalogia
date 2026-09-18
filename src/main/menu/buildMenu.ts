// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-12

import { Menu, type MenuItemConstructorOptions } from 'electron';
import type { TabManager } from '../browser/TabManager';

/**
 * Builds and installs the application menu. Menu actions call straight
 * into the active window's `TabManager` — main already owns it, so
 * there's no need to round-trip through IPC just to reach the renderer
 * and back. Accelerators are also the only reliable way to reach some of
 * these actions (e.g. "Search Tabs") from the keyboard: the renderer's own
 * chrome window can lose OS focus to whichever tab's `WebContentsView` the
 * user last clicked into, so a renderer-level `keydown` listener would
 * miss keystrokes; a menu accelerator fires regardless of which view has
 * focus.
 * @param getTabManager Resolves the frontmost window's tab manager at
 *   click time (not build time), since that window can change over the
 *   menu's life.
 * @param getActiveTabId Resolves that window's currently active tab, also
 *   at click time.
 */
export function buildMenu(
  getTabManager: () => TabManager | null,
  getActiveTabId: () => string | null,
): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+N',
          click: () => getTabManager()?.createTabAndFocusAddressBar(),
        },
        {
          // Not the conventional "Save" binding — deliberately repurposed
          // per product decision, since this app has nothing to save.
          label: 'New Terminal',
          accelerator: 'CmdOrCtrl+S',
          click: () => getTabManager()?.createTerminalTab(),
        },
        {
          label: 'Reopen Closed Tab',
          accelerator: 'CmdOrCtrl+T',
          click: () => getTabManager()?.restoreLastClosedTab(),
        },
        {
          // Same action as above under its more conventional accelerator
          // (most browsers use Shift+T for this, not plain T) — hidden so
          // the menu doesn't show two entries for one action; the
          // accelerator still registers regardless of visibility.
          label: 'Reopen Closed Tab',
          accelerator: 'CmdOrCtrl+Shift+T',
          visible: false,
          click: () => getTabManager()?.restoreLastClosedTab(),
        },
        {
          label: 'New Workspace',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => getTabManager()?.createWorkspace(),
        },
        {
          // Deliberately overrides the OS/Chromium "Select All" convention
          // at the user's explicit request — see the Edit menu below, which
          // omits the `selectAll` role entirely so Ctrl+A is free for this.
          // That trade-off means Select All has no keyboard shortcut left
          // anywhere in the app, chrome and page content alike.
          label: 'New Workspace',
          accelerator: 'CmdOrCtrl+A',
          visible: false,
          click: () => getTabManager()?.createWorkspace(),
        },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            const id = getActiveTabId();
            if (id) {
              getTabManager()?.closeTab(id);
            }
          },
        },
        {
          label: 'Close Workspace',
          accelerator: 'CmdOrCtrl+Shift+W',
          click: () => {
            const manager = getTabManager();
            if (manager) {
              manager.removeWorkspace(manager.getState().activeWorkspaceId);
            }
          },
        },
        {
          // Deliberately a harder-to-hit combo than Close Tab, so
          // reaching for the wrong "close" shortcut doesn't quit the app.
          label: 'Close Window',
          accelerator: 'CmdOrCtrl+Alt+W',
          click: () => getTabManager()?.closeWindow(),
        },
        { type: 'separator' },
        {
          label: 'Bookmark Page',
          accelerator: 'CmdOrCtrl+B',
          click: () => {
            const id = getActiveTabId();
            if (id) {
              getTabManager()?.toggleBookmark(id);
            }
          },
        },
        {
          label: 'Export Page to PDF…',
          click: () => {
            const id = getActiveTabId();
            if (id) {
              void getTabManager()?.exportToPdf(id);
            }
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      // Built manually rather than `role: 'editMenu'` specifically to
      // drop `selectAll` — that role always claims Ctrl+A, and the New
      // Workspace binding above needs it free.
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'delete' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Back',
          accelerator: 'Alt+Left',
          click: () => {
            const id = getActiveTabId();
            if (id) {
              getTabManager()?.goBack(id);
            }
          },
        },
        {
          label: 'Forward',
          accelerator: 'Alt+Right',
          click: () => {
            const id = getActiveTabId();
            if (id) {
              getTabManager()?.goForward(id);
            }
          },
        },
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            const id = getActiveTabId();
            if (id) {
              getTabManager()?.reload(id);
            }
          },
        },
        {
          label: 'Home',
          accelerator: 'CmdOrCtrl+H',
          click: () => {
            const id = getActiveTabId();
            if (id) {
              getTabManager()?.goHome(id);
            }
          },
        },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        {
          label: 'Search Tabs…',
          accelerator: 'CmdOrCtrl+K',
          click: () => getTabManager()?.requestTabSearch(),
        },
        {
          label: 'Focus Address Bar',
          accelerator: 'CmdOrCtrl+/',
          click: () => getTabManager()?.requestFocusAddressBar(),
        },
        {
          label: 'Toggle Focus Mode',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => getTabManager()?.toggleFocusMode(),
        },
        {
          label: 'Exit Split View',
          click: () => getTabManager()?.exitSplitView(),
        },
        { type: 'separator' },
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+L',
          click: () => getTabManager()?.toggleSidebar(),
        },
        { type: 'separator' },
        {
          label: 'Next Tab',
          accelerator: 'CmdOrCtrl+Right',
          click: () => getTabManager()?.cycleTab(1),
        },
        {
          label: 'Previous Tab',
          accelerator: 'CmdOrCtrl+Left',
          click: () => getTabManager()?.cycleTab(-1),
        },
        {
          label: 'Next Workspace',
          accelerator: 'CmdOrCtrl+Down',
          click: () => getTabManager()?.cycleWorkspace(1),
        },
        {
          label: 'Previous Workspace',
          accelerator: 'CmdOrCtrl+Up',
          click: () => getTabManager()?.cycleWorkspace(-1),
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      // Not `role: 'windowMenu'` — its non-macOS default submenu appends a
      // built-in "Close" item (role: 'close') that calls `window.close()`
      // directly. Confirmed via real keyboard/mouse input: with focus on
      // chrome UI outside any tab's own webContents (e.g. clicking a
      // workspace pill in the sidebar), that item's native accelerator
      // wins over "Close Tab" above and quits the whole app instead of
      // just closing a tab. Tab content itself was never affected, since
      // TabManager's `before-input-event` handler on each tab's webContents
      // consumes Ctrl+W first. Kept to `minimize`/`zoom` only, neither of
      // which carries a conflicting accelerator.
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
