// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-19

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
  /** What a drag on the page does — see `PointerMode`. `'select'` (the page's own behavior) by default. */
  readonly pointerMode: PointerMode;
  /**
   * Edit mode: the toolbar tools' keyboard shortcuts are left to the page (see
   * `isToolShortcut`), for a web app that binds the same keys. The tools'
   * buttons still work.
   */
  readonly editMode: boolean;
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
  /** What a drag on the document does: `'pan'` moves it (the default), `'select'` selects its text and lets its links be clicked. */
  readonly pointerMode: PointerMode;
  readonly workspaceId: string;
}

/**
 * What a drag on a PDF, a note or a web page does: `'pan'` moves it like a
 * hand on paper (and a click does nothing), `'select'` selects its text and
 * lets its links take clicks.
 */
export type PointerMode = 'pan' | 'select';

/**
 * The browsing history: a table of the pages reached, rendered in its own
 * `WebContentsView` (`history.html`) — see `TabManager.createHistoryTab` and
 * `HistoryController`. No URL, favicon, or navigation state applies.
 */
export interface HistoryTabState {
  readonly kind: 'history';
  readonly id: string;
  readonly title: string;
  readonly workspaceId: string;
}

/**
 * A Markdown note, viewed rendered or edited as source in its own
 * `WebContentsView` (`markdown.html`) — see `TabManager.createMarkdownTab`
 * and `MarkdownController`. No URL or favicon applies; `title` is the open
 * file's name, or "Markdown" before one is opened.
 */
export interface MarkdownTabState {
  readonly kind: 'markdown';
  readonly id: string;
  readonly title: string;
  /** The open file's name (with its extension), or `null` before one is opened. Always editable in the chrome toolbar. */
  readonly fileName: string | null;
  /** The open file's full path on disk, or `null` before one is opened — what a Markdown bookmark saves. */
  readonly filePath: string | null;
  /** Whether the note can be changed: `'view'` is read-only, `'edit'` is editable. */
  readonly mode: 'view' | 'edit';
  /**
   * How the note is shown: `'formatted'` draws it (headings, emphasis, links),
   * `'raw'` shows its exact characters. Independent of `mode`: editing while
   * formatted edits the drawn note in place.
   */
  readonly display: MarkdownDisplay;
  /** Whether following a link has left an earlier note this tab can step back to. */
  readonly canGoBack: boolean;
  /** Whether stepping back has left a later note this tab can step forward to. */
  readonly canGoForward: boolean;
  /** What a drag on the note does — see `PointerMode`. `'select'` by default. */
  readonly pointerMode: PointerMode;
  readonly workspaceId: string;
}

/** A Markdown tab's display — see `MarkdownTabState.display`. */
export type MarkdownDisplay = 'formatted' | 'raw';

/** Everything the chrome UI needs to render one tab: browser, terminal, PDF, Markdown or history. */
export type TabState = BrowserTabState | TerminalTabState | PdfTabState | MarkdownTabState | HistoryTabState;

/** A named, colored group that a tab belongs to (see `WorkspaceBar`). */
export interface WorkspaceState {
  readonly id: string;
  readonly name: string;
  /** The color of the workspace's icon in the sidebar, as `#rrggbb`. */
  readonly color: string;
  /** Which `WorkspaceIconId` the sidebar draws for it. */
  readonly icon: string;
}

/**
 * A saved page, or a saved PDF or Markdown file on disk, persisted across
 * restarts by the main process. A file bookmark's `url` is the file's
 * `file://` URL (never navigable — a bookmark is only ever navigated to when
 * `kind` is `'page'`) and `path` is the file's location, which is what it's
 * matched and reopened by.
 */
export interface BookmarkState {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly kind: 'page' | 'pdf' | 'markdown';
  /** The file's path on disk; `null` for a page. */
  readonly path: string | null;
}

/**
 * A saved workspace image, as the chrome lists it: a workspace's name, color
 * and icon, and how many tabs it would open — the tabs themselves stay in
 * main (see `WorkspaceImageStore`). Opening one makes a new workspace with
 * those tabs, in order.
 */
export interface WorkspaceImageState {
  readonly id: string;
  readonly name: string;
  /** The workspace's icon color, as `#rrggbb`. */
  readonly color: string;
  /** Which `WorkspaceIconId` it draws. */
  readonly icon: string;
  /** How many tabs opening it creates. */
  readonly tabCount: number;
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
  /** The saved workspace images, in the order they were saved. */
  readonly workspaceImages: readonly WorkspaceImageState[];
  /**
   * For each workspace whose tabs are exactly those of a saved image (same
   * kinds, addresses and files, in the same order), that image's id — what
   * fills the sidebar's star. Adding, changing or reordering a tab takes a
   * workspace out of it, so it can be saved as a different image.
   */
  readonly savedWorkspaceImages: Readonly<Record<string, string>>;
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
  /** Whether this window's find bar (Ctrl+F) is open — see `FindOverlay`. */
  readonly findOpen: boolean;
  /** Whether the text box tool is currently on (Ctrl+E, or the toolbar button) — see `TextBoxController`. */
  readonly textToolActive: boolean;
  /** Whether the pen tool is currently on (Ctrl+P, or the toolbar button) — see `PenController`. */
  readonly penActive: boolean;
  /** Whether the PDF crop tool is currently on (Ctrl+Shift+X, or the toolbar button). */
  readonly cropActive: boolean;
}
