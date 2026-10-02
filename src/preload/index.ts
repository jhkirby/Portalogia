// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-12

import { contextBridge, ipcRenderer } from 'electron';
import {
  IpcChannel,
  type ColorPickerColorChangedPayload,
  type IpcResult,
  type NorthstarApi,
  type WindowState,
} from '@shared/ipc-contract';
import type { BrowserState } from '@shared/tab-state';

/**
 * Invokes a channel and returns its `IpcResult` unchanged — the renderer
 * decides how to react to a failure.
 * @param channel Channel to invoke.
 * @param payload Request payload matching that channel's schema.
 * @returns The main process's `IpcResult`.
 */
function invoke<T>(channel: string, payload?: unknown): Promise<IpcResult<T>> {
  return ipcRenderer.invoke(channel, payload) as Promise<IpcResult<T>>;
}

const api: NorthstarApi = {
  createTab: (url) => invoke(IpcChannel.TabsCreate, { url }),
  closeTab: (id) => invoke(IpcChannel.TabsClose, { id }),
  activateTab: (id) => invoke(IpcChannel.TabsActivate, { id }),
  toggleTabSelection: (id) => invoke(IpcChannel.TabsToggleSelect, { id }),
  selectTabRange: (id) => invoke(IpcChannel.TabsSelectRange, { id }),
  moveTab: (id, beforeId) => invoke(IpcChannel.TabsMove, { id, beforeId }),
  moveTabToWorkspace: (id, workspaceId) => invoke(IpcChannel.TabsMoveToWorkspace, { id, workspaceId }),
  tearOffTab: (id, screenX, screenY, live) =>
    ipcRenderer.send(IpcChannel.TabsTearOff, { id, screenX, screenY, live }),
  reportDropRegions: (rects) => ipcRenderer.send(IpcChannel.TabsDropRegions, { rects }),
  tearOffTabEnd: (id, accepted) => ipcRenderer.send(IpcChannel.TabsTearOffEnd, { id, accepted }),
  navigate: (id, url) => invoke(IpcChannel.TabsNavigate, { id, url }),
  goBack: (id) => invoke(IpcChannel.TabsGoBack, { id }),
  goForward: (id) => invoke(IpcChannel.TabsGoForward, { id }),
  reload: (id) => invoke(IpcChannel.TabsReload, { id }),
  stop: (id) => invoke(IpcChannel.TabsStop, { id }),
  getState: () => invoke(IpcChannel.TabsGetState),
  onStateChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: BrowserState): void => {
      listener(state);
    };
    ipcRenderer.on(IpcChannel.TabsStateChanged, handler);
    return () => ipcRenderer.removeListener(IpcChannel.TabsStateChanged, handler);
  },

  exportToPdf: (id) => invoke(IpcChannel.TabsExportPdf, { id }),

  createTerminalTab: () => invoke(IpcChannel.TabsCreateTerminal),
  createPdfTab: () => invoke(IpcChannel.TabsCreatePdf),
  revertPage: (id) => invoke(IpcChannel.TabsRevertPage, { id }),

  createWorkspace: (name) => invoke(IpcChannel.WorkspacesCreate, { name }),
  createWorkspaceWithTab: (tabId) => invoke(IpcChannel.WorkspacesCreateWithTab, { tabId }),
  switchWorkspace: (id) => invoke(IpcChannel.WorkspacesSwitch, { id }),
  toggleWorkspaceSelection: (id) => invoke(IpcChannel.WorkspacesToggleSelect, { id }),
  selectWorkspaceRange: (id) => invoke(IpcChannel.WorkspacesSelectRange, { id }),
  renameWorkspace: (id, name) => invoke(IpcChannel.WorkspacesRename, { id, name }),
  removeWorkspace: (id) => invoke(IpcChannel.WorkspacesRemove, { id }),
  openWorkspaceInNewWindow: () => ipcRenderer.send(IpcChannel.WorkspaceOpenInNewWindow),

  addBookmark: (title, url) => invoke(IpcChannel.BookmarksAdd, { title, url }),
  removeBookmark: (id) => invoke(IpcChannel.BookmarksRemove, { id }),
  beginTabPreview: (id) => invoke(IpcChannel.TabsBeginTabPreview, { id }),
  endTabPreview: (id) => invoke(IpcChannel.TabsEndTabPreview, { id }),
  syncAddressSuggestions: (payload) => ipcRenderer.send(IpcChannel.AddressSuggestionsSync, payload),
  onAddressSuggestionSelected: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, index: number): void => listener(index);
    ipcRenderer.on(IpcChannel.AddressSuggestionsSelect, handler);
    return () => ipcRenderer.removeListener(IpcChannel.AddressSuggestionsSelect, handler);
  },
  syncTooltip: (payload) => ipcRenderer.send(IpcChannel.TooltipSync, payload),

  syncExportMenu: (payload) => ipcRenderer.send(IpcChannel.ExportMenuSync, payload),
  onExportMenuCloseRequested: (listener) => {
    const handler = (): void => listener();
    ipcRenderer.on(IpcChannel.ExportMenuCloseRequested, handler);
    return () => ipcRenderer.removeListener(IpcChannel.ExportMenuCloseRequested, handler);
  },
  syncColorPicker: (payload) => ipcRenderer.send(IpcChannel.ColorPickerSync, payload),
  onColorPickerColorChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ColorPickerColorChangedPayload): void =>
      listener(payload);
    ipcRenderer.on(IpcChannel.ColorPickerColorChanged, handler);
    return () => ipcRenderer.removeListener(IpcChannel.ColorPickerColorChanged, handler);
  },
  onColorPickerCloseRequested: (listener) => {
    const handler = (): void => listener();
    ipcRenderer.on(IpcChannel.ColorPickerCloseRequested, handler);
    return () => ipcRenderer.removeListener(IpcChannel.ColorPickerCloseRequested, handler);
  },

  enterSplitView: (secondaryId) => invoke(IpcChannel.SplitEnter, { secondaryId }),
  exitSplitView: () => invoke(IpcChannel.SplitExit),

  toggleSidebar: () => invoke(IpcChannel.SidebarToggle),

  setFocusMode: (enabled) => invoke(IpcChannel.FocusModeSet, { enabled }),
  setLaserPointer: (enabled) => invoke(IpcChannel.LaserPointerSet, { enabled }),
  setHighlighter: (enabled) => invoke(IpcChannel.HighlighterSet, { enabled }),
  setCommentTool: (enabled) => invoke(IpcChannel.CommentToolSet, { enabled }),
  setPen: (enabled) => invoke(IpcChannel.PenSet, { enabled }),

  zoomIn: () => invoke(IpcChannel.ZoomIn),
  zoomOut: () => invoke(IpcChannel.ZoomOut),
  resetZoom: () => invoke(IpcChannel.ZoomReset),
  setZoom: (percent) => invoke(IpcChannel.ZoomSet, { percent }),

  onOpenTabSearch: (listener) => {
    const handler = (): void => listener();
    ipcRenderer.on(IpcChannel.UiOpenTabSearch, handler);
    return () => ipcRenderer.removeListener(IpcChannel.UiOpenTabSearch, handler);
  },

  onFocusAddressBar: (listener) => {
    const handler = (): void => listener();
    ipcRenderer.on(IpcChannel.UiFocusAddressBar, handler);
    return () => ipcRenderer.removeListener(IpcChannel.UiFocusAddressBar, handler);
  },
  onFocusZoom: (listener) => {
    const handler = (): void => listener();
    ipcRenderer.on(IpcChannel.UiFocusZoom, handler);
    return () => ipcRenderer.removeListener(IpcChannel.UiFocusZoom, handler);
  },
  onToggleTheme: (listener) => {
    const handler = (): void => listener();
    ipcRenderer.on(IpcChannel.UiToggleTheme, handler);
    return () => ipcRenderer.removeListener(IpcChannel.UiToggleTheme, handler);
  },
  setNativeTheme: (theme) => ipcRenderer.send(IpcChannel.ThemeSet, { theme }),
  setAccentColor: (rgb) => ipcRenderer.send(IpcChannel.AccentColorSet, rgb),

  minimizeWindow: () => ipcRenderer.send(IpcChannel.WindowMinimize),
  toggleMaximizeWindow: () => ipcRenderer.send(IpcChannel.WindowToggleMaximize),
  beginWindowDrag: () => ipcRenderer.send(IpcChannel.WindowDragStart),
  endWindowDrag: () => ipcRenderer.send(IpcChannel.WindowDragEnd),
  closeWindow: () => ipcRenderer.send(IpcChannel.WindowClose),
  onWindowStateChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: WindowState): void => {
      listener(state);
    };
    ipcRenderer.on(IpcChannel.WindowStateChanged, handler);
    return () => ipcRenderer.removeListener(IpcChannel.WindowStateChanged, handler);
  },
};

contextBridge.exposeInMainWorld('northstar', api satisfies NorthstarApi);
