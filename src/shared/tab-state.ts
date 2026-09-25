// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-12

/** A page loaded in a `WebContentsView`, same as every tab before terminal tabs existed. */
export interface BrowserTabState {
  readonly kind: 'browser';
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly isLoading: boolean;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly favicon: string | null;
  /** The workspace this tab belongs to; only its own workspace's tab row shows it. */
  readonly workspaceId: string;
}

/**
 * A shell session backed by a `node-pty` process in the main process and
 * rendered with `xterm.js` in its own `WebContentsView` (`terminal.html`),
 * same as a browser tab's page — see `TerminalManager` and
 * `TabManager.createTerminalTab`. No URL, favicon, or navigation state
 * applies.
 */
export interface TerminalTabState {
  readonly kind: 'terminal';
  readonly id: string;
  readonly title: string;
  /** Whether the underlying shell process has exited (e.g. the user typed `exit`). */
  readonly exited: boolean;
  readonly workspaceId: string;
}

/** Everything the chrome UI needs to render one tab, browser or terminal. */
export type TabState = BrowserTabState | TerminalTabState;

/** A named, colored group that a tab belongs to (see `WorkspaceBar`). */
export interface WorkspaceState {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

/** A saved page, persisted across restarts by the main process. */
export interface BookmarkState {
  readonly id: string;
  readonly title: string;
  readonly url: string;
}

/** The pair of tabs shown side by side when split view is active. */
export interface SplitViewState {
  readonly primaryTabId: string;
  readonly secondaryTabId: string;
}

/** The full set of tabs plus which one is on screen. */
export interface BrowserState {
  readonly tabs: readonly TabState[];
  readonly activeTabId: string | null;
  readonly workspaces: readonly WorkspaceState[];
  readonly activeWorkspaceId: string;
  readonly bookmarks: readonly BookmarkState[];
  readonly splitView: SplitViewState | null;
  readonly focusMode: boolean;
  /** Whether the workspace sidebar is currently shown (toggled via Ctrl+L). */
  readonly sidebarVisible: boolean;
  /** The tab currently grabbed for keyboard reordering (Ctrl+Space held, then Left/Right to nudge it) — `null` when nothing is grabbed. */
  readonly grabbedTabId: string | null;
  /** The active tab's own zoom, as a whole percent (25–200, 100 = native size) — never the chrome's, which is never zoomed. */
  readonly zoomPercent: number;
  /** Whether the laser pointer overlay is currently on (Ctrl+I, or the toolbar button) — see `LaserPointerOverlay`. */
  readonly laserPointerActive: boolean;
}
