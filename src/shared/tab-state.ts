// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-04

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

/**
 * A PDF viewer/editor, rendered with pdf.js in its own `WebContentsView`
 * (`pdf.html`) — see `TabManager.createPdfTab`. No URL, favicon, or
 * navigation state applies; `title` is the open file's name, or "PDF"
 * before one is opened.
 */
export interface PdfTabState {
  readonly kind: 'pdf';
  readonly id: string;
  readonly title: string;
  /** The open file's name, or `null` before one is opened. Always editable in the chrome toolbar. */
  readonly fileName: string | null;
  /** The open file's full path on disk, or `null` before one is opened — what a PDF bookmark saves. */
  readonly filePath: string | null;
  /** The 1-based page in view; meaningless while `pageCount` is 0. */
  readonly page: number;
  /** Pages in the open document, 0 before one is opened. */
  readonly pageCount: number;
  readonly workspaceId: string;
}

/** Everything the chrome UI needs to render one tab, browser, terminal or PDF. */
export type TabState = BrowserTabState | TerminalTabState | PdfTabState;

/** A named, colored group that a tab belongs to (see `WorkspaceBar`). */
export interface WorkspaceState {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

/**
 * A saved page, or a saved PDF file on disk, persisted across restarts by the
 * main process. A PDF bookmark's `url` is the file's `file://` URL (never
 * navigable — a bookmark is only ever navigated to when `kind` is `'page'`)
 * and `path` is the file's location, which is what it's matched and reopened by.
 */
export interface BookmarkState {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly kind: 'page' | 'pdf';
  /** The PDF's path on disk; `null` for a page. */
  readonly path: string | null;
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
  /**
   * The tabs multi-selected with Ctrl/Shift+click, active tab included — empty
   * unless two or more are selected. Joint operations (drag out, drag into a
   * workspace, Ctrl+W) act on all of them. Window-local, like `activeTabId`.
   */
  readonly selectedTabIds: readonly string[];
  /** The workspaces multi-selected with Ctrl/Shift+click, active one included — empty unless two or more are selected. Ctrl+Alt+W removes them all. */
  readonly selectedWorkspaceIds: readonly string[];
  /** The active tab's own zoom, as a whole percent (25–200, 100 = native size) — never the chrome's, which is never zoomed. */
  readonly zoomPercent: number;
  /** Whether the laser pointer overlay is currently on (Ctrl+I, or the toolbar button) — see `LaserPointerOverlay`. */
  readonly laserPointerActive: boolean;
  /** Whether the highlighter tool is currently on (Ctrl+J, or the toolbar button) — see `HighlighterController`. */
  readonly highlighterActive: boolean;
  /** Whether the comment tool is currently on (Ctrl+M, or the toolbar button) — see `CommentController`. */
  readonly commentToolActive: boolean;
  /** Whether the text box tool is currently on (Ctrl+E, or the toolbar button) — see `TextBoxController`. */
  readonly textToolActive: boolean;
  /** Whether the pen tool is currently on (Ctrl+P, or the toolbar button) — see `PenController`. */
  readonly penActive: boolean;
  /** Whether the PDF crop tool is currently on (Ctrl+Shift+X, or the toolbar button). */
  readonly cropActive: boolean;
}
