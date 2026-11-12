// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-12

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_WORKSPACE_ID, ZOOM_PERCENT_DEFAULT } from '@shared/constants';
import type { DropRegionRect, IpcResult, MarkdownFormatAction } from '@shared/ipc-contract';
import type { BrowserState, MarkdownDisplay, PointerMode } from '@shared/tab-state';

const EMPTY_STATE: BrowserState = {
  tabs: [],
  activeTabId: null,
  workspaces: [],
  activeWorkspaceId: DEFAULT_WORKSPACE_ID,
  bookmarks: [],
  workspaceImages: [],
  savedWorkspaceImages: {},
  splitView: null,
  focusMode: false,
  contentFocused: false,
  sidebarVisible: true,
  toolsSidebarVisible: true,
  canRevert: false,
  grabbedTabId: null,
  selectedTabIds: [],
  tabSelectionOrder: [],
  focusedTabId: null,
  selectedWorkspaceIds: [],
  zoomPercent: ZOOM_PERCENT_DEFAULT,
  splitZoomPercent: ZOOM_PERCENT_DEFAULT,
  laserPointerActive: false,
  highlighterActive: false,
  commentToolActive: false,
  textToolActive: false,
  findOpen: false,
  penActive: false,
  cropActive: false,
};

/**
 * Lets the chrome animate again once the first real state has painted. Until then `index.html`'s `state-pending`
 * class holds transitions off, so sidebars remembered closed start closed rather than sliding shut from
 * `EMPTY_STATE`'s open ones as the window appears.
 */
function endStatePending(): void {
  const root = document.documentElement;
  if (!root.classList.contains('state-pending')) {
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('state-pending')));
}

/** Reported to the console when a main-process request fails; the UI itself never blocks on it. */
function logIfFailed(result: IpcResult<unknown>): void {
  if (!result.ok) {
    console.error(`[portalogia] ${result.code}: ${result.message}`);
  }
}

/**
 * Subscribes to the main process's browser state and exposes it alongside
 * the actions that mutate it. Every action fires an IPC request and then
 * relies on the `onStateChanged` push (not the request's own resolved
 * value) to update local state, since main is the single source of truth
 * and other events (e.g. a page finishing a redirect) can update state
 * between the request and its response.
 * @returns The current state and the actions to drive it.
 */
export function useTabs() {
  const [state, setState] = useState<BrowserState>(EMPTY_STATE);

  useEffect(() => {
    let cancelled = false;

    void window.portalogia.getState().then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setState(result.data);
        endStatePending();
      } else {
        logIfFailed(result);
      }
    });

    return window.portalogia.onStateChanged((next) => {
      if (!cancelled) {
        setState(next);
        endStatePending();
      }
    });
  }, []);

  const activeTab = useMemo(
    () => state.tabs.find((tab) => tab.id === state.activeTabId) ?? null,
    [state],
  );

  const workspaceTabs = useMemo(
    () => state.tabs.filter((tab) => tab.workspaceId === state.activeWorkspaceId),
    [state],
  );

  const secondaryTab = useMemo(
    () =>
      state.splitView
        ? (state.tabs.find((tab) => tab.id === state.splitView!.secondaryTabId) ?? null)
        : null,
    [state],
  );

  const createTab = useCallback((url?: string) => {
    void window.portalogia.createTab(url).then(logIfFailed);
  }, []);
  const closeTab = useCallback((id: string) => {
    void window.portalogia.closeTab(id).then(logIfFailed);
  }, []);
  const toggleTabSelection = useCallback((id: string) => {
    void window.portalogia.toggleTabSelection(id).then(logIfFailed);
  }, []);
  const selectTabRange = useCallback((id: string) => {
    void window.portalogia.selectTabRange(id).then(logIfFailed);
  }, []);
  const toggleWorkspaceSelection = useCallback((id: string) => {
    void window.portalogia.toggleWorkspaceSelection(id).then(logIfFailed);
  }, []);
  const selectWorkspaceRange = useCallback((id: string) => {
    void window.portalogia.selectWorkspaceRange(id).then(logIfFailed);
  }, []);
  const activateTab = useCallback((id: string) => {
    void window.portalogia.activateTab(id).then(logIfFailed);
  }, []);
  const moveTab = useCallback((id: string, beforeId: string | null) => {
    void window.portalogia.moveTab(id, beforeId).then(logIfFailed);
  }, []);
  const moveTabToWorkspace = useCallback((id: string, workspaceId: string) => {
    void window.portalogia.moveTabToWorkspace(id, workspaceId).then(logIfFailed);
  }, []);
  const tearOffTab = useCallback((id: string, screenX: number, screenY: number, live?: boolean) => {
    window.portalogia.tearOffTab(id, screenX, screenY, live);
  }, []);
  const reportDropRegions = useCallback((rects: readonly DropRegionRect[]) => {
    window.portalogia.reportDropRegions(rects);
  }, []);
  const tearOffTabEnd = useCallback((id: string, accepted: boolean) => {
    window.portalogia.tearOffTabEnd(id, accepted);
  }, []);
  const navigate = useCallback((id: string, url: string) => {
    void window.portalogia.navigate(id, url).then(logIfFailed);
  }, []);
  const goBack = useCallback((id: string) => {
    void window.portalogia.goBack(id).then(logIfFailed);
  }, []);
  const goForward = useCallback((id: string) => {
    void window.portalogia.goForward(id).then(logIfFailed);
  }, []);
  const reload = useCallback((id: string) => {
    void window.portalogia.reload(id).then(logIfFailed);
  }, []);
  const stop = useCallback((id: string) => {
    void window.portalogia.stop(id).then(logIfFailed);
  }, []);

  const exportToPdf = useCallback((id: string) => {
    void window.portalogia.exportToPdf(id).then(logIfFailed);
  }, []);

  const createPdfTab = useCallback(() => {
    void window.portalogia.createPdfTab().then(logIfFailed);
  }, []);

  const createHistoryTab = useCallback(() => {
    void window.portalogia.createHistoryTab().then(logIfFailed);
  }, []);

  const createBookmarksTab = useCallback(() => {
    void window.portalogia.createBookmarksTab().then(logIfFailed);
  }, []);

  const createSecretsTab = useCallback(() => {
    void window.portalogia.createSecretsTab().then(logIfFailed);
  }, []);

  const openPdfFile = useCallback((id: string) => {
    void window.portalogia.openPdfFile(id).then(logIfFailed);
  }, []);

  const goToPdfPage = useCallback((id: string, page: number) => {
    void window.portalogia.goToPdfPage(id, page).then(logIfFailed);
  }, []);

  const setPointerMode = useCallback((id: string, mode: PointerMode) => {
    void window.portalogia.setPointerMode(id, mode).then(logIfFailed);
  }, []);

  const toggleEditMode = useCallback((id: string) => {
    void window.portalogia.toggleEditMode(id).then(logIfFailed);
  }, []);

  /** Resolves to an error message to show the user, or `null` on success. */
  const renamePdfFile = useCallback(async (id: string, name: string): Promise<string | null> => {
    const result = await window.portalogia.renamePdfFile(id, name);
    return result.ok ? null : result.message;
  }, []);

  const createMarkdownTab = useCallback(() => {
    void window.portalogia.createMarkdownTab().then(logIfFailed);
  }, []);
  const openMarkdownFile = useCallback((id: string) => {
    void window.portalogia.openMarkdownFile(id).then(logIfFailed);
  }, []);
  const newMarkdownFile = useCallback((id: string) => {
    void window.portalogia.newMarkdownFile(id).then(logIfFailed);
  }, []);
  const closeMarkdownFile = useCallback((id: string) => {
    void window.portalogia.closeMarkdownFile(id).then(logIfFailed);
  }, []);
  /** Resolves to an error message to show the user, or `null` on success. */
  const renameMarkdownFile = useCallback(async (id: string, name: string): Promise<string | null> => {
    const result = await window.portalogia.renameMarkdownFile(id, name);
    return result.ok ? null : result.message;
  }, []);
  const setMarkdownMode = useCallback((id: string, mode: 'view' | 'edit') => {
    void window.portalogia.setMarkdownMode(id, mode).then(logIfFailed);
  }, []);

  const setMarkdownDisplay = useCallback((id: string, display: MarkdownDisplay) => {
    void window.portalogia.setMarkdownDisplay(id, display).then(logIfFailed);
  }, []);
  const navigateMarkdownHistory = useCallback((id: string, direction: 1 | -1) => {
    void window.portalogia.navigateMarkdownHistory(id, direction).then(logIfFailed);
  }, []);
  const formatMarkdown = useCallback((id: string, action: MarkdownFormatAction) => {
    void window.portalogia.formatMarkdown(id, action).then(logIfFailed);
  }, []);
  const addMarkdownBookmark = useCallback((id: string, name: string) => {
    void window.portalogia.addMarkdownBookmark(id, name).then(logIfFailed);
  }, []);
  const openMarkdownPath = useCallback((id: string, path: string) => {
    window.portalogia.openMarkdownPath(id, path);
  }, []);
  const openMarkdownBookmark = useCallback((id: string, bookmarkId: string) => {
    window.portalogia.openMarkdownBookmark(id, bookmarkId);
  }, []);

  const createTerminalTab = useCallback(() => {
    void window.portalogia.createTerminalTab().then(logIfFailed);
  }, []);

  const revertPage = useCallback((id: string) => {
    void window.portalogia.revertPage(id).then(logIfFailed);
  }, []);

  const createWorkspace = useCallback((name?: string) => {
    void window.portalogia.createWorkspace(name).then(logIfFailed);
  }, []);
  const createWorkspaceWithTab = useCallback((tabId: string) => {
    void window.portalogia.createWorkspaceWithTab(tabId).then(logIfFailed);
  }, []);
  const switchWorkspace = useCallback((id: string) => {
    void window.portalogia.switchWorkspace(id).then(logIfFailed);
  }, []);
  const moveWorkspace = useCallback((id: string, beforeId: string | null) => {
    void window.portalogia.moveWorkspace(id, beforeId).then(logIfFailed);
  }, []);

  const renameWorkspace = useCallback((id: string, name: string) => {
    void window.portalogia.renameWorkspace(id, name).then(logIfFailed);
  }, []);
  const updateWorkspace = useCallback((id: string, update: { name: string; color: string; icon: string }) => {
    void window.portalogia.updateWorkspace(id, update).then(logIfFailed);
  }, []);
  const saveWorkspaceImage = useCallback((workspaceId: string) => {
    void window.portalogia.saveWorkspaceImage(workspaceId).then(logIfFailed);
  }, []);
  const openWorkspaceImage = useCallback((id: string) => {
    void window.portalogia.openWorkspaceImage(id).then(logIfFailed);
  }, []);
  const removeWorkspaceImage = useCallback((id: string) => {
    void window.portalogia.removeWorkspaceImage(id).then(logIfFailed);
  }, []);
  const renameWorkspaceImage = useCallback((id: string, name: string) => {
    void window.portalogia.renameWorkspaceImage(id, name).then(logIfFailed);
  }, []);
  const removeWorkspace = useCallback((id: string) => {
    void window.portalogia.removeWorkspace(id).then(logIfFailed);
  }, []);
  const openWorkspaceInNewWindow = useCallback(() => {
    window.portalogia.openWorkspaceInNewWindow();
  }, []);

  const addBookmark = useCallback((title: string, url: string) => {
    void window.portalogia.addBookmark(title, url).then(logIfFailed);
  }, []);
  const addPdfBookmark = useCallback((id: string, name: string) => {
    void window.portalogia.addPdfBookmark(id, name).then(logIfFailed);
  }, []);
  const openPdfPath = useCallback((id: string, path: string) => {
    window.portalogia.openPdfPath(id, path);
  }, []);
  const openPdfBookmark = useCallback((id: string, bookmarkId: string) => {
    window.portalogia.openPdfBookmark(id, bookmarkId);
  }, []);
  const toggleBookmark = useCallback((id: string) => {
    void window.portalogia.toggleBookmark(id).then(logIfFailed);
  }, []);
  const removeBookmark = useCallback((id: string) => {
    void window.portalogia.removeBookmark(id).then(logIfFailed);
  }, []);

  const beginTabPreview = useCallback(async (id: string): Promise<string | null> => {
    const result = await window.portalogia.beginTabPreview(id);
    logIfFailed(result);
    return result.ok ? result.data : null;
  }, []);
  const endTabPreview = useCallback((id: string) => {
    void window.portalogia.endTabPreview(id).then(logIfFailed);
  }, []);

  const enterSplitView = useCallback((secondaryId: string) => {
    void window.portalogia.enterSplitView(secondaryId).then(logIfFailed);
  }, []);
  const exitSplitView = useCallback(() => {
    void window.portalogia.exitSplitView().then(logIfFailed);
  }, []);

  const toggleSplitScreen = useCallback(() => {
    void window.portalogia.toggleSplitScreen().then(logIfFailed);
  }, []);
  const swapSplitSides = useCallback(() => {
    void window.portalogia.swapSplitSides().then(logIfFailed);
  }, []);
  const toggleToolsSidebar = useCallback(() => {
    void window.portalogia.toggleToolsSidebar().then(logIfFailed);
  }, []);
  const toggleSidebar = useCallback(() => {
    void window.portalogia.toggleSidebar().then(logIfFailed);
  }, []);

  const setFocusMode = useCallback((enabled: boolean) => {
    void window.portalogia.setFocusMode(enabled).then(logIfFailed);
  }, []);

  const setLaserPointer = useCallback((enabled: boolean) => {
    void window.portalogia.setLaserPointer(enabled).then(logIfFailed);
  }, []);

  const setHighlighter = useCallback((enabled: boolean) => {
    void window.portalogia.setHighlighter(enabled).then(logIfFailed);
  }, []);

  const setCommentTool = useCallback((enabled: boolean) => {
    void window.portalogia.setCommentTool(enabled).then(logIfFailed);
  }, []);

  const setTextTool = useCallback((enabled: boolean) => {
    void window.portalogia.setTextTool(enabled).then(logIfFailed);
  }, []);

  const setFind = useCallback((enabled: boolean) => {
    void window.portalogia.setFind(enabled).then(logIfFailed);
  }, []);

  const setCrop = useCallback((enabled: boolean) => {
    void window.portalogia.setCrop(enabled).then(logIfFailed);
  }, []);

  const closePdfFile = useCallback((id: string) => {
    void window.portalogia.closePdfFile(id).then(logIfFailed);
  }, []);

  const exportPdfFile = useCallback((id: string) => {
    void window.portalogia.exportPdfFile(id).then(logIfFailed);
  }, []);

  const setPen = useCallback((enabled: boolean) => {
    void window.portalogia.setPen(enabled).then(logIfFailed);
  }, []);

  const zoomIn = useCallback(() => {
    void window.portalogia.zoomIn().then(logIfFailed);
  }, []);
  const zoomOut = useCallback(() => {
    void window.portalogia.zoomOut().then(logIfFailed);
  }, []);
  const setZoom = useCallback((percent: number, tabId?: string) => {
    void window.portalogia.setZoom(percent, tabId).then(logIfFailed);
  }, []);

  return {
    tabs: state.tabs,
    activeTab,
    activeTabId: state.activeTabId,
    workspaces: state.workspaces,
    activeWorkspaceId: state.activeWorkspaceId,
    workspaceTabs,
    bookmarks: state.bookmarks,
    workspaceImages: state.workspaceImages,
    savedWorkspaceImages: state.savedWorkspaceImages,
    splitView: state.splitView,
    secondaryTab,
    focusMode: state.focusMode,
    contentFocused: state.contentFocused,
    sidebarVisible: state.sidebarVisible,
    toolsSidebarVisible: state.toolsSidebarVisible,
    canRevert: state.canRevert,
    grabbedTabId: state.grabbedTabId,
    selectedTabIds: state.selectedTabIds,
    tabSelectionOrder: state.tabSelectionOrder,
    focusedTabId: state.focusedTabId,
    selectedWorkspaceIds: state.selectedWorkspaceIds,

    createTab,
    closeTab,
    activateTab,
    toggleTabSelection,
    selectTabRange,
    toggleWorkspaceSelection,
    selectWorkspaceRange,
    moveTab,
    moveTabToWorkspace,
    tearOffTab,
    tearOffTabEnd,
    reportDropRegions,
    navigate,
    goBack,
    goForward,
    reload,
    stop,
    exportToPdf,
    createTerminalTab,
    createPdfTab,
    createHistoryTab,
    createBookmarksTab,
    createSecretsTab,
    openPdfFile,
    goToPdfPage,
    setPointerMode,
    toggleEditMode,
    renamePdfFile,
    createMarkdownTab,
    openMarkdownFile,
    newMarkdownFile,
    closeMarkdownFile,
    renameMarkdownFile,
    setMarkdownMode,
    setMarkdownDisplay,
    navigateMarkdownHistory,
    formatMarkdown,
    addMarkdownBookmark,
    openMarkdownPath,
    openMarkdownBookmark,
    revertPage,

    createWorkspace,
    createWorkspaceWithTab,
    switchWorkspace,
    renameWorkspace,
    moveWorkspace,
    updateWorkspace,
    removeWorkspace,
    saveWorkspaceImage,
    openWorkspaceImage,
    removeWorkspaceImage,
    renameWorkspaceImage,
    openWorkspaceInNewWindow,

    addBookmark,
    removeBookmark,
    toggleBookmark,
    addPdfBookmark,
    openPdfBookmark,
    openPdfPath,
    beginTabPreview,
    endTabPreview,

    enterSplitView,
    exitSplitView,

    toggleSidebar,
    toggleToolsSidebar,
    toggleSplitScreen,
    swapSplitSides,

    setFocusMode,
    zoomPercent: state.zoomPercent,
    splitZoomPercent: state.splitZoomPercent,
    zoomIn,
    zoomOut,
    setZoom,

    laserPointerActive: state.laserPointerActive,
    setLaserPointer,
    highlighterActive: state.highlighterActive,
    setHighlighter,
    commentToolActive: state.commentToolActive,
    setCommentTool,
    textToolActive: state.textToolActive,
    findOpen: state.findOpen,
    setFind,
    setTextTool,
    penActive: state.penActive,
    setPen,
    cropActive: state.cropActive,
    setCrop,
    exportPdfFile,
    closePdfFile,
  };
}
