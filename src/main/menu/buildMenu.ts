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
 * @param onNewWindow Opens a brand-new window, seeded with its own new
 *   workspace (and that workspace's fresh home tab) rather than the
 *   restored session `launchWindow`'s default `onReady` would otherwise
 *   give it — see "New Window" below.
 * @param onOpenWorkspaceInNewWindow Opens an independent, navigation-linked
 *   twin of the frontmost window's active tab in a brand-new window, leaving
 *   that tab (and everything else about the frontmost window) untouched —
 *   see "Open Tab in New Window" below.
 */
export function buildMenu(
  getTabManager: () => TabManager | null,
  getActiveTabId: () => string | null,
  onNewWindow: () => void,
  onOpenWorkspaceInNewWindow: () => void,
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
          // Its own window entirely, not just a workspace in the current
          // one — a new workspace's fresh home tab (`createWorkspace`)
          // seeded into a new window (`onNewWindow`), rather than the
          // current window's shared workspace list.
          label: 'New Window',
          accelerator: 'CmdOrCtrl+Alt+N',
          click: () => onNewWindow(),
        },
        {
          label: 'Open Tab in New Window',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => onOpenWorkspaceInNewWindow(),
        },
        {
          label: 'New Terminal',
          accelerator: 'CmdOrCtrl+>',
          click: () => getTabManager()?.createTerminalTab(),
        },
        {
          label: 'New PDF Viewer',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => getTabManager()?.createPdfTab(),
        },
        {
          // Does nothing unless the active tab is a PDF viewer (`openPdfFile` ignores other tabs).
          label: 'Open PDF',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            const id = getActiveTabId();
            if (id) {
              void getTabManager()?.openPdfFile(id);
            }
          },
        },
        {
          label: 'Duplicate Tab',
          accelerator: 'CmdOrCtrl+Shift+D',
          click: () => {
            const id = getActiveTabId();
            if (id) {
              getTabManager()?.duplicateTab(id);
            }
          },
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
          // Same action as the visible entry above, under a second
          // accelerator — hidden so the menu doesn't show two entries for
          // one action; the accelerator still registers regardless of
          // visibility.
          label: 'New Workspace',
          accelerator: 'CmdOrCtrl+Q',
          visible: false,
          click: () => getTabManager()?.createWorkspace(),
        },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            const id = getActiveTabId();
            if (id) {
              getTabManager()?.closeSelectionOrTab(id);
            }
          },
        },
        {
          label: 'Close All Tabs',
          accelerator: 'CmdOrCtrl+Shift+W',
          click: () => getTabManager()?.closeAllTabs(),
        },
        {
          // Deliberately a harder-to-hit combo than Close Tab, so
          // reaching for the wrong "close" shortcut doesn't quit the app —
          // `removeWorkspace` itself refuses to act on the last remaining
          // workspace, so this can never close the window either.
          label: 'Close Workspace',
          accelerator: 'CmdOrCtrl+Alt+W',
          click: () => {
            const tabManager = getTabManager();
            tabManager?.removeSelectionOrActiveWorkspace();
          },
        },
        {
          label: 'Close All Workspaces',
          accelerator: 'CmdOrCtrl+Shift+Alt+W',
          click: () => getTabManager()?.closeAllWorkspaces(),
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
        // Deliberately no Quit item, and no `role: 'quit'` anywhere in this
        // menu — that role carries an automatic default accelerator
        // (CmdOrCtrl+Q) even when none is set explicitly, which collided
        // with "New Workspace" above once that moved onto Ctrl+Q. Quitting
        // is disabled outright (see MainWindow.ts's 'close' handler), so an
        // item that could never do anything would just be dead UI.
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'delete' },
        { role: 'selectAll' },
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
          label: 'Toggle Laser Pointer',
          accelerator: 'CmdOrCtrl+I',
          click: () => getTabManager()?.toggleLaserPointer(),
        },
        {
          label: 'Toggle Pen',
          accelerator: 'CmdOrCtrl+P',
          click: () => getTabManager()?.togglePen(),
        },
        {
          label: 'Toggle Highlighter',
          accelerator: 'CmdOrCtrl+J',
          click: () => getTabManager()?.toggleHighlighter(),
        },
        {
          label: 'Toggle Comments',
          accelerator: 'CmdOrCtrl+M',
          click: () => getTabManager()?.toggleCommentTool(),
        },
        {
          label: 'Revert Annotations',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => {
            const id = getActiveTabId();
            if (id) {
              getTabManager()?.revertPage(id);
            }
          },
        },
        {
          label: 'Toggle Theme',
          accelerator: 'CmdOrCtrl+D',
          click: () => getTabManager()?.requestToggleTheme(),
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
        {
          // Deliberately not `role: 'resetZoom'`/`'zoomIn'`/`'zoomOut'` —
          // those built-in roles zoom `browserWindow.webContents`, the
          // chrome's own top-level page (sidebar, tab strip, toolbar and
          // all), not the active tab's content. `TabManager.zoomIn` etc.
          // zoom that tab's own `WebContentsView` instead, leaving the
          // chrome at native size.
          label: 'Actual Size',
          accelerator: 'CmdOrCtrl+0',
          click: () => getTabManager()?.resetZoom(),
        },
        {
          label: 'Zoom In',
          // Plain '=' rather than 'Plus' — 'Plus' matches only the
          // Shift-held report of the key on most layouts, which is why
          // this used to require Ctrl+Shift+= instead of just Ctrl+=.
          accelerator: 'CmdOrCtrl+=',
          click: () => getTabManager()?.zoomIn(),
        },
        {
          // Same action under the accelerator some keyboard layouts need
          // Shift to actually produce '+' on — hidden so the menu doesn't
          // show two entries for one action.
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+Shift+=',
          visible: false,
          click: () => getTabManager()?.zoomIn(),
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => getTabManager()?.zoomOut(),
        },
        {
          label: 'Focus Zoom',
          accelerator: 'CmdOrCtrl+Shift+0',
          click: () => getTabManager()?.requestFocusZoom(),
        },
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
