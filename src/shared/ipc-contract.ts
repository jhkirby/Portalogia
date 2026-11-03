// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import type { RGB } from '@shared/color';
import type { FindOptions } from '@shared/find';
import type { MarkdownAnnotations, PdfAnnotations } from '@shared/ipc-schemas';
import type { BookmarkState, BrowserState, MarkdownDisplay, PointerMode } from '@shared/tab-state';

/**
 * Every IPC channel name in the app, enumerated once. Both main and
 * preload import this instead of typing channel strings by hand, so a typo
 * is a compile error instead of a silently-dead handler.
 */
export const IpcChannel = {
  TabsCreate: 'tabs:create',
  TabsClose: 'tabs:close',
  TabsActivate: 'tabs:activate',
  TabsToggleSelect: 'tabs:toggle-select',
  TabsSelectRange: 'tabs:select-range',
  TabsMove: 'tabs:move',
  TabsMoveToWorkspace: 'tabs:move-to-workspace',
  TabsTearOff: 'tabs:tear-off',
  TabsTearOffEnd: 'tabs:tear-off-end',
  TabsDropRegions: 'tabs:drop-regions',
  TabsNavigate: 'tabs:navigate',
  TabsGoBack: 'tabs:go-back',
  TabsGoForward: 'tabs:go-forward',
  TabsReload: 'tabs:reload',
  TabsStop: 'tabs:stop',
  TabsGetState: 'tabs:get-state',
  TabsStateChanged: 'tabs:state-changed',
  TabsExportPdf: 'tabs:export-pdf',
  TabsCreateTerminal: 'tabs:create-terminal',
  TabsCreatePdf: 'tabs:create-pdf',
  TabsCreateHistory: 'tabs:create-history',
  TabsCreateBookmarks: 'tabs:create-bookmarks',
  TabsCreateSecrets: 'tabs:create-secrets',
  TabsCreateMarkdown: 'tabs:create-markdown',
  /** Chrome → main: open or close this window's find bar. */
  FindSet: 'find:set',
  /** Main → tab page (browser, PDF or terminal): search, step, jump to an occurrence, or clear the highlights. */
  FindCommand: 'find:command',
  /** Tab page → main: how many matches there are and which is current. */
  FindResult: 'find:result',
  /** Main → find bar: what it shows — the query, the switches, the count. */
  FindState: 'find:state',
  /** Main → find bar: take the keyboard and select the query (Ctrl+F while it's open). */
  FindFocus: 'find:focus',
  /** Find bar → main: the query or a switch changed. */
  FindInput: 'find:input',
  /** Find bar → main: jump to the next or previous match. */
  FindStep: 'find:step',
  /** Find bar → main: jump to a typed occurrence number. */
  FindGoto: 'find:goto',
  /** Find bar → main: close the bar. */
  FindClose: 'find:close',
  /** Main → history page: every recorded visit, newest first. */
  HistoryEntries: 'history:entries',
  /** History page → main: delete one visit. */
  HistoryDelete: 'history:delete',
  /** Chrome → main: the most recent distinct pages (or PDFs) from the history matching a search, for the search bars' dropdowns. */
  HistorySearch: 'history:search',
  /** Chrome → main: how many visits a range covers (Clear History's confirmation). */
  HistoryCount: 'history:count',
  /** Main → chrome: the history changed (a visit recorded or deleted), so a count of it may be stale. */
  HistoryChanged: 'history:changed',
  /** Chrome → main: open a PDF from the history (picked from the PDF search's dropdown) in this tab. */
  PdfOpenPath: 'pdf:open-path',
  /** History page → main: copy one visit's stored URL (or PDF path) to the clipboard. */
  HistoryCopy: 'history:copy',
  /** History page → main: open one visit's stored route (a page, PDF or note) in a new tab. */
  HistoryOpenInNewTab: 'history:open-in-new-tab',
  /** Main → history page: the bookmark names the table's Bookmark column looks routes up in. */
  HistoryBookmarks: 'history:bookmarks',
  /** Chrome → main: clear the visits within a time range (or all of them). */
  HistoryClear: 'history:clear',
  /** Chrome → main: the History toolbar's search text for a History tab. */
  HistorySetQuery: 'history:set-query',
  /** Main → history page: the search text to filter the table by. */
  HistoryQuery: 'history:query',
  /** Chrome → main: the time range (the toolbar's number and unit) a History tab's table shows. */
  HistorySetRange: 'history:set-range',
  /** Main → history page: the time range to show. */
  HistoryRange: 'history:range',
  /** Chrome → main: the Bookmarks toolbar's search text for a Bookmarks tab. */
  BookmarksSetQuery: 'bookmarks:set-query',
  /** Chrome → main: switch a Bookmarks tab between viewing and editing. */
  BookmarksSetMode: 'bookmarks:set-mode',
  /** Main → bookmarks page: every saved bookmark, in the order they were added. */
  BookmarksPageList: 'bookmarks-page:list',
  /** Main → bookmarks page: the search text to filter the table by. */
  BookmarksPageQuery: 'bookmarks-page:query',
  /** Main → bookmarks page: whether the table is being viewed or edited. */
  BookmarksPageMode: 'bookmarks-page:mode',
  /** Bookmarks page → main: rename and/or re-point one bookmark; answers whether it was kept. */
  BookmarksPageUpdate: 'bookmarks-page:update',
  /** Bookmarks page → main: delete one bookmark. */
  BookmarksPageDelete: 'bookmarks-page:delete',
  /** Bookmarks page → main: open one bookmark in a new tab of its kind. */
  BookmarksPageOpen: 'bookmarks-page:open',
  /** Bookmarks page → main: copy one bookmark's stored URL (or file path) to the clipboard. */
  BookmarksPageCopy: 'bookmarks-page:copy',
  /** Chrome → main: the Secrets toolbar's search text for a Secrets tab. */
  SecretsSetQuery: 'secrets:set-query',
  /** Chrome → main: switch a Secrets tab between viewing and editing. */
  SecretsSetMode: 'secrets:set-mode',
  /** Chrome → main: the toolbar's Add button — start a new, empty row in a Secrets tab's table. */
  SecretsAddRow: 'secrets:add-row',
  /** Main → secrets page: put a new, empty row at the top of the table to type a secret into. */
  SecretsPageAddRow: 'secrets-page:add-row',
  /** Secrets page → main: keep a secret typed in by hand; answers whether it was kept. */
  SecretsPageAdd: 'secrets-page:add',
  /** Main → secrets page: every saved secret, in the order they were saved. */
  SecretsPageList: 'secrets-page:list',
  /** Main → secrets page: the search text to filter the table by. */
  SecretsPageQuery: 'secrets-page:query',
  /** Main → secrets page: whether the table is being viewed or edited. */
  SecretsPageMode: 'secrets-page:mode',
  /** Secrets page → main: rename, re-point and/or change one secret; answers whether it was kept. */
  SecretsPageUpdate: 'secrets-page:update',
  /** Secrets page → main: delete one secret. */
  SecretsPageDelete: 'secrets-page:delete',
  /** Secrets page → main: copy one secret's stored value to the clipboard. */
  SecretsPageCopy: 'secrets-page:copy',
  /** Web page → main: a login was just sent (a username and/or password typed in), to offer saving. */
  TabSecretsCaptured: 'tab-secrets:captured',
  /** Main → web page: the saved secrets for this page's site, to fill into their elements. */
  TabSecretsFill: 'tab-secrets:fill',
  /** Main → save prompt: what to offer saving, or `null` to clear. */
  SecretPromptShow: 'secret-prompt:show',
  /** Save prompt → main: the answer — save under these names, or not. */
  SecretPromptAnswer: 'secret-prompt:answer',
  /** Save prompt → main: how tall its card is, so its view is sized to it and covers no more of the page. */
  SecretPromptHeight: 'secret-prompt:height',
  PdfOpenFile: 'pdf:open-file',
  PdfRename: 'pdf:rename',
  /** PDF page → main: the marks drawn on the open document, to persist. */
  PdfSaveAnnotations: 'pdf:save-annotations',
  /** Main → PDF page: remove every mark (Revert Annotations). */
  PdfClear: 'pdf:clear',
  /** Main → PDF page: Ctrl+Z while a mark-making tool is on. */
  PdfUndo: 'pdf:undo',
  /** Main → PDF page: Ctrl+Y while a mark-making tool is on. */
  PdfRedo: 'pdf:redo',
  /** Chrome → main: close the tab's open PDF (the tab stays, empty). */
  PdfCloseFile: 'pdf:close-file',
  PdfDeleteFile: 'pdf:delete-file',
  /** Main → PDF page: the open file was closed; show the empty page. */
  PdfClosed: 'pdf:closed',
  /** Main → PDF page: the file the user just opened. */
  PdfFile: 'pdf:file',
  /** PDF page → main: which page is in view, and how many there are. */
  PdfPageInfo: 'pdf:page-info',
  /** PDF page → main: how far it has got reading the file it was sent (its pages measured), for the file bar. */
  PdfLoadProgress: 'pdf:load-progress',
  /** Chrome → main: open a bookmarked PDF in this tab (picked from the toolbar's PDF search). */
  PdfOpenBookmark: 'pdf:open-bookmark',
  /** Chrome → main: save a copy of the tab's PDF with its crop boxes applied. */
  PdfExport: 'pdf:export',
  /** Chrome → main: turn the crop tool on or off for this window. */
  CropSet: 'crop:set',
  /** Main → PDF page: whether the crop tool is on. */
  PdfCropState: 'pdf:crop-state',
  /** Chrome → main: jump the tab's PDF to a page. */
  PdfGoToPage: 'pdf:go-to-page',
  /** Main → PDF page: scroll to this 1-based page. */
  PdfScrollToPage: 'pdf:scroll-to-page',
  /** Chrome → main: switch a PDF, Markdown or browser tab between panning and selecting. */
  TabsSetPointerMode: 'tabs:set-pointer-mode',
  /** Chrome → main: turn a browser tab's edit mode on or off (its tool shortcuts go to the page). */
  TabsToggleEditMode: 'tabs:toggle-edit-mode',
  /** Main → browser tab's page: its pointer mode, and whether a tool has the pointer instead. */
  TabPointerMode: 'tab:pointer-mode',
  /** Main → browser tab's page: Shift+Escape was pressed; take the caret out of any text box. */
  TabLeaveTextBox: 'tab:leave-text-box',
  /** Browser or Markdown tab's page → main: a looping pan reached an edge; move the real pointer here. */
  TabWarpPointer: 'tab:warp-pointer',
  /** Main → Markdown page: the tab's pointer mode. */
  MarkdownPointerMode: 'markdown:pointer-mode',
  /** Main → PDF page: the tab's pointer mode (`'pan'` or `'select'`). */
  PdfPointerMode: 'pdf:pointer-mode',
  /** PDF page → main: a web link in the document was clicked; open it in a new tab. */
  PdfOpenLink: 'pdf:open-link',
  /** PDF page → main (invoke): the notes that link to the open PDF, for its side panel. */
  PdfBacklinks: 'pdf:backlinks',
  /** PDF page → main: open one of those notes (a `target` the last `PdfBacklinks` reply gave) in a new tab. */
  PdfOpenBacklink: 'pdf:open-backlink',
  /** Main → tab's page: where the pointer is over it (its CSS pixels), or `null`, while the laser overlay hides it from the page. */
  TabPointerPosition: 'tab:pointer-position',
  /** Tab's page → main (sync), before its first paint: whether to start out blurred, having come from another site. */
  TabLoadBlur: 'tab:load-blur',
  /** Tab's page → main (sync): the accent, as `RGB` — for the new-tab page's fluid. */
  TabAccent: 'tab:accent',
  /** Main → tab's page: the accent changed (`RGB`) — the new-tab page's fluid recolours itself. */
  TabAccentChanged: 'tab:accent-changed',
  /** Browser tab's page → main: its words, characters, images, links and elements, hovered element and selection. */
  TabPageStats: 'tab:page-stats',
  /** A note's, PDF's or terminal's page: what its own stat bar shows, item by item, for the chrome's bar in split screen. */
  TabStatItems: 'tab:stat-items',
  /** Main → chrome: the active web page's stats changed (or another page became the active one). */
  PageStatsChanged: 'page-stats:changed',
  /** Main → note or PDF page: whether this window is in Focus Mode (the page then hides its stat bar). */
  TabFocusMode: 'tab:focus-mode',
  /** Main → note or PDF page: show or hide the side panel (Ctrl+Alt+B). */
  TabToggleSidePanel: 'tab:toggle-side-panel',
  /** Main → PDF page: switch editing its sections in the side panel (Ctrl+Alt+E). */
  PdfToggleSectionEditing: 'pdf:toggle-section-editing',
  /** PDF page → main: whether its jump history has somewhere to step back or forward to. */
  PdfHistoryInfo: 'pdf:history-info',
  /** Main → PDF page: step back (-1) or forward (1) through its jump history. */
  PdfHistoryGo: 'pdf:history-go',
  /** PDF page → main: a looping pan ended; put the real pointer where the page's stand-in hand was. */
  PdfWarpPointer: 'pdf:warp-pointer',
  /** Chrome → main: pick a Markdown file to open in this tab. */
  MarkdownOpenFile: 'markdown:open-file',
  /** Chrome → main: pick where to create a new Markdown note, and open it in this tab. */
  MarkdownNewFile: 'markdown:new-file',
  /** Chrome → main: close the tab's open note (the tab stays, empty). */
  MarkdownCloseFile: 'markdown:close-file',
  /** Chrome → main: delete the tab's open note (to the Recycle Bin), once the chrome's popup has confirmed it. */
  MarkdownDeleteFile: 'markdown:delete-file',
  /** Chrome → main: rename the tab's note on disk. */
  MarkdownRename: 'markdown:rename',
  /** Chrome → main: switch the tab between read-only (view) and editable (edit). */
  MarkdownSetMode: 'markdown:set-mode',
  /** Chrome → main: switch the tab between its formatted note and its raw text. */
  MarkdownSetDisplay: 'markdown:set-display',
  /** Chrome → main: how wide to draw a formatted note, as a percent of its page's width (the toolbar's width slider). */
  MarkdownSetContentWidth: 'markdown:set-content-width',
  /** Main → Markdown page: how wide to draw the formatted note, as a percent of the page's width. */
  MarkdownContentWidth: 'markdown:content-width',
  /** Markdown page → main: the percent of the page's width the note's usual column takes, as the page resizes. */
  MarkdownContentWidthMin: 'markdown:content-width-min',
  /** Chrome → main: step the tab back or forward through the notes it followed links through. */
  MarkdownNavigateHistory: 'markdown:navigate-history',
  /** Chrome → main: a formatting button in the Tools sidebar (bold, italic, link, LaTeX, code block, table). */
  MarkdownApplyFormat: 'markdown:apply-format',
  /** Chrome → main: save a copy of the tab's note as a PDF, `.md` or `.txt`. */
  MarkdownExport: 'markdown:export',
  /** Chrome → main: open a bookmarked note in this tab (picked from the toolbar's Markdown search). */
  MarkdownOpenBookmark: 'markdown:open-bookmark',
  /** Chrome → main: open a note the history has seen in this tab. */
  MarkdownOpenPath: 'markdown:open-path',
  /** Main → Markdown page: the note just opened (or re-read after it changed on disk). */
  MarkdownFile: 'markdown:file',
  /** Main → Markdown page: the open note was closed; show the empty page. */
  MarkdownClosed: 'markdown:closed',
  /** Main → Markdown page: whether the note is read-only (view) or editable (edit). */
  MarkdownMode: 'markdown:mode',
  /** Main → Markdown page: whether to show the note formatted or as raw text. */
  MarkdownDisplay: 'markdown:display',
  /** Main → Markdown page: a formatting shortcut (bold, italic, link, LaTeX block, code block) pressed while editing. */
  MarkdownFormat: 'markdown:format',
  /** Markdown page → main: the note's source after an edit, to write to disk. */
  MarkdownSave: 'markdown:save',
  /** Markdown page → main: the marks drawn on the open note, to persist. */
  MarkdownSaveAnnotations: 'markdown:save-annotations',
  /** Main → Markdown page: remove every mark (Revert Annotations). */
  MarkdownClear: 'markdown:clear',
  /** Main → Markdown page: Ctrl+Z while a mark-making tool is on. */
  MarkdownUndo: 'markdown:undo',
  /** Main → Markdown page: Ctrl+Y while a mark-making tool is on. */
  MarkdownRedo: 'markdown:redo',
  /** Markdown page → main: follow a link (a `[[wikilink]]` or a relative path) to another note. */
  MarkdownOpenLink: 'markdown:open-link',
  /** Markdown page → main: which `[[wikilinks]]` name a note that exists. */
  MarkdownResolveLinks: 'markdown:resolve-links',
  /** Markdown page → main: the notes that link to the open one. */
  MarkdownBacklinks: 'markdown:backlinks',
  /** Markdown page → main: the names of the notes in the open one's vault, for completing `[[`. */
  MarkdownListNotes: 'markdown:list-notes',
  /** Markdown page → main: an image beside the note, as a data URL. */
  MarkdownReadImage: 'markdown:read-image',
  /** Markdown page → main: fetch a web picture the user clicked to load (a note never loads one by itself). */
  MarkdownReadRemoteImage: 'markdown:read-remote-image',
  /** Markdown page → main: run one of the note's fenced code blocks. */
  MarkdownRunCode: 'markdown:run-code',
  ZoomWheel: 'zoom:wheel',
  TabsRevertPage: 'tabs:revert-page',
  TerminalInput: 'terminal:input',
  TerminalResize: 'terminal:resize',
  TerminalData: 'terminal:data',
  TerminalExited: 'terminal:exited',
  WorkspacesCreate: 'workspaces:create',
  WorkspacesCreateWithTab: 'workspaces:create-with-tab',
  WorkspacesSwitch: 'workspaces:switch',
  WorkspacesToggleSelect: 'workspaces:toggle-select',
  WorkspacesSelectRange: 'workspaces:select-range',
  WorkspacesRename: 'workspaces:rename',
  WorkspacesMove: 'workspaces:move',
  WorkspacesUpdate: 'workspaces:update',
  WorkspacesRemove: 'workspaces:remove',
  WorkspaceOpenInNewWindow: 'workspaces:open-in-new-window',
  /** Chrome → main: save a workspace (its name, color, icon and tabs in order) as a workspace image. */
  WorkspaceImagesSave: 'workspace-images:save',
  /** Chrome → main: open a saved image as a new workspace with its tabs. */
  WorkspaceImagesOpen: 'workspace-images:open',
  /** Chrome → main: delete a saved image. */
  WorkspaceImagesRemove: 'workspace-images:remove',
  /** Chrome → main: rename a saved image. */
  WorkspaceImagesRename: 'workspace-images:rename',
  BookmarksAdd: 'bookmarks:add',
  BookmarksRemove: 'bookmarks:remove',
  /** Chrome → main: bookmark the tab's page (or open PDF's file), or remove its bookmark. */
  BookmarksToggle: 'bookmarks:toggle',
  /** Chrome → main: bookmark the tab's open PDF under a chosen name (the bookmark popup's Save). */
  BookmarksAddPdf: 'bookmarks:add-pdf',
  /** Chrome → main: bookmark the tab's open note under a chosen name (the bookmark popup's Save). */
  BookmarksAddMarkdown: 'bookmarks:add-markdown',
  TabsBeginTabPreview: 'tabs:begin-tab-preview',
  TabsEndTabPreview: 'tabs:end-tab-preview',
  AddressSuggestionsSync: 'address-suggestions:sync',
  AddressSuggestionsSelect: 'address-suggestions:select',
  TooltipSync: 'tooltip:sync',
  ColorPickerSync: 'color-picker:sync',
  ColorPickerColorChanged: 'color-picker:color-changed',
  ColorPickerCloseRequested: 'color-picker:close-requested',
  ExportMenuSync: 'export-menu:sync',
  ExportMenuSelect: 'export-menu:select',
  /** Chrome → main: the tab row's "+" menu opened, moved or closed (drawn by a second menu overlay). */
  NewTabMenuSync: 'new-tab-menu:sync',
  /** Main → chrome: close the "+" menu (a row was picked, Escape, or a click on the page). */
  NewTabMenuCloseRequested: 'new-tab-menu:close-requested',
  /** Main → chrome: Revert annotations was asked for by its shortcut; the chrome confirms it, as it does the button. */
  TabsRevertRequested: 'tabs:revert-requested',
  ExportMenuCloseRequested: 'export-menu:close-requested',
  AccentColorSet: 'accent-color:set',
  SplitEnter: 'split:enter',
  SplitExit: 'split:exit',
  FocusModeSet: 'focus-mode:set',
  LaserPointerSet: 'laser-pointer:set',
  HighlighterSet: 'highlighter:set',
  CommentToolSet: 'comment-tool:set',
  TextToolSet: 'text-tool:set',
  PenSet: 'pen:set',
  ZoomIn: 'zoom:in',
  ZoomOut: 'zoom:out',
  ZoomReset: 'zoom:reset',
  ZoomSet: 'zoom:set',
  // Pushed from main straight to a tab's own `WebContentsView` (its
  // `tabZoom`/`terminal` preload, not the chrome) — not part of
  // `PortalogiaApi` since the chrome renderer never sends or receives it.
  // See `TabManager.applyZoom` for why this exists instead of just setting
  // `contents.zoomLevel` from main.
  ZoomApply: 'zoom:apply',
  SidebarToggle: 'sidebar:toggle',
  /** Chrome → main: split the two selected tabs side by side, or go back to one (the split-screen button, Ctrl+Alt+S). */
  SplitToggle: 'split:toggle',
  SplitSwap: 'split:swap',
  /** Chrome → main: show the Tools sidebar in full, or hide it to its rail of icons. */
  ToolsSidebarToggle: 'tools-sidebar:toggle',
  /** Chrome → main: Escape in the chrome, with nothing there using it — the active tab's page takes the keyboard. */
  TabsFocusContent: 'tabs:focus-content',
  /** Main → chrome: put up (or take down) the picture of the tab's pages that slides with the sidebar. */
  UiContentSnapshot: 'ui:content-snapshot',
  /** Chrome → main: that picture is on screen, so the live pages can step away for the slide. */
  ContentSnapshotShown: 'content-snapshot:shown',
  UiOpenTabSearch: 'ui:open-tab-search',
  UiEditWorkspace: 'ui:edit-workspace',
  UiOpenWorkspaceImages: 'ui:open-workspace-images',
  UiFocusAddressBar: 'ui:focus-address-bar',
  /** Main → chrome: the pointer came onto (`true`) or left the tab row, its empty drag space included. */
  UiTitlebarPointer: 'ui:titlebar-pointer',
  /** Main → chrome: where the pointer is on the tab row (window CSS pixels), pushed as it moves there, for its glow. */
  UiTitlebarPointerPosition: 'ui:titlebar-pointer-position',
  UiFocusZoom: 'ui:focus-zoom',
  UiToggleTheme: 'ui:toggle-theme',
  ThemeSet: 'theme:set',
  /** Chrome → main (invoke), just before the theme changes: lay a snapshot of the window over it, to fade from. */
  ThemePrepareFade: 'theme:prepare-fade',
  // Ad blocking. `AdBlockState` is pushed to every chrome window as it changes;
  // the other three are the chrome's requests (see `registerAdBlockIpc`).
  AdBlockState: 'adblock:state',
  AdBlockGetState: 'adblock:get-state',
  AdBlockSetEnabled: 'adblock:set-enabled',
  AdBlockSetSiteAllowed: 'adblock:set-site-allowed',
  WindowMinimize: 'window:minimize',
  WindowToggleMaximize: 'window:toggle-maximize',
  WindowClose: 'window:close',
  WindowStateChanged: 'window:state-changed',
  WindowGetState: 'window:get-state',
  /** Main → chrome: the Wi-Fi connection changed. */
  StatusWifiChanged: 'status:wifi-changed',
  /** Chrome → main: the Wi-Fi connection now. */
  StatusWifiGet: 'status:wifi-get',
  /** Main → chrome: the default playback device, its volume or its mute changed. */
  StatusAudioChanged: 'status:audio-changed',
  /** Chrome → main: the default playback device, its volume and mute now. */
  StatusAudioGet: 'status:audio-get',
  /** Main → chrome: Bluetooth's connected devices changed. */
  StatusBluetoothChanged: 'status:bluetooth-changed',
  /** Chrome → main: Bluetooth's connected devices now. */
  StatusBluetoothGet: 'status:bluetooth-get',
  /** Chrome → main: whether the computer has a battery at all (`null` while still finding out). */
  StatusBatteryPresentGet: 'status:battery-present-get',
  /** Main → chrome: the outside temperature changed. */
  StatusWeatherChanged: 'status:weather-changed',
  /** Chrome → main: the outside temperature now. */
  StatusWeatherGet: 'status:weather-get',
} as const;

// Request validation schemas live in `@shared/ipc-schemas` (zod-based,
// main-only) — kept out of this file so preload, which also imports from
// here, never pulls zod into its sandboxed bundle.

// ── Result shape ─────────────────────────────────────────────────────────
// Handlers return this instead of throwing raw exceptions across the IPC
// boundary, so the renderer never sees a main-process stack trace.

export type IpcResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly code: string; readonly message: string };

/** Result of a PDF export: the path it was saved to, or `null` if the user canceled the save dialog. */
/** A rectangle in window-client coordinates. */
export interface DropRegionRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ExportPdfResult {
  readonly savedPath: string | null;
}

/** What the stat bar along the bottom of a web page's tab shows (`WebStatusBar`). */
export interface PageStats {
  readonly words: number;
  readonly characters: number;
  readonly images: number;
  readonly links: number;
  /**
   * The page's size: the bytes of its document and every file it has loaded, as the browser records them (compressed,
   * as sent). A file from another site that doesn't allow its sizes to be read counts as 0, so this can fall short.
   */
  readonly bytes: number;
  /** Every element in the page. */
  readonly elements: number;
  /** The element under the pointer (`a#home.nav-link`), or `null` when the pointer isn't over the page. */
  readonly hovered: string | null;
  /** The element with the keyboard (a text box with the caret, a focused button), or `null` when none in particular has. */
  readonly focused: string | null;
  /** Where the pointer is over the page, in its CSS pixels from the top-left of the view; `null` when it's elsewhere. */
  readonly pointer: { readonly x: number; readonly y: number } | null;
  /** The selection's words and characters, or `null` when nothing is selected. */
  readonly selection: { readonly words: number; readonly characters: number } | null;
  /** How much of the page is in view: where the view's top and bottom fall, as whole percents of the page's height. */
  readonly scroll: { readonly top: number; readonly bottom: number };
}

/** Where the sidebar slide's snapshot sits in the chrome's tab area (`.tab-content`), as insets in CSS pixels. */
export interface ContentSnapshotInsets {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** A picture of one pane (a view on show) for the sidebar slide's snapshot. */
export interface ContentSnapshotPiece {
  /** The picture as raw BGRA (a `Buffer` from main, a `Uint8Array` by the chrome). */
  readonly bitmap: Uint8Array;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  /** The pane's size in CSS pixels. */
  readonly width: number;
  readonly height: number;
  /** Where the pane sits in the snapshot's area, and how much of it it takes, as fractions of it. */
  readonly x: number;
  readonly y: number;
  readonly fractionWidth: number;
  readonly fractionHeight: number;
}

/** Main → chrome (`UiContentSnapshot`): put the slide's snapshot up, or take it down. */
export type ContentSnapshotMessage =
  | {
      readonly kind: 'show';
      readonly id: number;
      readonly insets: ContentSnapshotInsets;
      /** The panes' corner radius, in CSS pixels. */
      readonly radius: number;
      readonly pieces: readonly ContentSnapshotPiece[];
    }
  | { readonly kind: 'clear'; readonly id: number };

/** Pushed whenever the frameless window's maximized state changes, so `WindowControls` can swap its maximize/restore icon. */
export interface WindowState {
  readonly isMaximized: boolean;
}

/** The computer's Wi-Fi connection, for the titlebar's status icon. */
export interface WifiStatus {
  /** `unavailable`: no wireless adapter, or its state couldn't be read; the icon hides. */
  readonly state: 'connected' | 'disconnected' | 'unavailable';
  /** Signal quality, 0-100; 0 unless connected. */
  readonly signal: number;
  /** The network's name, or `null` unless connected (or when the network hides its name). */
  readonly ssid: string | null;
}

/** The computer's sound, for the titlebar's audio section: the default playback device. */
export interface AudioStatus {
  /** `on`: a playback device is there to read. `unavailable`: none, or it couldn't be read; the section hides. */
  readonly state: 'on' | 'unavailable';
  /** The device's name as Windows' sound settings show it, or `null` if it has none (or is unavailable). */
  readonly device: string | null;
  /** The master volume, 0-100 (of its maximum); 0 unless `on`. */
  readonly volume: number;
  /** Whether it's muted. */
  readonly muted: boolean;
}

/** The computer's Bluetooth, for the titlebar's status icon. */
export interface BluetoothStatus {
  /**
   * `on`: the radio is on (with or without devices connected). `off`: it is turned off.
   * `unavailable`: no Bluetooth adapter, or its devices couldn't be read; the icon hides.
   */
  readonly state: 'on' | 'off' | 'unavailable';
  /** How many devices are connected; 0 unless `on`. */
  readonly devices: number;
  /** The connected devices' names, as Windows shows them, in name order; those with no name are counted but not listed. */
  readonly names: readonly string[];
}

/** The outside temperature where the computer is, for the titlebar. */
export interface WeatherState {
  /** Whole degrees Fahrenheit, or `null` until it has been fetched once. */
  readonly temperatureF: number | null;
}

/** One bookmark match shown as a row in the address bar's suggestions dropdown. */
export interface AddressSuggestionItem {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  /** What the row is, which picks its icon: a bookmark (the default), or a recent visit from the history. */
  readonly kind?: 'bookmark' | 'history' | undefined;
}

/**
 * What the address bar pushes to its dedicated suggestions overlay every
 * time its dropdown's own state changes — see `syncAddressSuggestions` and
 * `SuggestionsOverlay`. `rect` is `null` whenever `open` is `false`; when
 * `open` is `true` it's always present, measured in the same CSS-pixel
 * coordinate space `WebContentsView.setBounds` already uses elsewhere in
 * this app (see `TabManager.computeMainBounds`) — no unit conversion
 * needed between the chrome's own `getBoundingClientRect()` and the
 * overlay view's bounds, since both live in the same window.
 */
export interface AddressSuggestionsSyncPayload {
  /** `'menu'` draws plain option rows in the accent color (the History toolbar's unit dropdown) instead of bookmark rows; the default is bookmarks. */
  readonly variant?: 'bookmarks' | 'menu' | undefined;
  readonly open: boolean;
  readonly rect: { readonly top: number; readonly left: number; readonly width: number } | null;
  readonly suggestions: readonly AddressSuggestionItem[];
  readonly selectedIndex: number;
}

/**
 * What the chrome pushes to `TooltipOverlay` as a tooltip shows or hides
 * (see `installChromeTooltips`): every chrome tooltip is drawn there, above
 * everything in the window, so no layer — the tab's own native view
 * included — can paint over it. `rect` is `null` whenever `visible` is `false`, same
 * relationship `AddressSuggestionsSyncPayload.rect` has with `open`.
 * Already sized to fit `text` exactly (`computeTooltipOverlayRect`) —
 * unlike `SuggestionsOverlay`, this overlay's own page never has to
 * measure and report anything back, since there's no dynamic row count to
 * account for, only a single line of text the chrome can measure itself.
 */
export interface TooltipSyncPayload {
  readonly visible: boolean;
  readonly text: string;
  readonly rect: { readonly top: number; readonly left: number; readonly width: number; readonly height: number } | null;
}

/**
 * What `ColorPicker` pushes to its dedicated overlay `WebContentsView`
 * every time its own state changes — see `syncColorPicker` and
 * `ColorPickerOverlay`. `rect` is `null` whenever `open` is `false`, same
 * relationship `AddressSuggestionsSyncPayload.rect` has with `open`.
 * Unlike that payload, there's no `width`/`height` here: the panel's size
 * never varies (`COLOR_PICKER_PANEL_WIDTH_PX`/`COLOR_PICKER_PANEL_HEIGHT_PX`
 * in `@shared/constants`), only its position does.
 */
export interface ColorPickerSyncPayload {
  readonly open: boolean;
  readonly rect: { readonly top: number; readonly left: number } | null;
  readonly accent: RGB;
  readonly recentColors: readonly RGB[];
}

/** What a row in the export dropdown does: save the page as a PDF, save its HTML/CSS/JS files, or (Markdown tabs) save the note as `.md` or `.txt`. */
export type ExportMenuAction = 'pdf' | 'documents' | 'markdown' | 'text';

/** A row of the tab row's "+" menu (`NewTabMenu`): which kind of tab it opens. */
export type NewTabMenuAction =
  | 'new-tab'
  | 'new-pdf'
  | 'new-markdown'
  | 'new-terminal'
  | 'new-bookmarks'
  | 'new-secrets'
  | 'new-history';

/** A row picked in either dropdown the menu overlay draws (`ExportMenuOverlay`): the export menu's or the "+" menu's. */
export type MenuOverlayAction = ExportMenuAction | NewTabMenuAction;

/**
 * What `ExportMenu` pushes to its dedicated overlay `WebContentsView` on
 * every open/close — see `syncExportMenu` and `ExportMenuOverlay`. `rect`
 * is `null` whenever `open` is `false`. No size: the menu's is fixed
 * (`EXPORT_MENU_WIDTH_PX`/`EXPORT_MENU_HEIGHT_PX`).
 */
export interface ExportMenuSyncPayload {
  /** Which menu: the toolbar's export menu, or the tab row's "+" menu (`NewTabMenu`). The same overlay draws either. */
  readonly kind: 'export' | 'new-tab';
  readonly open: boolean;
  readonly rect: { readonly top: number; readonly left: number } | null;
  /** False for a terminal tab, whose page is our own UI rather than content worth saving — the documents row is disabled. */
  readonly canExportDocuments: boolean;
  /** True on a Markdown tab: the menu then lists PDF, `.md` and `.txt` instead of PDF and HTML/CSS/JS. */
  readonly markdown: boolean;
}

/**
 * Reported back from the color picker's own overlay page on every drag
 * pixel, keystroke, or swatch click — see `ColorPickerOverlay`'s own doc
 * comment for why it's the overlay, not the chrome, that owns the actual
 * square/ring/fields interaction. `commit` mirrors the same "settle
 * point" `ColorPicker` used to decide for itself before this became an
 * overlay: `true` at a pointerup, a field blur/Enter, or a swatch click —
 * the chrome only files a color into the recents list on those, not on
 * every intermediate value a drag or a keystroke passes through.
 */
export interface ColorPickerColorChangedPayload {
  readonly rgb: RGB;
  readonly commit: boolean;
}

/**
 * Light/dark theme choice reported to main via `setNativeTheme`, kept in
 * sync with the renderer's own `useTheme` state (the source of truth) so
 * Electron's `nativeTheme.themeSource` — and anything that follows it,
 * like the `portalogia://home` page's `prefers-color-scheme` styling —
 * matches the chrome instead of drifting to whatever the OS prefers.
 */
export type ThemePreference = 'light' | 'dark';

/** What the chrome shows about the ad blocker — pushed from main whenever it changes. */
export interface AdBlockState {
  /** The global switch. */
  readonly enabled: boolean;
  /** Hostnames the user has turned blocking off for. */
  readonly allowedSites: readonly string[];
  /** Requests and page elements blocked since each tab's current page began loading, by tab id. */
  readonly blockedByTab: Readonly<Record<string, number>>;
}

/**
 * The API surface exposed to the renderer via `contextBridge`. Preload
 * implements this exactly (`satisfies PortalogiaApi`); the renderer declares
 * `window.portalogia` as this type. Keeping the interface here means both sides
 * of the bridge are checked against one definition.
 */
export interface PortalogiaApi {
  createTab(url?: string): Promise<IpcResult<BrowserState>>;
  closeTab(id: string): Promise<IpcResult<BrowserState>>;
  activateTab(id: string): Promise<IpcResult<BrowserState>>;
  /** Ctrl+click: adds the tab to (or removes it from) the multi-selection, along with the active tab, without switching to it. */
  toggleTabSelection(id: string): Promise<IpcResult<BrowserState>>;
  /** Shift+click: selects every tab between the active tab and this one. */
  selectTabRange(id: string): Promise<IpcResult<BrowserState>>;
  /** Reorders a tab (drag-and-drop in the tab bar) to just before `beforeId`, or to the end of its workspace's tabs if `beforeId` is `null`. */
  moveTab(id: string, beforeId: string | null): Promise<IpcResult<BrowserState>>;
  /** Moves a tab into a different workspace — dragging it onto one of `WorkspaceBar`'s pills. A no-op if it's already there. */
  moveTabToWorkspace(id: string, workspaceId: string): Promise<IpcResult<BrowserState>>;
  /**
   * Reports a tab drag that ended outside the tab bar's own drop targets —
   * `screenX`/`screenY` are the drag's OS screen coordinates at release
   * (`DragEvent.screenX`/`screenY`), not viewport-relative. Main decides
   * whether that point actually landed outside this window's own bounds
   * (a drop inside the window that simply missed every `TabBar`/
   * `WorkspaceBar` target — e.g. over the page's own native view — isn't a
   * tear-off) before spinning up a new window for it. Fire-and-forget: the
   * eventual result is just this window's own `onStateChanged` push once
   * the tab is gone, same as any other tab removal.
   */
  tearOffTab(id: string, screenX: number, screenY: number, live?: boolean): void;
  /**
   * Ends a `live` tear-off (the drag was released). `accepted` is whether
   * the release landed on a drop target (another tab strip or a workspace
   * pill) — main then discards the now-empty torn-off window if the tab
   * really did move out of it; otherwise the window stays where it is.
   */
  tearOffTabEnd(id: string, accepted: boolean): void;
  /**
   * Reports where this window's tab drop targets are (workspace pills and
   * the "+ New workspace" button), in window-client coordinates — sent when
   * a tab drag starts, so main can tell when a torn-off window is hovering
   * over one of them.
   */
  reportDropRegions(rects: readonly DropRegionRect[]): void;
  navigate(id: string, url: string): Promise<IpcResult<BrowserState>>;
  goBack(id: string): Promise<IpcResult<BrowserState>>;
  goForward(id: string): Promise<IpcResult<BrowserState>>;
  reload(id: string): Promise<IpcResult<BrowserState>>;
  stop(id: string): Promise<IpcResult<BrowserState>>;
  getState(): Promise<IpcResult<BrowserState>>;
  /** Subscribes to main-process-pushed state updates; returns an unsubscribe function. */
  onStateChanged(listener: (state: BrowserState) => void): () => void;

  /** Renders the active tab's current page to a PDF the user chooses where to save; `null` path means they canceled. */
  exportToPdf(id: string): Promise<IpcResult<ExportPdfResult>>;
  /** Opens a new terminal tab (Ctrl+>, the toolbar terminal button, or File > New Terminal). */
  createTerminalTab(): Promise<IpcResult<BrowserState>>;

  /** Opens a new PDF viewer tab (the toolbar's PDF button). */
  createPdfTab(): Promise<IpcResult<BrowserState>>;
  /** Opens a new History tab (the toolbar's history button, Ctrl+Shift+H, or File > New History Tab). */
  createHistoryTab(): Promise<IpcResult<BrowserState>>;
  /** Opens a new Bookmarks tab (the toolbar's bookmarks button, or File > New Bookmarks Tab). */
  createBookmarksTab(): Promise<IpcResult<BrowserState>>;
  /** Sets the search text a Bookmarks tab's table filters by — typed in the toolbar, shown in the tab's page. Fire-and-forget. */
  setBookmarksQuery(id: string, query: string): void;
  /** Switches a Bookmarks tab between viewing and editing its table (the toolbar's View/Edit switch). Fire-and-forget. */
  setBookmarksMode(id: string, mode: 'view' | 'edit'): void;
  /** Opens a new Secrets tab (the toolbar's lock button, or File > New Secrets Tab). */
  createSecretsTab(): Promise<IpcResult<BrowserState>>;
  /** Sets the search text a Secrets tab's table filters by — typed in the toolbar, shown in the tab's page. Fire-and-forget. */
  setSecretsQuery(id: string, query: string): void;
  /** Switches a Secrets tab between viewing and editing its table (the toolbar's View/Edit switch). Fire-and-forget. */
  setSecretsMode(id: string, mode: 'view' | 'edit'): void;
  /** Starts a new, empty row in a Secrets tab's table to type a secret into, switching it to editing (the toolbar's Add button). Fire-and-forget. */
  addSecretRow(id: string): void;
  /** Opens or closes this window's find bar (the toolbar's find button, or Ctrl+F). Browser, PDF (with a file open) and terminal tabs only. */
  setFind(enabled: boolean): Promise<IpcResult<BrowserState>>;
  /** Sets the search text a History tab's table filters by — typed in the toolbar, shown in the tab's page. Fire-and-forget. */
  setHistoryQuery(id: string, query: string): void;
  /** Sets the time range a History tab's table shows — the toolbar's number and unit, which also say what "Clear History" deletes. Fire-and-forget. */
  setHistoryRange(id: string, range: HistoryClearRange): void;
  /** Clears the browsing history within a range (the History toolbar's "Clear History"). */
  clearHistory(range: HistoryClearRange): Promise<IpcResult<BrowserState>>;
  /** How many visits a range covers — what `clearHistory` would delete — for its confirmation popup. */
  countHistory(range: HistoryClearRange): Promise<IpcResult<number>>;
  /** Told whenever the history changes, for the toolbar to count its range again. Returns an unsubscribe function. */
  onHistoryChanged(listener: () => void): () => void;
  /**
   * The most recent distinct pages (`'url'`) or PDFs (`'pdf'`) from the
   * history whose route contains `query` — what the address bar and the PDF
   * search show after the bookmarks that match. Pages are those that loaded
   * (2xx), so a redirect hop or an error page never appears; PDFs are those
   * whose file still exists.
   */
  searchHistory(type: HistoryEntry['type'], query: string): Promise<IpcResult<readonly HistorySuggestion[]>>;
  /** Opens a PDF the history has seen in a PDF tab. Fire-and-forget. */
  openPdfPath(id: string, path: string): void;
  /** Shows the open dialog for a PDF tab; the chosen file is delivered to that tab's page by main. */
  openPdfFile(id: string): Promise<IpcResult<null>>;
  /** Renames a PDF tab's file on disk (same folder). Fails unless the name ends in `.pdf` and doesn't already exist. */
  renamePdfFile(id: string, name: string): Promise<IpcResult<null>>;
  /** Scrolls the tab's PDF to a 1-based page (clamped to the document). */
  goToPdfPage(id: string, page: number): Promise<IpcResult<null>>;
  /** Sets what a drag on a PDF, Markdown or browser tab's document does: pan it, or select its text (and click its links). */
  setPointerMode(id: string, mode: PointerMode): Promise<IpcResult<null>>;
  /** Turns a browser tab's edit mode on or off: while on, the toolbar tools' keyboard shortcuts go to the page. */
  toggleEditMode(id: string): Promise<IpcResult<null>>;

  /** Opens a new Markdown tab (the toolbar's MD button, Ctrl+Shift+M, or File > New Markdown Tab). */
  createMarkdownTab(): Promise<IpcResult<BrowserState>>;
  /** Shows the open dialog for a Markdown tab; the chosen note is delivered to that tab's page by main. */
  openMarkdownFile(id: string): Promise<IpcResult<null>>;
  /** Asks where to create a new, empty note and opens it in the tab. */
  newMarkdownFile(id: string): Promise<IpcResult<null>>;
  /** Closes the tab's open note, leaving the tab empty. */
  closeMarkdownFile(id: string): Promise<IpcResult<null>>;
  /** Moves the tab's open note to the Recycle Bin and leaves the tab empty. The chrome confirms with the user first. */
  deleteMarkdownFile(id: string): Promise<IpcResult<null>>;
  /** Renames a Markdown tab's note on disk (same folder). Fails unless the name ends in `.md` or `.markdown` and doesn't already exist. */
  renameMarkdownFile(id: string, name: string): Promise<IpcResult<null>>;
  /** Switches a Markdown tab between read-only (view) and editable (edit). */
  setMarkdownMode(id: string, mode: 'view' | 'edit'): Promise<IpcResult<null>>;
  /** Switches a Markdown tab between its formatted note and its raw text. */
  setMarkdownDisplay(id: string, display: MarkdownDisplay): Promise<IpcResult<null>>;
  /** Draws a formatted note this wide, as a percent of its page's width (no narrower than its usual column). */
  setMarkdownContentWidth(id: string, percent: number): Promise<IpcResult<null>>;
  /** Steps a Markdown tab back (`-1`) or forward (`1`) through the notes it followed links through. */
  navigateMarkdownHistory(id: string, direction: 1 | -1): Promise<IpcResult<null>>;
  /** Runs a formatting command on a Markdown tab's editor (the Tools sidebar's buttons), handing it the keyboard. */
  formatMarkdown(id: string, action: MarkdownFormatAction): Promise<IpcResult<null>>;
  /** Saves a copy of the tab's note as a PDF, a `.md` file or a `.txt` file (asks where in a native dialog). */
  exportMarkdown(id: string, format: 'pdf' | 'md' | 'txt'): Promise<IpcResult<null>>;
  /** Opens a bookmarked note in a Markdown tab (picked from the toolbar's Markdown search). Fire-and-forget. */
  openMarkdownBookmark(id: string, bookmarkId: string): void;
  /** Opens a note the history has seen in a Markdown tab. Fire-and-forget. */
  openMarkdownPath(id: string, path: string): void;

  createWorkspace(name?: string): Promise<IpcResult<BrowserState>>;
  /**
   * Creates a new workspace containing exactly this one tab, moved there as
   * its first (and only) tab, and switches to it — `WorkspaceBar`'s
   * drag-onto-"+ New workspace" gesture. Deliberately not just
   * `createWorkspace` followed by `moveTabToWorkspace`: `createWorkspace`
   * always opens its own fresh home tab first, which would leave the
   * dragged tab second rather than first.
   */
  createWorkspaceWithTab(tabId: string): Promise<IpcResult<BrowserState>>;
  switchWorkspace(id: string): Promise<IpcResult<BrowserState>>;
  /** Ctrl+click: adds the workspace to (or removes it from) the multi-selection, along with the active one, without switching to it. */
  toggleWorkspaceSelection(id: string): Promise<IpcResult<BrowserState>>;
  /** Shift+click: selects every workspace between the active one and this one. */
  selectWorkspaceRange(id: string): Promise<IpcResult<BrowserState>>;
  renameWorkspace(id: string, name: string): Promise<IpcResult<BrowserState>>;
  /** Moves a workspace in the sidebar to just above `beforeId`, or to the end for `null`. */
  moveWorkspace(id: string, beforeId: string | null): Promise<IpcResult<BrowserState>>;
  /** Changes a workspace's name, icon color and icon together — what the workspace editor's Save does. */
  updateWorkspace(id: string, update: { name: string; color: string; icon: string }): Promise<IpcResult<BrowserState>>;
  removeWorkspace(id: string): Promise<IpcResult<BrowserState>>;
  /** Saves a workspace — its name, color, icon and tabs in order — as a workspace image (the sidebar's star). Saving one that is already saved under that name updates it. */
  saveWorkspaceImage(workspaceId: string): Promise<IpcResult<BrowserState>>;
  /** Opens a saved image as a new workspace holding its tabs, in order. */
  openWorkspaceImage(id: string): Promise<IpcResult<BrowserState>>;
  /** Deletes a saved workspace image. */
  removeWorkspaceImage(id: string): Promise<IpcResult<BrowserState>>;
  /** Renames a saved workspace image (the pencil on its row in the images popup). */
  renameWorkspaceImage(id: string, name: string): Promise<IpcResult<BrowserState>>;

  /**
   * Opens the active tab in a brand-new window (Ctrl+Shift+O, or the
   * toolbar button next to Focus Mode) — creates an independent "linked
   * twin" of it (same URL, same shared workspace, but its own scroll
   * position and DOM state) and shows that in the new window, so the same
   * page can be read from two windows at once, each scrolled to a different
   * part of it. The twin stays linked on navigation only: typing a new
   * address or following a link in either window navigates the other to
   * match, so they always agree on *which page* even while independently
   * scrolled. Highlights and comments need no special handling for this —
   * they already synchronize between any two tabs open to the same URL.
   * This window's own active tab, workspace, and every other tab are left
   * completely untouched. Fire-and-forget: there's no meaningful reply, and
   * this window's own state never changes, so there's nothing to wait for
   * even locally.
   */
  openWorkspaceInNewWindow(): void;

  addBookmark(title: string, url: string): Promise<IpcResult<BrowserState>>;
  removeBookmark(id: string): Promise<IpcResult<BrowserState>>;
  /** Bookmarks the tab's page — or, for a PDF tab, its open file's path — or removes that bookmark (Ctrl+B, or the star button). */
  toggleBookmark(id: string): Promise<IpcResult<BrowserState>>;
  /** Bookmarks a PDF tab's open file by its path on disk, under `name` — also the name its tab shows. */
  addPdfBookmark(id: string, name: string): Promise<IpcResult<BrowserState>>;
  /** Opens a bookmarked PDF in a PDF tab (picked from the toolbar's PDF search). Fire-and-forget. */
  openPdfBookmark(id: string, bookmarkId: string): void;
  /** Bookmarks a Markdown tab's open note by its path on disk, under `name` — also the name its tab shows. */
  addMarkdownBookmark(id: string, name: string): Promise<IpcResult<BrowserState>>;

  /**
   * Captures the active browser tab's current frame and hides its native
   * `WebContentsView` — what `BookmarkPopup` sits over instead of the live
   * page while it's a true modal. The view has to actually come off the
   * window, not just be covered by chrome-drawn UI, since it's a separate
   * native surface layered above the chrome that would otherwise swallow
   * every click and render on top of the popup. Not used by the address
   * bar's suggestions dropdown — see `syncAddressSuggestions` for why that
   * one doesn't need the page to ever stop being live.
   * @returns A data URL of the tab's last-painted frame, shown blurred
   *   behind the popup, or `null` if it couldn't be captured — the view is
   *   hidden either way; `null` just falls back to a plain scrim.
   */
  beginTabPreview(id: string): Promise<IpcResult<string | null>>;
  /** Re-shows the view `beginTabPreview` hid — called once `BookmarkPopup` closes, however it closed. */
  endTabPreview(id: string): Promise<IpcResult<BrowserState>>;

  /**
   * Pushes the address bar's current suggestions-dropdown state — open or
   * closed, its position, its matches, and which one is keyboard-selected
   * — to its dedicated overlay `WebContentsView` (see `SuggestionsOverlay`).
   * Fire-and-forget, same as `sendTerminalInput`: nothing meaningful to
   * reply with, and the overlay's own render is what matters. Deliberately
   * the *only* thing that couples the dropdown to the page — unlike
   * `BookmarkPopup`, the active tab's own view is never touched by this,
   * so the page keeps rendering and animating exactly as if the dropdown
   * didn't exist.
   */
  syncAddressSuggestions(payload: AddressSuggestionsSyncPayload): void;
  /** Subscribes to a row being clicked in the suggestions overlay — the index is into whichever list this address bar most recently synced. */
  onAddressSuggestionSelected(listener: (index: number) => void): () => void;

  /**
   * Pushes a collapsed-sidebar tooltip's hover state to `TooltipOverlay` —
   * see `TooltipSyncPayload` for why this exists alongside the plain CSS
   * tooltip every other `.chrome-tooltip` consumer still uses. Fire-and-
   * forget, same as `syncAddressSuggestions`.
   */
  syncTooltip(payload: TooltipSyncPayload): void;

  /**
   * Pushes `ColorPicker`'s latest open/closed state, position, current
   * accent, and recent-colors list to its dedicated overlay
   * `WebContentsView` (see `ColorPickerOverlay`). Fire-and-forget, same as
   * `syncAddressSuggestions` — and for the same reason: the active tab's
   * own view is never touched by this, so the page stays fully live and
   * interactive underneath the dropdown instead of freezing the way
   * `BookmarkPopup` (a real modal) makes it.
   */
  syncColorPicker(payload: ColorPickerSyncPayload): void;
  /** Subscribes to a new color the picker's overlay reports — every drag pixel and keystroke, not just a final choice (see `ColorPickerColorChangedPayload.commit`). */
  onColorPickerColorChanged(listener: (payload: ColorPickerColorChangedPayload) => void): () => void;
  /** Subscribes to the overlay's own Escape-key handler asking to close — needed because a chrome-side `keydown` listener never sees a keystroke typed while focus is inside the overlay's own, separate `WebContentsView`. */
  onColorPickerCloseRequested(listener: () => void): () => void;

  /** Pushes `ExportMenu`'s open/closed state and position to its overlay `WebContentsView` (see `ExportMenuOverlay`). Fire-and-forget, same as `syncColorPicker`. */
  syncExportMenu(payload: ExportMenuSyncPayload): void;
  /** Pushes the tab row's "+" menu's state down to its overlay, as `syncExportMenu` does the export menu's. */
  syncNewTabMenu(payload: ExportMenuSyncPayload): void;
  /** Subscribes to main asking the "+" menu to close. Returns an unsubscribe function. */
  onNewTabMenuCloseRequested(listener: () => void): () => void;
  /** Subscribes to Revert annotations' shortcut, which the chrome confirms before reverting. Returns an unsubscribe function. */
  onRevertRequested(listener: () => void): () => void;
  /** Subscribes to the overlay asking to close — an Escape typed inside it, a click on the live page, or a row being chosen. */
  onExportMenuCloseRequested(listener: () => void): () => void;

  enterSplitView(secondaryId: string): Promise<IpcResult<BrowserState>>;
  exitSplitView(): Promise<IpcResult<BrowserState>>;

  /** Shows or hides the workspace sidebar — `WorkspaceBar`'s own `.sidebar__toggle` button doing the same thing Ctrl+L already does. */
  toggleSidebar(): Promise<IpcResult<BrowserState>>;
  /**
   * Split screen: shows the two selected tabs side by side — the first selected on the left — or, while split, goes
   * back to one screen, the side focused last. A no-op unless exactly two tabs are selected or it's already split.
   */
  toggleSplitScreen(): Promise<IpcResult<BrowserState>>;
  /** Split screen: the two sides trade places, fading out and back in. A no-op unless split. */
  swapSplitSides(): Promise<IpcResult<BrowserState>>;
  /** Shows the Tools sidebar in full, or hides it to its rail of icons; the page beside it resizes to match. */
  toggleToolsSidebar(): Promise<IpcResult<BrowserState>>;
  /** Hands the keyboard to the active tab's page (a web page, PDF, note or terminal): Escape pressed in the chrome. */
  focusContent(): Promise<IpcResult<null>>;

  setFocusMode(enabled: boolean): Promise<IpcResult<BrowserState>>;

  /**
   * Turns the laser pointer overlay on or off (Ctrl+I, or the toolbar
   * button between the bookmark star and PDF export) — see
   * `LaserPointerOverlay`. While on, a transparent `WebContentsView` covers
   * the active tab's own content area, replacing the cursor there with a
   * colored dot (the current accent color) and drawing a fading streak
   * behind it while the mouse is held down and dragged.
   */
  setLaserPointer(enabled: boolean): Promise<IpcResult<BrowserState>>;

  /**
   * Turns the highlighter tool on or off (Ctrl+J, or the toolbar button
   * between the pen and PDF export) — see `HighlighterController`. While on,
   * the active tab's cursor becomes a highlighter; releasing a text
   * selection wraps it in a `<mark>` colored with the current accent, real
   * DOM injected into the page itself (not a separate overlay, unlike the
   * laser pointer) so it shows up in PDF export and survives a reload.
   * Ctrl+Z/Ctrl+Y undo/redo the last highlight, and hovering one with 'D' or
   * Delete removes it, all only while this is on.
   */
  setHighlighter(enabled: boolean): Promise<IpcResult<BrowserState>>;

  /**
   * Turns the pen tool on or off (Ctrl+P, or the toolbar button between the
   * laser pointer and the highlighter) — see `PenController`. While on, the
   * active tab's cursor becomes a pen; holding the mouse down and dragging
   * (same gesture as the laser pointer's own streak) draws a freehand stroke
   * in the current accent color, real DOM (an SVG path) injected into the
   * page itself, same as the highlighter, so it shows up in PDF export and
   * survives a reload. Ctrl+Z/Ctrl+Y undo/redo the last stroke, and hovering
   * one lightens it and either clicking it or pressing 'D'/Delete removes
   * it, all only while this is on. Mutually exclusive with the laser
   * pointer, the highlighter, and the comment tool. Browser-tab only, like
   * the comment tool: a terminal's character grid has no document coordinate
   * space for a freehand overlay to live in.
   */
  setPen(enabled: boolean): Promise<IpcResult<BrowserState>>;
  /** Turns the PDF crop tool on or off. */
  setCrop(enabled: boolean): Promise<IpcResult<BrowserState>>;
  /** Closes the tab's open PDF, leaving the tab empty. */
  closePdfFile(id: string): Promise<IpcResult<null>>;
  /** Moves a PDF tab's open file to the Recycle Bin and empties the tabs that had it open. The chrome confirms first. */
  deletePdfFile(id: string): Promise<IpcResult<null>>;
  /** Saves a copy of the tab's PDF with its crop boxes applied (asks where in a native dialog). */
  exportPdfFile(id: string): Promise<IpcResult<null>>;

  /**
   * Turns the comment tool on or off (Ctrl+M, or the toolbar button next to
   * the highlighter) — see `CommentController`. While on, clicking anywhere
   * on the active tab's page drops a small pin with an editable text box
   * (Enter posts it, Shift+Enter inserts a newline), Up/Down jumps between
   * existing comments, and every comment shows its box open, editable in
   * place. While off, a comment collapses to just its dot; clicking one
   * shows its text read-only until Escape, a click outside it, or opening a
   * different comment closes it back to a dot. Mutually exclusive with the
   * laser pointer, the highlighter, and the pen — turning any one of the
   * four on turns the other three off. Browser-tab only, unlike the
   * highlighter: a terminal tab's pty scrollback has nothing stable to
   * re-anchor a comment to across a reload.
   */
  setCommentTool(enabled: boolean): Promise<IpcResult<BrowserState>>;

  /**
   * Turns the text box tool on or off (Ctrl+E, or the toolbar button next to
   * the comment tool) — see `TextBoxController`. While on, clicking anywhere
   * on a browser or PDF tab's page drops an editable text box there; while
   * the caret is in one, Ctrl+. / Ctrl+, step its font size (8–48) and the
   * size is shown, editable, beside it. Boxes stay on the page when the tool
   * is off, in the accent color, and a PDF's boxes are baked into its export.
   * Mutually exclusive with the other pointer tools. Not available on a
   * terminal tab, like the comment tool.
   */
  setTextTool(enabled: boolean): Promise<IpcResult<BrowserState>>;

  /**
   * Reverts a browser tab's page back to how it looked before any
   * highlighting, drawing, or commenting on it — removes every highlight,
   * pen stroke, and comment for that tab's current URL outright
   * (Ctrl+Shift+R, or the toolbar button next to the comment tool). Unlike
   * the other four tools, this is a one-shot action, not a toggle: there's
   * no on/off state, and the wipe isn't itself undoable — it also clears the
   * highlighter's and the pen's own undo/redo stacks, and mirrors the
   * removal onto every other tab open to the same URL. A no-op for a
   * terminal tab, which has none of the three.
   */
  revertPage(id: string): Promise<IpcResult<BrowserState>>;

  /**
   * Zooms in/out/back-to-100% on the active tab's own content only — never
   * the chrome (sidebar, tab strip, toolbar), which always stays at native
   * size. Works for a terminal tab exactly like a browser one, since both
   * are just a `WebContentsView` main can zoom independently.
   */
  zoomIn(): Promise<IpcResult<BrowserState>>;
  zoomOut(): Promise<IpcResult<BrowserState>>;
  resetZoom(): Promise<IpcResult<BrowserState>>;
  /**
   * Sets the active tab's zoom to an exact percent (`ZoomPercentInput`, typing directly) — clamped to 25–200 on the
   * main-process side regardless of what's passed — or, given `tabId`, the split's right side's.
   */
  setZoom(percent: number, tabId?: string): Promise<IpcResult<BrowserState>>;

  /** Subscribes to the menu/accelerator-driven request (Ctrl+Shift+E) to edit the active workspace. */
  onEditWorkspace(listener: () => void): () => void;

  /** Subscribes to the menu/accelerator-driven request (Ctrl+Shift+S) to open the workspace images popup. */
  onOpenWorkspaceImages(listener: () => void): () => void;

  /** Subscribes to main's requests to put up or take down the picture of the tab's pages that slides with the sidebar. */
  onContentSnapshot(listener: (message: ContentSnapshotMessage) => void): () => void;
  /** Tells main the snapshot `id` is on screen. */
  reportContentSnapshotShown(id: number): void;

  /** Subscribes to the menu/accelerator-driven request to open the tab search overlay. */
  onOpenTabSearch(listener: () => void): () => void;

  /** Subscribes to the menu/accelerator-driven request (Ctrl+/) to focus the address bar. */
  onFocusAddressBar(listener: (clear: boolean) => void): () => void;
  /** Pushed as the pointer comes onto or leaves the tab row (main watches it: the row's empty space is the OS drag region). */
  onTitlebarPointer(listener: (inside: boolean) => void): () => void;
  /** Pushed as the pointer moves on the tab row, empty space included: its place in the window's CSS pixels. */
  onTitlebarPointerPosition(listener: (point: { readonly x: number; readonly y: number }) => void): () => void;

  /** Subscribes to the menu/accelerator-driven request (Ctrl+Shift+0) to focus and select `ZoomControl`'s percent field. */
  onFocusZoom(listener: () => void): () => void;

  /** Subscribes to the menu/accelerator-driven request (Ctrl+D) to toggle the light/dark theme — see `useTheme`. */
  onToggleTheme(listener: () => void): () => void;
  /** Reports the renderer's current theme so main can mirror it onto `nativeTheme.themeSource` — see `ThemePreference`. Fire-and-forget, same as `sendTerminalInput`. */
  setNativeTheme(theme: ThemePreference): void;
  /**
   * Asks main to lay a snapshot of this window over it, just before the theme is switched: the switch then fades in
   * over a second (`ThemeCrossfade`). Resolves once the snapshot is up, or once it's been given up on.
   */
  prepareThemeFade(): Promise<void>;

  /** Reads the ad blocker's current state — the push channel only fires on change. */
  getAdBlockState(): Promise<AdBlockState | null>;
  /** Subscribes to ad blocker state changes (a toggle, or a tab's blocked count moving). */
  onAdBlockState(listener: (state: AdBlockState) => void): () => void;
  /** Turns the ad blocker on or off everywhere. Fire-and-forget. */
  setAdBlockEnabled(enabled: boolean): void;
  /** Turns blocking on or off for one site (its hostname). Fire-and-forget. */
  setAdBlockSiteAllowed(host: string, allowed: boolean): void;

  /**
   * Reports `useAccentColor`'s current accent so main can style a tab's
   * own page content to match — arbitrary web page content is a separate
   * document `colors.css`'s `::selection` rule can never reach, the same
   * reason main needs `theme` reported via `setNativeTheme` instead of
   * reading it off the chrome's own DOM directly. Fire-and-forget, same as
   * `sendTerminalInput`. Every window's own `useAccentColor` sends this on
   * mount and on every change; main just keeps whichever arrived most
   * recently; see `applySelectionAccent`.
   */
  setAccentColor(rgb: RGB): void;

  /** Minimizes the frameless window. Fire-and-forget, same as `sendTerminalInput`. */
  minimizeWindow(): void;
  /** Toggles the frameless window between maximized and restored. Fire-and-forget, same as `sendTerminalInput`. */
  toggleMaximizeWindow(): void;
  /** Closes the frameless window (and quits the app, once every window is closed). Fire-and-forget, same as `sendTerminalInput`. */
  closeWindow(): void;
  /** Subscribes to the window's maximized state changing; returns an unsubscribe function. */
  onWindowStateChanged(listener: (state: WindowState) => void): () => void;
  /** Reads whether this window is maximized right now (the push channel above only fires on a change). */
  getWindowState(): Promise<WindowState>;
  /** Pushed whenever the active web page's stats change: its tab, and the stats (`null` before it has counted). */
  /**
   * The active tab's stats, as they change: a web page's counts, or what a note's, PDF's or terminal's own stat bar
   * shows, item by item (`items`, `null` for a web page or before its page has said).
   */
  onPageStats(listener: (tabId: string, stats: PageStats | null, items: readonly string[] | null) => void): () => void;
  /** The Wi-Fi connection now (`null` if asked from anywhere but the chrome). */
  getWifiStatus(): Promise<WifiStatus | null>;
  /** Whether the computer has a battery, as Windows reports it; `null` while that's still being asked. */
  getBatteryPresent(): Promise<boolean | null>;
  /** Pushed whenever the Wi-Fi connection or its signal changes. Returns an unsubscribe function. */
  onWifiStatusChanged(listener: (status: WifiStatus) => void): () => void;
  /** The default playback device, its volume and mute now (`null` if asked from anywhere but the chrome). */
  getAudioStatus(): Promise<AudioStatus | null>;
  /** Pushed whenever the default playback device, its volume or its mute changes. Returns an unsubscribe function. */
  onAudioStatusChanged(listener: (status: AudioStatus) => void): () => void;
  /** Bluetooth's connected devices now (`null` if asked from anywhere but the chrome). */
  getBluetoothStatus(): Promise<BluetoothStatus | null>;
  /** Pushed whenever a Bluetooth device connects or disconnects. Returns an unsubscribe function. */
  onBluetoothStatusChanged(listener: (status: BluetoothStatus) => void): () => void;
  /** The outside temperature now (`null` if asked from anywhere but the chrome). */
  getWeather(): Promise<WeatherState | null>;
  /** Pushed whenever the outside temperature changes. Returns an unsubscribe function. */
  onWeatherChanged(listener: (state: WeatherState) => void): () => void;
}

/**
 * The narrower API surface exposed to a terminal tab's own `WebContentsView`
 * (`src/preload/terminal.ts`, `terminal.html`) — deliberately separate from
 * `PortalogiaApi`: this view renders a single tab's `xterm.js` instance and
 * nothing else, so its preload has no business seeing tab/workspace/bookmark
 * management at all, only the byte-level pty channels for the one terminal
 * it's dedicated to (its id comes from its own URL's `?id=` query, not this
 * API). See `TabManager.createTerminalTab` for how this view is created.
 */
export interface PortalogiaTerminalApi {
  /** Whether the window is in Focus Mode, now and whenever it changes: the stat bar hides then. */
  /** The tab's zoom level (Chromium's: 0 is 100%), for the terminal to size its text by; the page itself never zooms. */
  onZoom(listener: (level: number) => void): () => void;
  onFocusMode(listener: (focusMode: boolean) => void): () => void;
  /** Sends raw keystroke/paste bytes from xterm.js to this tab's pty. Fire-and-forget: latency matters more than delivery confirmation. */
  sendTerminalInput(id: string, data: string): void;
  /** Tells this tab's pty its terminal grid resized (e.g. the window resized). Fire-and-forget, same as `sendTerminalInput`. */
  resizeTerminal(id: string, cols: number, rows: number): void;
  /** Subscribes to output bytes streamed from this tab's pty. */
  onTerminalData(listener: (id: string, data: string) => void): () => void;
  /** Subscribes to this tab's shell process exiting on its own (e.g. the user typed `exit`) — distinct from the tab being closed. */
  onTerminalExited(listener: (id: string) => void): () => void;

  /**
   * Subscribes to the highlighter tool's on/off state and current accent
   * color, pushed by `HighlighterController.syncState` whenever the
   * window's toggle changes or this tab is (re)activated — see
   * `Terminal.tsx`. Unlike a browser tab (`src/preload/tabHighlighter.ts`),
   * there's no op/restore/undo-redo channel here: a terminal highlight is
   * never persisted or undoable (see `Terminal.tsx`'s own doc comment for
   * why), so on/off-plus-color is the only thing this tab ever needs told.
   */
  onHighlighterState(listener: (active: boolean, color: RGB) => void): () => void;
  /** Subscribes to find-bar commands for this terminal's buffer. */
  onFind(listener: (command: FindCommand) => void): () => void;
  /** Reports the result of the latest find command. Fire-and-forget. */
  reportFind(result: FindResult): void;
}

/**
 * The narrower API surface exposed to the address bar's own suggestions
 * overlay `WebContentsView` (`src/preload/suggestions.ts`,
 * `suggestions.html`) — like `PortalogiaTerminalApi`, deliberately separate
 * from `PortalogiaApi`: this view renders nothing but the dropdown's own
 * row list, so its preload only needs the two channels that cross that
 * boundary. See `SuggestionsOverlay` for how this view is created and
 * positioned.
 */
export interface PortalogiaAddressSuggestionsApi {
  /** Subscribes to the chrome's latest `syncAddressSuggestions` push. */
  onSync(listener: (payload: AddressSuggestionsSyncPayload) => void): () => void;
  /** Reports a row click back to the chrome's address bar, by index into the list it last synced. Fire-and-forget, same as `sendTerminalInput`. */
  select(index: number): void;
}

/**
 * The narrower API surface exposed to `TooltipOverlay`'s own
 * `WebContentsView` (`src/preload/tooltip.ts`, `tooltip.html`) — like
 * `PortalogiaAddressSuggestionsApi`, this view renders nothing but the
 * tooltip's own text, and unlike it, nothing ever needs to travel back the
 * other way (no clicks land on a tooltip), so this is just the one
 * channel. See `TooltipOverlay` for how this view is created and
 * positioned.
 */
export interface PortalogiaTooltipApi {
  /** Subscribes to the chrome's latest `syncTooltip` push. */
  onSync(listener: (payload: TooltipSyncPayload) => void): () => void;
}

/**
 * The narrower API surface exposed to `ColorPicker`'s own overlay
 * `WebContentsView` (`src/preload/colorPicker.ts`, `color-picker.html`) —
 * unlike `PortalogiaTooltipApi` (nothing ever travels back) but like
 * `PortalogiaAddressSuggestionsApi` (a click reports back by index), this
 * view owns real interaction of its own — dragging the ring/square,
 * typing a channel or hex value — so `changeColor` carries a full color
 * on every change rather than an index into a list the chrome already
 * has. See `ColorPickerOverlay` for how this view is created and
 * positioned.
 */
export interface PortalogiaColorPickerApi {
  /** Subscribes to the chrome's latest `syncColorPicker` push. */
  onSync(listener: (payload: ColorPickerSyncPayload) => void): () => void;
  /** Reports a new color back to the chrome's `ColorPicker` — see `ColorPickerColorChangedPayload`. Fire-and-forget, same as `select` on `PortalogiaAddressSuggestionsApi`. */
  changeColor(rgb: RGB, commit: boolean): void;
  /** Reports the overlay's own Escape keypress back to the chrome, which owns actually closing the dropdown. Fire-and-forget, same as `changeColor`. */
  requestClose(): void;
}

/**
 * The narrower API surface exposed to `ExportMenu`'s own overlay
 * `WebContentsView` (`src/preload/exportMenu.ts`, `export-menu.html`).
 * Choosing a row is handled entirely in main, which runs the export and
 * tells the chrome to close the menu.
 */
export interface PortalogiaExportMenuApi {
  /** Subscribes to the chrome's latest `syncExportMenu` push. */
  onSync(listener: (payload: ExportMenuSyncPayload) => void): () => void;
  /** Reports the chosen row. Fire-and-forget. */
  select(action: MenuOverlayAction): void;
  /** Reports an Escape keypress back to the chrome, which owns closing the menu. Fire-and-forget. */
  requestClose(): void;
}

/** A PDF the user picked from disk: its file name and raw bytes. */
export interface PdfOpenResult {
  readonly name: string;
  readonly data: Uint8Array;
  /** Hash of `data`: the key marks are saved under, so they come back whenever the same document is opened. */
  readonly key: string;
  /** The marks previously saved for this document. */
  readonly annotations: PdfAnnotations;
}

/** Which annotation tool the window has on for a PDF tab. The tools are mutually exclusive in main. */
export type PdfTool = 'none' | 'pen' | 'comment' | 'highlighter' | 'crop' | 'text';

/** The active annotation tool plus the accent color to mark with. */
export interface PdfToolState {
  readonly tool: PdfTool;
  readonly color: RGB;
}

/**
 * The narrower API surface exposed to a PDF tab's own `WebContentsView`
 * (`src/preload/pdf.ts`, `pdf.html`). See `TabManager.createPdfTab`.
 */
export interface PortalogiaPdfApi {
  /** Subscribes to find-bar commands for this tab's document. */
  onFind(listener: (command: FindCommand) => void): () => void;
  /** Reports the result of the latest find command. Fire-and-forget. */
  reportFind(result: FindResult): void;
  /** Subscribes to files opened for this tab (via the chrome toolbar or a shortcut). */
  onFile(listener: (file: PdfOpenResult) => void): () => void;
  /** Reports the marks currently on the open document so main can persist them. Fire-and-forget. */
  saveAnnotations(key: string, annotations: PdfAnnotations): void;
  /** Subscribes to undo (Ctrl+Z) of the page's marks and crops. */
  onUndo(listener: () => void): () => void;
  /** Subscribes to redo (Ctrl+Y) of the page's marks and crops. */
  onRedo(listener: () => void): () => void;
  /** Subscribes to the open file being closed from the toolbar. */
  onClose(listener: () => void): () => void;
  /** Subscribes to "remove every mark" (Revert Annotations). */
  onClear(listener: () => void): () => void;
  /** Subscribes to the annotation tool in use; called immediately with the latest value if one already arrived. */
  onTool(listener: (state: PdfToolState) => void): () => void;
  /** Reports the page in view and the page count so the chrome can show "page / total". Fire-and-forget. */
  reportPage(page: number, pageCount: number): void;
  /** Tells main whether the document's jump history can step back and forward, for the toolbar's arrows. */
  reportHistory(canGoBack: boolean, canGoForward: boolean): void;
  /** Reports how far reading the file it was sent has got (0-100: the document parsed, then its pages measured). Fire-and-forget. */
  reportLoadProgress(percent: number): void;
  /** Whether the window is in Focus Mode, now and whenever it changes: the stat bar hides then. */
  onFocusMode(listener: (focusMode: boolean) => void): () => void;
  /** Subscribes to the side panel's shortcut (Ctrl+Alt+B), which main owns: it shows or hides the panel. */
  onToggleSidePanel(listener: () => void): () => void;
  /** Subscribes to the sections' edit shortcut (Ctrl+Alt+E), which main owns: it opens the panel and switches editing. */
  onToggleSectionEditing(listener: () => void): () => void;
  /** Main asks to step back (-1) or forward (1) through the jump history (the arrows, or Alt+←/→). */
  onHistoryGo(listener: (direction: 1 | -1) => void): () => void;
  /** Subscribes to requests to scroll to a 1-based page. */
  onScrollToPage(listener: (page: number) => void): () => void;
  /** Subscribes to the tab's pointer mode; called immediately with the latest value if one already arrived. */
  onPointerMode(listener: (mode: PointerMode) => void): () => void;
  /** Opens a web link from the document in a new tab. Fire-and-forget; main ignores anything but http(s). */
  openLink(url: string): void;
  /** The notes in the PDF's folder (or vault) that link to it; empty when none, or no file is open. */
  getBacklinks(): Promise<readonly MarkdownBacklink[]>;
  /** Opens one of the notes `getBacklinks` found (its `target`) in a new tab. Fire-and-forget. */
  openBacklink(target: string): void;
  /**
   * Puts the real pointer at a point of this page (viewport CSS pixels): a pan
   * that reaches one edge of the view wraps to the opposite one. Fire-and-forget;
   * clamped to the page by main, and a no-op where the OS pointer can't be moved.
   */
  warpPointer(x: number, y: number): void;
  /**
   * Subscribes to this tab's zoom, as a whole percent (100 = actual size).
   * Called immediately with the latest value if one has already arrived —
   * the page's own subscription can land after main's first push. Unlike
   * browser/terminal tabs (frame zoom), the PDF page applies the zoom to
   * its own rendering so pages re-rasterize crisply instead of stretching.
   */
  onZoom(listener: (percent: number) => void): () => void;
}

/** A Markdown note delivered to a Markdown tab's page: its file name, its source and the marks previously saved for it. */
export interface MarkdownFileData {
  readonly name: string;
  /** The note's source text. */
  readonly content: string;
  /** The marks previously saved for this note. */
  readonly annotations: MarkdownAnnotations;
  /**
   * Which note-opening this is. The page sends it back with every save, so
   * main can refuse an edit that belongs to a note the tab has since left.
   */
  readonly generation: number;
  /** A heading in the note to scroll to once it's drawn (`[[Note#Heading]]`), or `''`. */
  readonly anchor: string;
  /** The line ending the file uses on disk, so the page can tell the file's size exactly. */
  readonly lineEnding: '\n' | '\r\n';
  /**
   * Why it arrived: `'open'` (a different note — start fresh at the top),
   * `'reload'` (the same note changed on disk — keep the place) or
   * `'created'` (a new, empty note — go straight to writing in it).
   */
  readonly reason: 'open' | 'reload' | 'created';
}

/**
 * A formatting command for the editor: what the keyboard shortcuts, the right-click menu and the Tools sidebar's
 * formatting buttons ask for. `'table'` opens a box for the table's size, then puts the table at the caret.
 */
export type MarkdownFormatAction = 'bold' | 'italic' | 'link' | 'latex' | 'code' | 'table';

/** Which annotation tool the window has on for a Markdown tab. The tools are mutually exclusive in main. */
export type MarkdownTool = 'none' | 'pen' | 'comment' | 'highlighter';

/** The active annotation tool plus the accent color to mark with. */
export interface MarkdownToolState {
  readonly tool: MarkdownTool;
  readonly color: RGB;
}

/** A note that links to the open one: its name, and the path from the open note's folder that opens it. */
export interface MarkdownBacklink {
  readonly name: string;
  readonly target: string;
}

/** What running one of a note's code blocks came to. */
export interface MarkdownRunResult {
  /** `false` when it could not be started or the user declined; `error` says why. */
  readonly ran: boolean;
  readonly error: string | null;
  readonly stdout: string;
  readonly stderr: string;
  /** The process's exit code, or `null` if it was stopped before exiting. */
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  /** Whether output past the cap was dropped. */
  readonly truncated: boolean;
  readonly durationMs: number;
}

/**
 * The narrower API surface exposed to a Markdown tab's own `WebContentsView`
 * (`src/preload/markdown.ts`, `markdown.html`). See `TabManager.createMarkdownTab`.
 * Every request a page makes is about its own tab only: main knows which
 * file that is, so the page never names a path to read, write or run.
 */
export interface PortalogiaMarkdownApi {
  /** Subscribes to find-bar commands for this tab's note. */
  onFind(listener: (command: FindCommand) => void): () => void;
  /** Reports the result of the latest find command. Fire-and-forget. */
  reportFind(result: FindResult): void;
  /** Subscribes to notes opened in this tab. */
  onFile(listener: (file: MarkdownFileData) => void): () => void;
  /** Subscribes to the open note being closed from the toolbar. */
  onClose(listener: () => void): () => void;
  /** Subscribes to the view/edit mode; called immediately with the latest value if one already arrived. */
  onMode(listener: (mode: 'view' | 'edit') => void): () => void;
  /** Subscribes to the formatted/raw display; called immediately with the latest value if one already arrived. */
  onDisplay(listener: (display: MarkdownDisplay) => void): () => void;
  /** Calls `listener` with how wide to draw the formatted note (a percent of the page's width), the latest first. */
  onContentWidth(listener: (percent: number) => void): () => void;
  /** Tells main the percent of the page's width the note's usual column takes, for the toolbar's width slider. */
  reportContentWidthMin(percent: number): void;
  /** Subscribes to the tab's pointer mode (Pan or Select); called immediately with the latest value if one already arrived. */
  /** Whether the window is in Focus Mode, now and whenever it changes: the stat bar hides then. */
  onFocusMode(listener: (focusMode: boolean) => void): () => void;
  /** Subscribes to the side panel's shortcut (Ctrl+Alt+B), which main owns: it shows or hides the panel. */
  onToggleSidePanel(listener: () => void): () => void;
  onPointerMode(listener: (mode: PointerMode) => void): () => void;
  /** Asks main to move the OS pointer to a point of this page, for a pan that wraps at an edge. Fire-and-forget. */
  warpPointer(x: number, y: number): void;
  /** Subscribes to formatting shortcuts pressed while the editor is showing (main owns the keys, since Ctrl+B and Ctrl+I are also the app's own). */
  onFormat(listener: (action: MarkdownFormatAction) => void): () => void;
  /** Writes the note's source to disk after an edit, under the `generation` the note arrived with. Fire-and-forget. */
  save(content: string, generation: number): void;
  /** Reports the marks currently on the open note so main can persist them, under the `generation` the note arrived with. Fire-and-forget. */
  saveAnnotations(annotations: MarkdownAnnotations, generation: number): void;
  /** Subscribes to undo (Ctrl+Z) of the page's marks. */
  onUndo(listener: () => void): () => void;
  /** Subscribes to redo (Ctrl+Y) of the page's marks. */
  onRedo(listener: () => void): () => void;
  /** Subscribes to "remove every mark" (Revert Annotations). */
  onClear(listener: () => void): () => void;
  /** Subscribes to the annotation tool in use; called immediately with the latest value if one already arrived. */
  onTool(listener: (state: MarkdownToolState) => void): () => void;
  /**
   * Follows a link: a `[[wikilink]]` (`kind` `'wiki'`, `target` the text
   * inside the brackets) or an ordinary link (`'link'`). A note opens in this
   * tab, or a new one with `newTab`; a web address opens as a browser tab.
   */
  openLink(kind: 'wiki' | 'link', target: string, newTab: boolean): Promise<void>;
  /** For each `[[wikilink]]` name, whether a note by that name exists. */
  resolveLinks(names: readonly string[]): Promise<Readonly<Record<string, boolean>>>;
  /** The notes in the same folder tree that link to the open one. */
  getBacklinks(): Promise<readonly MarkdownBacklink[]>;
  /** The names of the notes in the open one's vault (no extension), for completing `[[`. */
  listNotes(): Promise<readonly string[]>;
  /** An image beside the note as a `data:` URL, or `null` if it can't be read. */
  readImage(src: string): Promise<string | null>;
  /**
   * A web (`https:`) picture as a `data:` URL, or `null` if it can't be
   * fetched. Only for a picture the user clicked to load: a note opened from
   * anywhere must not be able to tell a server it was read.
   */
  readRemoteImage(url: string): Promise<string | null>;
  /** Runs the note's `index`th fenced code block (asking the user first, once per block). */
  runCode(index: number): Promise<MarkdownRunResult>;
  /** Subscribes to this tab's zoom, as a whole percent (100 = actual size) — applied by the page itself, like the PDF viewer's. */
  onZoom(listener: (percent: number) => void): () => void;
}

/**
 * One access in the browsing history: a page reached in a browser tab (when
 * its request was made, the route requested, and the status code it came
 * back with), or a PDF file opened in a PDF tab.
 */
export interface HistoryEntry {
  readonly id: string;
  /** Milliseconds since the epoch. */
  readonly timestamp: number;
  /** `'url'` for a page, `'pdf'` or `'markdown'` for a file on disk. */
  readonly type: 'url' | 'pdf' | 'markdown';
  /** The route requested — a page's URL, or a PDF's or note's path on disk. */
  readonly url: string;
  /** The HTTP status code (a redirect hop records its own 3xx); `0` for a file, which has none. */
  readonly status: number;
  /** The request's HTTP method (`GET`, `POST`, …); `''` for a file, and for a visit recorded before methods were kept. */
  readonly method: string;
}

/** One match for a search bar's dropdown from the history: a page's host (or a PDF's file name) and the route to go to. */
export interface HistorySuggestion {
  readonly title: string;
  /** A page's URL, or a PDF's path on disk. */
  readonly url: string;
}

/**
 * The names of the bookmarks, for the table's Bookmark column to look each
 * route up in: pages by exact URL, PDFs and notes by lower-cased path
 * (Windows paths are case-insensitive, and the page can't tell the platform).
 */
export interface HistoryBookmarkIndex {
  readonly urls: Readonly<Record<string, string>>;
  readonly pdfs: Readonly<Record<string, string>>;
}

/** How far back a clear reaches: the last `amount` of a unit, or everything. */
export type HistoryClearRange =
  | { readonly unit: 'all' }
  | { readonly unit: 'hours' | 'days' | 'weeks' | 'months'; readonly amount: number };

/**
 * The narrower API surface exposed to a History tab's own `WebContentsView`
 * (`src/preload/history.ts`, `history.html`). See `TabManager.createHistoryTab`.
 */
export interface PortalogiaHistoryApi {
  /** Subscribes to the recorded visits (newest first); called immediately with the latest list if one already arrived. */
  onEntries(listener: (entries: readonly HistoryEntry[]) => void): () => void;
  /** Deletes one visit. Fire-and-forget. */
  deleteEntry(id: string): void;
  /** Copies one visit's stored URL (a PDF's path) to the clipboard — main reads it from its own record, so the page can't put arbitrary text there. Fire-and-forget. */
  copyEntry(id: string): void;
  /** Opens one visit in a new tab: a page as a browser tab, a PDF or note in a tab of its kind. Main reads the route from its own record. Fire-and-forget. */
  openEntryInNewTab(id: string): void;
  /** Subscribes to the bookmark names the Bookmark column uses; called immediately with the latest if one already arrived. */
  onBookmarks(listener: (index: HistoryBookmarkIndex) => void): () => void;
  /** Subscribes to the search text the table filters by (typed in the chrome's toolbar); called immediately with the latest if one already arrived. */
  onQuery(listener: (query: string) => void): () => void;
  /** Subscribes to the time range the table shows (the toolbar's number and unit); called immediately with the latest if one already arrived. */
  onRange(listener: (range: HistoryClearRange) => void): () => void;
}

/** Which of a bookmark's editable fields an update is refused over. */
export type BookmarkField = 'title' | 'reference';

/** What main says of a Bookmarks page's edit: kept, or refused over one field and why. */
export type BookmarkUpdateResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly field: BookmarkField; readonly message: string };

/**
 * The narrower API surface exposed to a Bookmarks tab's own `WebContentsView`
 * (`src/preload/bookmarks.ts`, `bookmarks.html`). See `TabManager.createBookmarksTab`.
 */
export interface PortalogiaBookmarksApi {
  /** Subscribes to the saved bookmarks (in the order added); called immediately with the latest list if one already arrived. */
  onBookmarks(listener: (bookmarks: readonly BookmarkState[]) => void): () => void;
  /** Subscribes to the search text the table filters by (typed in the chrome's toolbar); called immediately with the latest if one already arrived. */
  onQuery(listener: (query: string) => void): () => void;
  /** Subscribes to whether the table is viewed or edited (the toolbar's switch); called immediately with the latest if one already arrived. */
  onMode(listener: (mode: 'view' | 'edit') => void): () => void;
  /**
   * Renames a bookmark and points it somewhere else: a page's URL, or a PDF's or note's path. Main checks both (no
   * name or reference another bookmark has, a reference of the bookmark's own kind) before keeping either.
   */
  update(id: string, title: string, reference: string): Promise<BookmarkUpdateResult>;
  /** Deletes one bookmark. Fire-and-forget. */
  remove(id: string): void;
  /** Opens one bookmark in a new tab of its kind. Main reads where it points from its own record. Fire-and-forget. */
  open(id: string): void;
  /** Copies one bookmark's URL (a file's path) to the clipboard — main reads it from its own record, so the page can't put arbitrary text there. Fire-and-forget. */
  copy(id: string): void;
}

/**
 * One saved secret: a username or a password, kept for filling in on a
 * website. Sent only to a Secrets tab's own page (`secrets.html`), never to
 * the chrome or a web page.
 */
export interface SecretState {
  readonly id: string;
  /** What it's called in the table (`example.com - Password` unless renamed). */
  readonly name: string;
  /** The page it's for (origin and path, see `secretSourceOf`); it's filled into pages of the same origin. */
  readonly source: string;
  /** The element it's filled into on that page, as a CSS selector (`input#password`). */
  readonly element: string;
  /** The username or password itself. */
  readonly secret: string;
}

/** Which of a secret's fields an edit or an addition is refused over (the element is typed only when adding one by hand). */
export type SecretField = 'name' | 'source' | 'element' | 'secret';

/** What main says of a Secrets page's edit: kept, or refused over one field and why. */
export type SecretUpdateResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly field: SecretField; readonly message: string };

/**
 * The narrower API surface exposed to a Secrets tab's own `WebContentsView`
 * (`src/preload/secrets.ts`, `secrets.html`). See `TabManager.createSecretsTab`.
 */
export interface PortalogiaSecretsApi {
  /** Subscribes to the saved secrets (in the order saved); called immediately with the latest list if one already arrived. */
  onSecrets(listener: (secrets: readonly SecretState[]) => void): () => void;
  /** Subscribes to the search text the table filters by (typed in the chrome's toolbar); called immediately with the latest if one already arrived. */
  onQuery(listener: (query: string) => void): () => void;
  /** Subscribes to whether the table is viewed or edited (the toolbar's switch); called immediately with the latest if one already arrived. */
  onMode(listener: (mode: 'view' | 'edit') => void): () => void;
  /** Renames a secret, points it at another page and/or changes its value. Main checks all three before keeping any. */
  update(id: string, name: string, source: string, secret: string): Promise<SecretUpdateResult>;
  /** Subscribes to the toolbar's Add button: start a new, empty row. Only presses after subscribing arrive. */
  onAddRow(listener: () => void): () => void;
  /** Keeps a secret typed in by hand: all four of its fields. Main checks them before keeping it. */
  add(name: string, source: string, element: string, secret: string): Promise<SecretUpdateResult>;
  /** Deletes one secret. Fire-and-forget. */
  remove(id: string): void;
  /** Copies one secret's value to the clipboard — main reads it from its own record. Fire-and-forget. */
  copy(id: string): void;
}

/** One field of a login a web page reports (`TabSecretsCaptured`): what was typed, and the element it was typed into. */
export interface CapturedSecretField {
  readonly value: string;
  /** The element, as a CSS selector that finds it again on the page. */
  readonly element: string;
}

/** A login a web page reports as it's sent: the password, and the username typed with it if there was one. */
export interface CapturedLogin {
  readonly username: CapturedSecretField | null;
  readonly password: CapturedSecretField;
}

/** One secret main sends a web page to fill in (`TabSecretsFill`). */
export interface SecretFill {
  readonly element: string;
  readonly value: string;
}

/** What main sends a web page to fill in: only for the origin it was sent for, which the page checks it's still on. */
export interface SecretFillPayload {
  readonly origin: string;
  readonly fills: readonly SecretFill[];
}

/**
 * What the save prompt offers (`SecretPromptShow`): the login's page, what
 * was typed, and the names each secret starts with. Sent only to the prompt's
 * own app page, which shows the password as dots until it's hovered.
 */
export interface SecretPromptOffer {
  /** Identifies this offer; the answer names it, so a late answer to a replaced one is dropped. */
  readonly id: string;
  /** The page the login is for. */
  readonly source: string;
  /** The username typed, shown as typed; `null` when the login had only a password. */
  readonly username: string | null;
  readonly usernameName: string;
  readonly passwordName: string;
  /** The password typed, revealed when its dots are hovered. */
  readonly password: string;
}

/** The save prompt's answer (`SecretPromptAnswer`): save under the names typed, or not. */
export type SecretPromptAnswer =
  | { readonly id: string; readonly accept: true; readonly usernameName: string; readonly passwordName: string }
  | { readonly id: string; readonly accept: false };

/** The API exposed to the save prompt's own `WebContentsView` (`src/preload/secretPrompt.ts`, `secret-prompt.html`). */
export interface PortalogiaSecretPromptApi {
  /** Subscribes to the offer to show (`null` to clear); called immediately with the latest if one already arrived. */
  onOffer(listener: (offer: SecretPromptOffer | null) => void): () => void;
  /** Answers the offer. Fire-and-forget. */
  answer(answer: SecretPromptAnswer): void;
  /** Tells main how tall the card is, in CSS pixels, whenever that changes. Fire-and-forget. */
  reportHeight(height: number): void;
}

/** What a tab's page reports back about a search: how many matches, and which one is current. */
export interface FindResult {
  /** The current match, 1-based; `0` when there are none. */
  readonly index: number;
  readonly total: number;
  /** Counting stopped at the cap (`MAX_FIND_MATCHES`), so `total` is a floor. */
  readonly capped: boolean;
  /** The query is a regular expression that doesn't compile. */
  readonly invalid: boolean;
}

/** What main tells a tab's page to do for the find bar. */
export type FindCommand =
  | {
      readonly action: 'search';
      readonly query: string;
      readonly options: FindOptions;
      /** The accent color matches are painted in. */
      readonly color: RGB;
    }
  | { readonly action: 'step'; readonly direction: 1 | -1 }
  | { readonly action: 'goto'; readonly index: number }
  | { readonly action: 'clear' };

/** Everything the find bar draws. */
export interface FindBarState {
  readonly query: string;
  readonly options: FindOptions;
  readonly result: FindResult;
}

/**
 * The narrower API surface exposed to the find bar's own overlay view
 * (`src/preload/find.ts`, `find.html`). See `FindOverlay`.
 */
export interface PortalogiaFindApi {
  /** Subscribes to what the bar should show; called immediately with the latest if one already arrived. */
  onState(listener: (state: FindBarState) => void): () => void;
  /** Subscribes to "take the keyboard and select the query". */
  onFocus(listener: () => void): () => void;
  /** The query or a switch changed. Fire-and-forget. */
  search(query: string, options: FindOptions): void;
  /** Jumps to the next (`1`) or previous (`-1`) match, looping. Fire-and-forget. */
  step(direction: 1 | -1): void;
  /** Jumps to a typed, 1-based occurrence number. Fire-and-forget. */
  goTo(index: number): void;
  /** Closes the bar. Fire-and-forget. */
  close(): void;
}
