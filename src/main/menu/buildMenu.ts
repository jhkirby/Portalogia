// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-21

import { BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';
import type { AdBlocker } from '../adblock/AdBlocker';
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
 * @param adBlocker The app-wide ad blocker, for the View menu's on/off switch.
 */
export function buildMenu(
  getTabManager: () => TabManager | null,
  getActiveTabId: () => string | null,
  onNewWindow: () => void,
  onOpenWorkspaceInNewWindow: () => void,
  adBlocker: AdBlocker,
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
          label: 'New Markdown Tab',
          accelerator: 'CmdOrCtrl+Shift+M',
          click: () => getTabManager()?.createMarkdownTab(),
        },
        {
          // Does nothing unless the active tab is a Markdown note.
          label: 'Toggle Note View/Edit',
          accelerator: 'CmdOrCtrl+Shift+G',
          click: () => {
            const id = getActiveTabId();
            if (id) {
              getTabManager()?.toggleMarkdownMode(id);
            }
          },
        },
        {
          // The toolbar's Close button: does nothing unless the active tab is a PDF or Markdown tab with a file open.
          label: 'Close Open PDF or Note',
          accelerator: 'CmdOrCtrl+Shift+C',
          click: () => {
            const id = getActiveTabId();
            if (id) {
              getTabManager()?.closePdfFile(id);
              getTabManager()?.closeMarkdownFile(id);
            }
          },
        },
        {
          label: 'New History Tab',
          accelerator: 'CmdOrCtrl+Shift+H',
          click: () => getTabManager()?.createHistoryTab(),
        },
        {
          label: 'New Bookmarks Tab',
          click: () => getTabManager()?.createBookmarksTab(),
        },
        {
          label: 'New Secrets Tab',
          click: () => getTabManager()?.createSecretsTab(),
        },
        {
          // Opens what the active tab shows: a PDF, a note, or a web page saved on the computer (each ignores the
          // others' kinds).
          label: 'Open File',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            const id = getActiveTabId();
            if (id) {
              void getTabManager()?.openPdfFile(id);
              void getTabManager()?.openMarkdownFile(id);
              void getTabManager()?.openLocalPage(id);
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
      // A note's formatting, while it's being edited (a no-op otherwise). Display only: the keys reach the note through
      // `TabManager` (`toggleBookmark`'s Ctrl+B, `handleMarkdownFormatShortcut`…), so they stay free everywhere else.
      label: 'Format',
      submenu: (
        [
          ['Bold', 'CmdOrCtrl+B', 'bold'],
          ['Italic', 'CmdOrCtrl+I', 'italic'],
          ['Highlight', null, 'highlight'],
          ['Inline Code', null, 'inlineCode'],
          ['Make a Link…', 'CmdOrCtrl+Shift+U', 'link'],
          null,
          ['Normal Text', 'CmdOrCtrl+Alt+0', 'heading0'],
          ['Heading 1', 'CmdOrCtrl+Alt+1', 'heading1'],
          ['Heading 2', 'CmdOrCtrl+Alt+2', 'heading2'],
          ['Heading 3', 'CmdOrCtrl+Alt+3', 'heading3'],
          ['Heading 4', 'CmdOrCtrl+Alt+4', 'heading4'],
          ['Heading 5', 'CmdOrCtrl+Alt+5', 'heading5'],
          ['Heading 6', 'CmdOrCtrl+Alt+6', 'heading6'],
          null,
          ['Numbered List', 'CmdOrCtrl+Shift+7', 'orderedList'],
          ['Bulleted List', 'CmdOrCtrl+Shift+8', 'bulletList'],
          ['Checklist', 'CmdOrCtrl+Shift+9', 'taskList'],
          null,
          ['Callout…', 'CmdOrCtrl+Alt+C', 'callout'],
          ['Divider', 'CmdOrCtrl+Alt+D', 'divider'],
          ['Code Block', 'CmdOrCtrl+Shift+K', 'code'],
          ['LaTeX Block', 'CmdOrCtrl+Shift+L', 'latex'],
          ['Table…', null, 'table'],
          ['Picture…', 'CmdOrCtrl+Alt+I', 'image'],
          ['Raw HTML', 'CmdOrCtrl+Alt+H', 'html'],
        ] as const
      ).map((entry): MenuItemConstructorOptions =>
        entry === null
          ? { type: 'separator' }
          : {
              label: entry[0],
              ...(entry[1] === null ? {} : { accelerator: entry[1], registerAccelerator: false }),
              click: () => {
                const id = getActiveTabId();
                if (id) {
                  getTabManager()?.applyMarkdownFormat(id, entry[2]);
                }
              },
            },
      ),
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Back',
          accelerator: 'Alt+Left',
          // Display only, like Next Tab below: a text box edits with this key, so `TabManager` dispatches it
          // (standing aside while the caret is in one) instead of the menu.
          registerAccelerator: false,
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
          registerAccelerator: false,
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
          label: 'Edit Workspace…',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => getTabManager()?.requestEditWorkspace(),
        },
        {
          label: 'Workspace Images…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => getTabManager()?.requestWorkspaceImages(),
        },
        {
          label: 'Search Tabs…',
          accelerator: 'CmdOrCtrl+K',
          click: () => getTabManager()?.requestTabSearch(),
        },
        {
          label: 'Ad Blocker',
          type: 'checkbox',
          checked: adBlocker.getState().enabled,
          click: (item) => adBlocker.setEnabled(item.checked),
        },
        {
          label: 'Toggle Ad Blocker for This Site',
          accelerator: 'CmdOrCtrl+Shift+B',
          click: () => {
            const state = getTabManager()?.getState();
            const tab = state?.tabs.find((candidate) => candidate.id === state.activeTabId);
            if (tab?.kind !== 'browser') {
              return;
            }
            let host = '';
            try {
              host = new URL(tab.url).hostname;
            } catch {
              return;
            }
            if (host) {
              adBlocker.setSiteAllowed(host, !adBlocker.getState().allowedSites.includes(host));
            }
          },
        },
        {
          label: 'Find',
          accelerator: 'CmdOrCtrl+F',
          click: () => getTabManager()?.openFind(),
        },
        {
          label: 'Focus Address Bar',
          accelerator: 'CmdOrCtrl+/',
          // Display only, like Next Tab below: the note editor binds this key, so `TabManager` dispatches it
          // (standing aside while the caret is in one) instead of the menu.
          registerAccelerator: false,
          click: () => getTabManager()?.requestFocusAddressBar(),
        },
        {
          label: 'Toggle Focus Mode',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => getTabManager()?.toggleFocusMode(),
        },
        {
          label: 'Toggle Side Panel',
          accelerator: 'CmdOrCtrl+Alt+B',
          click: () => getTabManager()?.toggleSidePanel(),
        },
        {
          label: 'Edit PDF Sections',
          accelerator: 'CmdOrCtrl+Alt+E',
          click: () => getTabManager()?.toggleSectionEditing(),
        },
        // The tools' entries below are display only: `TabManager.handleToolShortcut` dispatches their keys from the
        // chrome, so that a page with the keyboard gets them (a web app's own Ctrl+I, P, E…) — a registered
        // accelerator would take its key before any page saw it.
        {
          label: 'Pan Tool',
          accelerator: 'Alt+1',
          registerAccelerator: false,
          click: () => getTabManager()?.setActivePointerMode('pan'),
        },
        {
          label: 'Select Tool',
          accelerator: 'Alt+2',
          registerAccelerator: false,
          click: () => getTabManager()?.setActivePointerMode('select'),
        },
        {
          label: 'Toggle Laser Pointer',
          accelerator: 'CmdOrCtrl+I',
          registerAccelerator: false,
          click: () => getTabManager()?.toggleLaserPointer(),
        },
        {
          label: 'Toggle Pen',
          accelerator: 'CmdOrCtrl+P',
          registerAccelerator: false,
          click: () => getTabManager()?.togglePen(),
        },
        {
          label: 'Toggle Highlighter',
          accelerator: 'CmdOrCtrl+J',
          registerAccelerator: false,
          click: () => getTabManager()?.toggleHighlighter(),
        },
        {
          label: 'Toggle Comments',
          accelerator: 'CmdOrCtrl+M',
          registerAccelerator: false,
          click: () => getTabManager()?.toggleCommentTool(),
        },
        {
          label: 'Toggle Text Box',
          accelerator: 'CmdOrCtrl+E',
          registerAccelerator: false,
          click: () => getTabManager()?.toggleTextTool(),
        },
        {
          label: 'Toggle Crop',
          accelerator: 'CmdOrCtrl+Shift+X',
          registerAccelerator: false,
          click: () => getTabManager()?.toggleCrop(),
        },
        {
          label: 'Revert Annotations',
          accelerator: 'CmdOrCtrl+Shift+R',
          registerAccelerator: false,
          // Confirmed first, as the Tools sidebar's Revert is: the chrome asks for "REVERT" to be typed.
          click: () => getTabManager()?.requestRevert(),
        },
        {
          label: 'Toggle Theme',
          accelerator: 'CmdOrCtrl+D',
          click: () => getTabManager()?.requestToggleTheme(),
        },
        {
          // The two selected tabs side by side, or back to one; the key itself is handled in `handleWindowShortcut`.
          label: 'Split Screen',
          accelerator: 'CmdOrCtrl+Alt+S',
          registerAccelerator: false,
          click: () => getTabManager()?.toggleSplitScreen(),
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
          // Display only: Ctrl+Left/Right also jumps a word in a text box, so `TabManager`'s own key handling
          // (which can tell when the caret is in one) does the switching instead of the menu.
          registerAccelerator: false,
          click: () => getTabManager()?.cycleTab(1),
        },
        {
          label: 'Previous Tab',
          accelerator: 'CmdOrCtrl+Left',
          registerAccelerator: false,
          click: () => getTabManager()?.cycleTab(-1),
        },
        {
          label: 'Next Workspace',
          accelerator: 'CmdOrCtrl+Down',
          // Display only, like Next Tab below: a text box edits with this key, so `TabManager` dispatches it
          // (standing aside while the caret is in one) instead of the menu.
          registerAccelerator: false,
          click: () => getTabManager()?.cycleWorkspace(1),
        },
        {
          label: 'Previous Workspace',
          accelerator: 'CmdOrCtrl+Up',
          registerAccelerator: false,
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
      // The three window-control buttons' own commands (see `WindowControls`), so
      // each has a keyboard command as well as its button.
      // Not `role: 'windowMenu'` — its non-macOS default submenu appends a
      // built-in "Close" item (role: 'close') that calls `window.close()`
      // directly. Confirmed via real keyboard/mouse input: with focus on
      // chrome UI outside any tab's own webContents (e.g. clicking a
      // workspace pill in the sidebar), that item's native accelerator
      // wins over "Close Tab" above and quits the whole app instead of
      // just closing a tab. Tab content itself was never affected, since
      // TabManager's `before-input-event` handler on each tab's webContents
      // consumes Ctrl+W first. So the items here are explicit, with their own
      // accelerators, and "Close Window" is only reachable by Alt+F4, which
      // Windows already handles for the window itself (`registerAccelerator:
      // false` just shows the hint here and doesn't register a second handler).
      label: 'Window',
      submenu: [
        {
          label: 'Minimize',
          accelerator: 'CmdOrCtrl+Alt+M',
          click: () => BrowserWindow.getFocusedWindow()?.minimize(),
        },
        {
          label: 'Maximize / Restore',
          accelerator: 'CmdOrCtrl+Alt+Return',
          click: () => {
            const window = BrowserWindow.getFocusedWindow();
            if (window?.isMaximized()) {
              window.unmaximize();
            } else {
              window?.maximize();
            }
          },
        },
        {
          label: 'Close Window',
          accelerator: 'Alt+F4',
          registerAccelerator: false,
          click: () => BrowserWindow.getFocusedWindow()?.close(),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
