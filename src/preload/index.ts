// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-18

import { contextBridge, ipcRenderer } from 'electron';
import {
  IpcChannel,
  type AdBlockState,
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
  createHistoryTab: () => invoke(IpcChannel.TabsCreateHistory),
  setFind: (enabled) => invoke(IpcChannel.FindSet, { enabled }),
  setHistoryQuery: (id, query) => ipcRenderer.send(IpcChannel.HistorySetQuery, { id, query }),
  setHistoryRange: (id, range) => ipcRenderer.send(IpcChannel.HistorySetRange, { id, range }),
  clearHistory: (range) => invoke(IpcChannel.HistoryClear, range),
  searchHistory: (type, query) => invoke(IpcChannel.HistorySearch, { type, query }),
  openPdfPath: (id, path) => ipcRenderer.send(IpcChannel.PdfOpenPath, { id, path }),
  openPdfFile: (id) => invoke(IpcChannel.PdfOpenFile, { id }),
  renamePdfFile: (id, name) => invoke(IpcChannel.PdfRename, { id, name }),
  goToPdfPage: (id, page) => invoke(IpcChannel.PdfGoToPage, { id, page }),
  setPdfPointerMode: (id, mode) => invoke(IpcChannel.PdfSetPointerMode, { id, mode }),
  createMarkdownTab: () => invoke(IpcChannel.TabsCreateMarkdown),
  openMarkdownFile: (id) => invoke(IpcChannel.MarkdownOpenFile, { id }),
  newMarkdownFile: (id) => invoke(IpcChannel.MarkdownNewFile, { id }),
  closeMarkdownFile: (id) => invoke(IpcChannel.MarkdownCloseFile, { id }),
  renameMarkdownFile: (id, name) => invoke(IpcChannel.MarkdownRename, { id, name }),
  setMarkdownMode: (id, mode) => invoke(IpcChannel.MarkdownSetMode, { id, mode }),
  setMarkdownDisplay: (id, display) => invoke(IpcChannel.MarkdownSetDisplay, { id, display }),
  navigateMarkdownHistory: (id, direction) => invoke(IpcChannel.MarkdownNavigateHistory, { id, direction }),
  exportMarkdown: (id, format) => invoke(IpcChannel.MarkdownExport, { id, format }),
  openMarkdownBookmark: (id, bookmarkId) => ipcRenderer.send(IpcChannel.MarkdownOpenBookmark, { id, bookmarkId }),
  openMarkdownPath: (id, path) => ipcRenderer.send(IpcChannel.MarkdownOpenPath, { id, path }),
  revertPage: (id) => invoke(IpcChannel.TabsRevertPage, { id }),

  createWorkspace: (name) => invoke(IpcChannel.WorkspacesCreate, { name }),
  createWorkspaceWithTab: (tabId) => invoke(IpcChannel.WorkspacesCreateWithTab, { tabId }),
  switchWorkspace: (id) => invoke(IpcChannel.WorkspacesSwitch, { id }),
  toggleWorkspaceSelection: (id) => invoke(IpcChannel.WorkspacesToggleSelect, { id }),
  selectWorkspaceRange: (id) => invoke(IpcChannel.WorkspacesSelectRange, { id }),
  renameWorkspace: (id, name) => invoke(IpcChannel.WorkspacesRename, { id, name }),
  updateWorkspace: (id, update) => invoke(IpcChannel.WorkspacesUpdate, { id, ...update }),
  removeWorkspace: (id) => invoke(IpcChannel.WorkspacesRemove, { id }),
  saveWorkspaceImage: (workspaceId) => invoke(IpcChannel.WorkspaceImagesSave, { id: workspaceId }),
  openWorkspaceImage: (id) => invoke(IpcChannel.WorkspaceImagesOpen, { id }),
  removeWorkspaceImage: (id) => invoke(IpcChannel.WorkspaceImagesRemove, { id }),
  renameWorkspaceImage: (id, name) => invoke(IpcChannel.WorkspaceImagesRename, { id, name }),
  openWorkspaceInNewWindow: () => ipcRenderer.send(IpcChannel.WorkspaceOpenInNewWindow),

  addBookmark: (title, url) => invoke(IpcChannel.BookmarksAdd, { title, url }),
  removeBookmark: (id) => invoke(IpcChannel.BookmarksRemove, { id }),
  toggleBookmark: (id) => invoke(IpcChannel.BookmarksToggle, { id }),
  addPdfBookmark: (id, name) => invoke(IpcChannel.BookmarksAddPdf, { id, name }),
  openPdfBookmark: (id, bookmarkId) => ipcRenderer.send(IpcChannel.PdfOpenBookmark, { id, bookmarkId }),
  addMarkdownBookmark: (id, name) => invoke(IpcChannel.BookmarksAddMarkdown, { id, name }),
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
  setTextTool: (enabled) => invoke(IpcChannel.TextToolSet, { enabled }),
  setPen: (enabled) => invoke(IpcChannel.PenSet, { enabled }),
  setCrop: (enabled) => invoke(IpcChannel.CropSet, { enabled }),
  closePdfFile: (id) => invoke(IpcChannel.PdfCloseFile, { id }),
  exportPdfFile: (id) => invoke(IpcChannel.PdfExport, { id }),

  zoomIn: () => invoke(IpcChannel.ZoomIn),
  zoomOut: () => invoke(IpcChannel.ZoomOut),
  resetZoom: () => invoke(IpcChannel.ZoomReset),
  setZoom: (percent) => invoke(IpcChannel.ZoomSet, { percent }),

  onEditWorkspace: (listener) => {
    const handler = (): void => listener();
    ipcRenderer.on(IpcChannel.UiEditWorkspace, handler);
    return () => ipcRenderer.removeListener(IpcChannel.UiEditWorkspace, handler);
  },

  onOpenWorkspaceImages: (listener) => {
    const handler = (): void => listener();
    ipcRenderer.on(IpcChannel.UiOpenWorkspaceImages, handler);
    return () => ipcRenderer.removeListener(IpcChannel.UiOpenWorkspaceImages, handler);
  },
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
  getAdBlockState: () => ipcRenderer.invoke(IpcChannel.AdBlockGetState),
  onAdBlockState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: AdBlockState): void => listener(state);
    ipcRenderer.on(IpcChannel.AdBlockState, handler);
    return () => ipcRenderer.removeListener(IpcChannel.AdBlockState, handler);
  },
  setAdBlockEnabled: (enabled) => ipcRenderer.send(IpcChannel.AdBlockSetEnabled, { enabled }),
  setAdBlockSiteAllowed: (host, allowed) => ipcRenderer.send(IpcChannel.AdBlockSetSiteAllowed, { host, allowed }),
  setAccentColor: (rgb) => ipcRenderer.send(IpcChannel.AccentColorSet, rgb),

  minimizeWindow: () => ipcRenderer.send(IpcChannel.WindowMinimize),
  toggleMaximizeWindow: () => ipcRenderer.send(IpcChannel.WindowToggleMaximize),
  beginWindowDrag: () => ipcRenderer.send(IpcChannel.WindowDragStart),
  endWindowDrag: () => ipcRenderer.send(IpcChannel.WindowDragEnd),
  closeWindow: () => ipcRenderer.send(IpcChannel.WindowClose),
  getWindowState: () => ipcRenderer.invoke(IpcChannel.WindowGetState),
  onWindowStateChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: WindowState): void => {
      listener(state);
    };
    ipcRenderer.on(IpcChannel.WindowStateChanged, handler);
    return () => ipcRenderer.removeListener(IpcChannel.WindowStateChanged, handler);
  },
};

contextBridge.exposeInMainWorld('northstar', api satisfies NorthstarApi);

// Tells main whether the keyboard is in something you type into, so a shortcut that is also an editing key
// (Ctrl+Left/Right jumping a word) can leave the caret alone instead of switching tabs. A `contenteditable`
// region is reported as 'rich': a web page's rich editor gives Ctrl+B/I/U meanings of its own. Repeated in each
// preload that needs it: two entries can't share a module (see the note on `tabZoom.ts`'s imports).
const EditableFocus = 'ui:editable-focus';
const NON_TEXT_INPUT_TYPES = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit']);
function isEditableElement(element: Element | null): element is HTMLElement {
  return (
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.has(element.type)) ||
    (element instanceof HTMLElement && element.isContentEditable)
  );
}
let editableReported: 'plain' | 'rich' | false = false;
function reportEditableFocus(): void {
  const element = document.activeElement;
  const editable = !isEditableElement(element) ? false : element.isContentEditable ? 'rich' : 'plain';
  if (editable !== editableReported) {
    editableReported = editable;
    ipcRenderer.send(EditableFocus, editable);
  }
}
window.addEventListener('focusin', reportEditableFocus, true);
// `focusout` fires before the next element has focus, so look once focus has settled.
window.addEventListener('focusout', () => setTimeout(reportEditableFocus, 0), true);

// Escape takes the caret out of a text box, so the shortcuts that stand aside while one has it work again. Decided
// once the page's own handlers have had the key: one that used Escape itself (closing a suggestion list or a popup)
// called `preventDefault`, and then the caret stays for the next press.
window.addEventListener(
  'keydown',
  (event) => {
    if (event.key !== 'Escape' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.isComposing) {
      return;
    }
    const element = document.activeElement;
    if (!isEditableElement(element)) {
      return;
    }
    setTimeout(() => {
      if (!event.defaultPrevented && document.activeElement === element) {
        element.blur();
      }
    }, 0);
  },
  true,
);
