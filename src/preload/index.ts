// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-12

import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannel, type IpcResult, type NorthstarApi, type WindowState } from '@shared/ipc-contract';
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
  moveTab: (id, beforeId) => invoke(IpcChannel.TabsMove, { id, beforeId }),
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

  createWorkspace: (name) => invoke(IpcChannel.WorkspacesCreate, { name }),
  switchWorkspace: (id) => invoke(IpcChannel.WorkspacesSwitch, { id }),
  renameWorkspace: (id, name) => invoke(IpcChannel.WorkspacesRename, { id, name }),
  removeWorkspace: (id) => invoke(IpcChannel.WorkspacesRemove, { id }),

  addBookmark: (title, url) => invoke(IpcChannel.BookmarksAdd, { title, url }),
  removeBookmark: (id) => invoke(IpcChannel.BookmarksRemove, { id }),
  beginBookmarkPreview: (id) => invoke(IpcChannel.TabsBeginBookmarkPreview, { id }),
  endBookmarkPreview: (id) => invoke(IpcChannel.TabsEndBookmarkPreview, { id }),

  enterSplitView: (secondaryId) => invoke(IpcChannel.SplitEnter, { secondaryId }),
  exitSplitView: () => invoke(IpcChannel.SplitExit),

  setFocusMode: (enabled) => invoke(IpcChannel.FocusModeSet, { enabled }),

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
  onToggleTheme: (listener) => {
    const handler = (): void => listener();
    ipcRenderer.on(IpcChannel.UiToggleTheme, handler);
    return () => ipcRenderer.removeListener(IpcChannel.UiToggleTheme, handler);
  },
  setNativeTheme: (theme) => ipcRenderer.send(IpcChannel.ThemeSet, { theme }),

  minimizeWindow: () => ipcRenderer.send(IpcChannel.WindowMinimize),
  toggleMaximizeWindow: () => ipcRenderer.send(IpcChannel.WindowToggleMaximize),
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
