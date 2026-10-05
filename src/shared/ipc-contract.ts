// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-04

import type { RGB } from '@shared/color';
import type { PdfAnnotations } from '@shared/ipc-schemas';
import type { BrowserState } from '@shared/tab-state';

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
  /** Main → PDF page: the open file was closed; show the empty page. */
  PdfClosed: 'pdf:closed',
  /** Main → PDF page: the file the user just opened. */
  PdfFile: 'pdf:file',
  /** PDF page → main: which page is in view, and how many there are. */
  PdfPageInfo: 'pdf:page-info',
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
  WorkspacesRemove: 'workspaces:remove',
  WorkspaceOpenInNewWindow: 'workspaces:open-in-new-window',
  BookmarksAdd: 'bookmarks:add',
  BookmarksRemove: 'bookmarks:remove',
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
  // `NorthstarApi` since the chrome renderer never sends or receives it.
  // See `TabManager.applyZoom` for why this exists instead of just setting
  // `contents.zoomLevel` from main.
  ZoomApply: 'zoom:apply',
  SidebarToggle: 'sidebar:toggle',
  UiOpenTabSearch: 'ui:open-tab-search',
  UiFocusAddressBar: 'ui:focus-address-bar',
  UiFocusZoom: 'ui:focus-zoom',
  UiToggleTheme: 'ui:toggle-theme',
  ThemeSet: 'theme:set',
  WindowMinimize: 'window:minimize',
  WindowToggleMaximize: 'window:toggle-maximize',
  WindowDragStart: 'window:drag-start',
  WindowDragEnd: 'window:drag-end',
  WindowClose: 'window:close',
  WindowStateChanged: 'window:state-changed',
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

/** Pushed whenever the frameless window's maximized state changes, so `WindowControls` can swap its maximize/restore icon. */
export interface WindowState {
  readonly isMaximized: boolean;
}

/** One bookmark match shown as a row in the address bar's suggestions dropdown. */
export interface AddressSuggestionItem {
  readonly id: string;
  readonly title: string;
  readonly url: string;
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
  readonly open: boolean;
  readonly rect: { readonly top: number; readonly left: number; readonly width: number } | null;
  readonly suggestions: readonly AddressSuggestionItem[];
  readonly selectedIndex: number;
}

/**
 * What a chrome element pushes to `TooltipOverlay` on hover (see
 * `useOverlayTooltip`) — used only by the handful of collapsed-sidebar
 * buttons whose plain CSS tooltip (tooltip.css) can't safely grow past
 * `SIDEBAR_COLLAPSED_WIDTH_PX` without the active tab's native content
 * painting over it. `rect` is `null` whenever `visible` is `false`, same
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

/** What a row in the export dropdown does: save the page as a PDF, or save its HTML/CSS/JS files. */
export type ExportMenuAction = 'pdf' | 'documents';

/**
 * What `ExportMenu` pushes to its dedicated overlay `WebContentsView` on
 * every open/close — see `syncExportMenu` and `ExportMenuOverlay`. `rect`
 * is `null` whenever `open` is `false`. No size: the menu's is fixed
 * (`EXPORT_MENU_WIDTH_PX`/`EXPORT_MENU_HEIGHT_PX`).
 */
export interface ExportMenuSyncPayload {
  readonly open: boolean;
  readonly rect: { readonly top: number; readonly left: number } | null;
  /** False for a terminal tab, whose page is our own UI rather than content worth saving — the documents row is disabled. */
  readonly canExportDocuments: boolean;
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
 * like the `northstar://home` page's `prefers-color-scheme` styling —
 * matches the chrome instead of drifting to whatever the OS prefers.
 */
export type ThemePreference = 'light' | 'dark';

/**
 * The API surface exposed to the renderer via `contextBridge`. Preload
 * implements this exactly (`satisfies NorthstarApi`); the renderer declares
 * `window.northstar` as this type. Keeping the interface here means both sides
 * of the bridge are checked against one definition.
 */
export interface NorthstarApi {
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
  /** Shows the open dialog for a PDF tab; the chosen file is delivered to that tab's page by main. */
  openPdfFile(id: string): Promise<IpcResult<null>>;
  /** Renames a PDF tab's file on disk (same folder). Fails unless the name ends in `.pdf` and doesn't already exist. */
  renamePdfFile(id: string, name: string): Promise<IpcResult<null>>;
  /** Scrolls the tab's PDF to a 1-based page (clamped to the document). */
  goToPdfPage(id: string, page: number): Promise<IpcResult<null>>;

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
  removeWorkspace(id: string): Promise<IpcResult<BrowserState>>;

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
  /** Subscribes to the overlay asking to close — an Escape typed inside it, a click on the live page, or a row being chosen. */
  onExportMenuCloseRequested(listener: () => void): () => void;

  enterSplitView(secondaryId: string): Promise<IpcResult<BrowserState>>;
  exitSplitView(): Promise<IpcResult<BrowserState>>;

  /** Shows or hides the workspace sidebar — `WorkspaceBar`'s own `.sidebar__toggle` button doing the same thing Ctrl+L already does. */
  toggleSidebar(): Promise<IpcResult<BrowserState>>;

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
  /** Sets the active tab's zoom to an exact percent (`ZoomPercentInput`, typing directly) — clamped to 25–200 on the main-process side regardless of what's passed. */
  setZoom(percent: number): Promise<IpcResult<BrowserState>>;

  /** Subscribes to the menu/accelerator-driven request to open the tab search overlay. */
  onOpenTabSearch(listener: () => void): () => void;

  /** Subscribes to the menu/accelerator-driven request (Ctrl+/) to focus the address bar. */
  onFocusAddressBar(listener: () => void): () => void;

  /** Subscribes to the menu/accelerator-driven request (Ctrl+Shift+0) to focus and select `ZoomControl`'s percent field. */
  onFocusZoom(listener: () => void): () => void;

  /** Subscribes to the menu/accelerator-driven request (Ctrl+D) to toggle the light/dark theme — see `useTheme`. */
  onToggleTheme(listener: () => void): () => void;
  /** Reports the renderer's current theme so main can mirror it onto `nativeTheme.themeSource` — see `ThemePreference`. Fire-and-forget, same as `sendTerminalInput`. */
  setNativeTheme(theme: ThemePreference): void;

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
  /** Starts moving this window with the cursor (the titlebar's drag strip was pressed); main follows the cursor until `endWindowDrag`. */
  beginWindowDrag(): void;
  /** Ends the move started by `beginWindowDrag`. */
  endWindowDrag(): void;
  /** Closes the frameless window (and quits the app, once every window is closed). Fire-and-forget, same as `sendTerminalInput`. */
  closeWindow(): void;
  /** Subscribes to the window's maximized state changing; returns an unsubscribe function. */
  onWindowStateChanged(listener: (state: WindowState) => void): () => void;
}

/**
 * The narrower API surface exposed to a terminal tab's own `WebContentsView`
 * (`src/preload/terminal.ts`, `terminal.html`) — deliberately separate from
 * `NorthstarApi`: this view renders a single tab's `xterm.js` instance and
 * nothing else, so its preload has no business seeing tab/workspace/bookmark
 * management at all, only the byte-level pty channels for the one terminal
 * it's dedicated to (its id comes from its own URL's `?id=` query, not this
 * API). See `TabManager.createTerminalTab` for how this view is created.
 */
export interface NorthstarTerminalApi {
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
}

/**
 * The narrower API surface exposed to the address bar's own suggestions
 * overlay `WebContentsView` (`src/preload/suggestions.ts`,
 * `suggestions.html`) — like `NorthstarTerminalApi`, deliberately separate
 * from `NorthstarApi`: this view renders nothing but the dropdown's own
 * row list, so its preload only needs the two channels that cross that
 * boundary. See `SuggestionsOverlay` for how this view is created and
 * positioned.
 */
export interface NorthstarAddressSuggestionsApi {
  /** Subscribes to the chrome's latest `syncAddressSuggestions` push. */
  onSync(listener: (payload: AddressSuggestionsSyncPayload) => void): () => void;
  /** Reports a row click back to the chrome's address bar, by index into the list it last synced. Fire-and-forget, same as `sendTerminalInput`. */
  select(index: number): void;
}

/**
 * The narrower API surface exposed to `TooltipOverlay`'s own
 * `WebContentsView` (`src/preload/tooltip.ts`, `tooltip.html`) — like
 * `NorthstarAddressSuggestionsApi`, this view renders nothing but the
 * tooltip's own text, and unlike it, nothing ever needs to travel back the
 * other way (no clicks land on a tooltip), so this is just the one
 * channel. See `TooltipOverlay` for how this view is created and
 * positioned.
 */
export interface NorthstarTooltipApi {
  /** Subscribes to the chrome's latest `syncTooltip` push. */
  onSync(listener: (payload: TooltipSyncPayload) => void): () => void;
}

/**
 * The narrower API surface exposed to `ColorPicker`'s own overlay
 * `WebContentsView` (`src/preload/colorPicker.ts`, `color-picker.html`) —
 * unlike `NorthstarTooltipApi` (nothing ever travels back) but like
 * `NorthstarAddressSuggestionsApi` (a click reports back by index), this
 * view owns real interaction of its own — dragging the ring/square,
 * typing a channel or hex value — so `changeColor` carries a full color
 * on every change rather than an index into a list the chrome already
 * has. See `ColorPickerOverlay` for how this view is created and
 * positioned.
 */
export interface NorthstarColorPickerApi {
  /** Subscribes to the chrome's latest `syncColorPicker` push. */
  onSync(listener: (payload: ColorPickerSyncPayload) => void): () => void;
  /** Reports a new color back to the chrome's `ColorPicker` — see `ColorPickerColorChangedPayload`. Fire-and-forget, same as `select` on `NorthstarAddressSuggestionsApi`. */
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
export interface NorthstarExportMenuApi {
  /** Subscribes to the chrome's latest `syncExportMenu` push. */
  onSync(listener: (payload: ExportMenuSyncPayload) => void): () => void;
  /** Reports the chosen row. Fire-and-forget. */
  select(action: ExportMenuAction): void;
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
export interface NorthstarPdfApi {
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
  /** Subscribes to requests to scroll to a 1-based page. */
  onScrollToPage(listener: (page: number) => void): () => void;
  /**
   * Subscribes to this tab's zoom, as a whole percent (100 = actual size).
   * Called immediately with the latest value if one has already arrived —
   * the page's own subscription can land after main's first push. Unlike
   * browser/terminal tabs (frame zoom), the PDF page applies the zoom to
   * its own rendering so pages re-rasterize crisply instead of stretching.
   */
  onZoom(listener: (percent: number) => void): () => void;
}
