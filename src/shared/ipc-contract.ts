// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-12

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
  TabsMove: 'tabs:move',
  TabsNavigate: 'tabs:navigate',
  TabsGoBack: 'tabs:go-back',
  TabsGoForward: 'tabs:go-forward',
  TabsReload: 'tabs:reload',
  TabsStop: 'tabs:stop',
  TabsGetState: 'tabs:get-state',
  TabsStateChanged: 'tabs:state-changed',
  TabsExportPdf: 'tabs:export-pdf',
  TabsCreateTerminal: 'tabs:create-terminal',
  TerminalInput: 'terminal:input',
  TerminalResize: 'terminal:resize',
  TerminalData: 'terminal:data',
  WorkspacesCreate: 'workspaces:create',
  WorkspacesSwitch: 'workspaces:switch',
  WorkspacesRename: 'workspaces:rename',
  WorkspacesRemove: 'workspaces:remove',
  BookmarksAdd: 'bookmarks:add',
  BookmarksRemove: 'bookmarks:remove',
  SplitEnter: 'split:enter',
  SplitExit: 'split:exit',
  FocusModeSet: 'focus-mode:set',
  UiOpenTabSearch: 'ui:open-tab-search',
  UiFocusAddressBar: 'ui:focus-address-bar',
  WindowMinimize: 'window:minimize',
  WindowToggleMaximize: 'window:toggle-maximize',
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
export interface ExportPdfResult {
  readonly savedPath: string | null;
}

/** Pushed whenever the frameless window's maximized state changes, so `WindowControls` can swap its maximize/restore icon. */
export interface WindowState {
  readonly isMaximized: boolean;
}

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
  /** Reorders a tab (drag-and-drop in the tab bar) to just before `beforeId`, or to the end of its workspace's tabs if `beforeId` is `null`. */
  moveTab(id: string, beforeId: string | null): Promise<IpcResult<BrowserState>>;
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

  /** Opens a new terminal tab (Ctrl+S, the toolbar terminal button, or File > New Terminal). */
  createTerminalTab(): Promise<IpcResult<BrowserState>>;
  /** Sends raw keystroke/paste bytes from xterm.js to the tab's pty. Fire-and-forget: latency matters more than delivery confirmation. */
  sendTerminalInput(id: string, data: string): void;
  /** Tells the tab's pty its terminal grid resized (e.g. the window or sidebar resized). Fire-and-forget, same as `sendTerminalInput`. */
  resizeTerminal(id: string, cols: number, rows: number): void;
  /** Subscribes to output bytes streamed from any terminal tab's pty; the listener filters by id itself. */
  onTerminalData(listener: (id: string, data: string) => void): () => void;

  createWorkspace(name?: string): Promise<IpcResult<BrowserState>>;
  switchWorkspace(id: string): Promise<IpcResult<BrowserState>>;
  renameWorkspace(id: string, name: string): Promise<IpcResult<BrowserState>>;
  removeWorkspace(id: string): Promise<IpcResult<BrowserState>>;

  addBookmark(title: string, url: string): Promise<IpcResult<BrowserState>>;
  removeBookmark(id: string): Promise<IpcResult<BrowserState>>;

  enterSplitView(secondaryId: string): Promise<IpcResult<BrowserState>>;
  exitSplitView(): Promise<IpcResult<BrowserState>>;

  setFocusMode(enabled: boolean): Promise<IpcResult<BrowserState>>;

  /** Subscribes to the menu/accelerator-driven request to open the tab search overlay. */
  onOpenTabSearch(listener: () => void): () => void;

  /** Subscribes to the menu/accelerator-driven request (Ctrl+/) to focus the address bar. */
  onFocusAddressBar(listener: () => void): () => void;

  /** Minimizes the frameless window. Fire-and-forget, same as `sendTerminalInput`. */
  minimizeWindow(): void;
  /** Toggles the frameless window between maximized and restored. Fire-and-forget, same as `sendTerminalInput`. */
  toggleMaximizeWindow(): void;
  /** Requests the frameless window close — a no-op by product decision (see MainWindow.ts). Fire-and-forget, same as `sendTerminalInput`. */
  closeWindow(): void;
  /** Subscribes to the window's maximized state changing; returns an unsubscribe function. */
  onWindowStateChanged(listener: (state: WindowState) => void): () => void;
}
