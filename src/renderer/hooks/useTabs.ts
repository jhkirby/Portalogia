// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-18

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_WORKSPACE_ID, ZOOM_PERCENT_DEFAULT } from '@shared/constants';
import type { DropRegionRect, IpcResult } from '@shared/ipc-contract';
import type { BrowserState, MarkdownDisplay, PdfPointerMode } from '@shared/tab-state';

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
  sidebarVisible: true,
  grabbedTabId: null,
  selectedTabIds: [],
  selectedWorkspaceIds: [],
  zoomPercent: ZOOM_PERCENT_DEFAULT,
  laserPointerActive: false,
  highlighterActive: false,
  commentToolActive: false,
  textToolActive: false,
  findOpen: false,
  penActive: false,
  cropActive: false,
};

/** Reported to the console when a main-process request fails; the UI itself never blocks on it. */
function logIfFailed(result: IpcResult<unknown>): void {
  if (!result.ok) {
    console.error(`[northstar] ${result.code}: ${result.message}`);
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

    void window.northstar.getState().then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setState(result.data);
      } else {
        logIfFailed(result);
      }
    });

    return window.northstar.onStateChanged((next) => {
      if (!cancelled) {
        setState(next);
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
    void window.northstar.createTab(url).then(logIfFailed);
  }, []);
  const closeTab = useCallback((id: string) => {
    void window.northstar.closeTab(id).then(logIfFailed);
  }, []);
  const toggleTabSelection = useCallback((id: string) => {
    void window.northstar.toggleTabSelection(id).then(logIfFailed);
  }, []);
  const selectTabRange = useCallback((id: string) => {
    void window.northstar.selectTabRange(id).then(logIfFailed);
  }, []);
  const toggleWorkspaceSelection = useCallback((id: string) => {
    void window.northstar.toggleWorkspaceSelection(id).then(logIfFailed);
  }, []);
  const selectWorkspaceRange = useCallback((id: string) => {
    void window.northstar.selectWorkspaceRange(id).then(logIfFailed);
  }, []);
  const activateTab = useCallback((id: string) => {
    void window.northstar.activateTab(id).then(logIfFailed);
  }, []);
  const moveTab = useCallback((id: string, beforeId: string | null) => {
    void window.northstar.moveTab(id, beforeId).then(logIfFailed);
  }, []);
  const moveTabToWorkspace = useCallback((id: string, workspaceId: string) => {
    void window.northstar.moveTabToWorkspace(id, workspaceId).then(logIfFailed);
  }, []);
  const tearOffTab = useCallback((id: string, screenX: number, screenY: number, live?: boolean) => {
    window.northstar.tearOffTab(id, screenX, screenY, live);
  }, []);
  const reportDropRegions = useCallback((rects: readonly DropRegionRect[]) => {
    window.northstar.reportDropRegions(rects);
  }, []);
  const tearOffTabEnd = useCallback((id: string, accepted: boolean) => {
    window.northstar.tearOffTabEnd(id, accepted);
  }, []);
  const navigate = useCallback((id: string, url: string) => {
    void window.northstar.navigate(id, url).then(logIfFailed);
  }, []);
  const goBack = useCallback((id: string) => {
    void window.northstar.goBack(id).then(logIfFailed);
  }, []);
  const goForward = useCallback((id: string) => {
    void window.northstar.goForward(id).then(logIfFailed);
  }, []);
  const reload = useCallback((id: string) => {
    void window.northstar.reload(id).then(logIfFailed);
  }, []);
  const stop = useCallback((id: string) => {
    void window.northstar.stop(id).then(logIfFailed);
  }, []);

  const exportToPdf = useCallback((id: string) => {
    void window.northstar.exportToPdf(id).then(logIfFailed);
  }, []);

  const createPdfTab = useCallback(() => {
    void window.northstar.createPdfTab().then(logIfFailed);
  }, []);

  const createHistoryTab = useCallback(() => {
    void window.northstar.createHistoryTab().then(logIfFailed);
  }, []);

  const openPdfFile = useCallback((id: string) => {
    void window.northstar.openPdfFile(id).then(logIfFailed);
  }, []);

  const goToPdfPage = useCallback((id: string, page: number) => {
    void window.northstar.goToPdfPage(id, page).then(logIfFailed);
  }, []);

  const setPdfPointerMode = useCallback((id: string, mode: PdfPointerMode) => {
    void window.northstar.setPdfPointerMode(id, mode).then(logIfFailed);
  }, []);

  /** Resolves to an error message to show the user, or `null` on success. */
  const renamePdfFile = useCallback(async (id: string, name: string): Promise<string | null> => {
    const result = await window.northstar.renamePdfFile(id, name);
    return result.ok ? null : result.message;
  }, []);

  const createMarkdownTab = useCallback(() => {
    void window.northstar.createMarkdownTab().then(logIfFailed);
  }, []);
  const openMarkdownFile = useCallback((id: string) => {
    void window.northstar.openMarkdownFile(id).then(logIfFailed);
  }, []);
  const newMarkdownFile = useCallback((id: string) => {
    void window.northstar.newMarkdownFile(id).then(logIfFailed);
  }, []);
  const closeMarkdownFile = useCallback((id: string) => {
    void window.northstar.closeMarkdownFile(id).then(logIfFailed);
  }, []);
  /** Resolves to an error message to show the user, or `null` on success. */
  const renameMarkdownFile = useCallback(async (id: string, name: string): Promise<string | null> => {
    const result = await window.northstar.renameMarkdownFile(id, name);
    return result.ok ? null : result.message;
  }, []);
  const setMarkdownMode = useCallback((id: string, mode: 'view' | 'edit') => {
    void window.northstar.setMarkdownMode(id, mode).then(logIfFailed);
  }, []);

  const setMarkdownDisplay = useCallback((id: string, display: MarkdownDisplay) => {
    void window.northstar.setMarkdownDisplay(id, display).then(logIfFailed);
  }, []);
  const navigateMarkdownHistory = useCallback((id: string, direction: 1 | -1) => {
    void window.northstar.navigateMarkdownHistory(id, direction).then(logIfFailed);
  }, []);
  const addMarkdownBookmark = useCallback((id: string, name: string) => {
    void window.northstar.addMarkdownBookmark(id, name).then(logIfFailed);
  }, []);
  const openMarkdownPath = useCallback((id: string, path: string) => {
    window.northstar.openMarkdownPath(id, path);
  }, []);
  const openMarkdownBookmark = useCallback((id: string, bookmarkId: string) => {
    window.northstar.openMarkdownBookmark(id, bookmarkId);
  }, []);

  const createTerminalTab = useCallback(() => {
    void window.northstar.createTerminalTab().then(logIfFailed);
  }, []);

  const revertPage = useCallback((id: string) => {
    void window.northstar.revertPage(id).then(logIfFailed);
  }, []);

  const createWorkspace = useCallback((name?: string) => {
    void window.northstar.createWorkspace(name).then(logIfFailed);
  }, []);
  const createWorkspaceWithTab = useCallback((tabId: string) => {
    void window.northstar.createWorkspaceWithTab(tabId).then(logIfFailed);
  }, []);
  const switchWorkspace = useCallback((id: string) => {
    void window.northstar.switchWorkspace(id).then(logIfFailed);
  }, []);
  const moveWorkspace = useCallback((id: string, beforeId: string | null) => {
    void window.northstar.moveWorkspace(id, beforeId).then(logIfFailed);
  }, []);

  const renameWorkspace = useCallback((id: string, name: string) => {
    void window.northstar.renameWorkspace(id, name).then(logIfFailed);
  }, []);
  const updateWorkspace = useCallback((id: string, update: { name: string; color: string; icon: string }) => {
    void window.northstar.updateWorkspace(id, update).then(logIfFailed);
  }, []);
  const saveWorkspaceImage = useCallback((workspaceId: string) => {
    void window.northstar.saveWorkspaceImage(workspaceId).then(logIfFailed);
  }, []);
  const openWorkspaceImage = useCallback((id: string) => {
    void window.northstar.openWorkspaceImage(id).then(logIfFailed);
  }, []);
  const removeWorkspaceImage = useCallback((id: string) => {
    void window.northstar.removeWorkspaceImage(id).then(logIfFailed);
  }, []);
  const renameWorkspaceImage = useCallback((id: string, name: string) => {
    void window.northstar.renameWorkspaceImage(id, name).then(logIfFailed);
  }, []);
  const removeWorkspace = useCallback((id: string) => {
    void window.northstar.removeWorkspace(id).then(logIfFailed);
  }, []);
  const openWorkspaceInNewWindow = useCallback(() => {
    window.northstar.openWorkspaceInNewWindow();
  }, []);

  const addBookmark = useCallback((title: string, url: string) => {
    void window.northstar.addBookmark(title, url).then(logIfFailed);
  }, []);
  const addPdfBookmark = useCallback((id: string, name: string) => {
    void window.northstar.addPdfBookmark(id, name).then(logIfFailed);
  }, []);
  const openPdfPath = useCallback((id: string, path: string) => {
    window.northstar.openPdfPath(id, path);
  }, []);
  const openPdfBookmark = useCallback((id: string, bookmarkId: string) => {
    window.northstar.openPdfBookmark(id, bookmarkId);
  }, []);
  const toggleBookmark = useCallback((id: string) => {
    void window.northstar.toggleBookmark(id).then(logIfFailed);
  }, []);
  const removeBookmark = useCallback((id: string) => {
    void window.northstar.removeBookmark(id).then(logIfFailed);
  }, []);

  const beginTabPreview = useCallback(async (id: string): Promise<string | null> => {
    const result = await window.northstar.beginTabPreview(id);
    logIfFailed(result);
    return result.ok ? result.data : null;
  }, []);
  const endTabPreview = useCallback((id: string) => {
    void window.northstar.endTabPreview(id).then(logIfFailed);
  }, []);

  const enterSplitView = useCallback((secondaryId: string) => {
    void window.northstar.enterSplitView(secondaryId).then(logIfFailed);
  }, []);
  const exitSplitView = useCallback(() => {
    void window.northstar.exitSplitView().then(logIfFailed);
  }, []);

  const toggleSidebar = useCallback(() => {
    void window.northstar.toggleSidebar().then(logIfFailed);
  }, []);

  const setFocusMode = useCallback((enabled: boolean) => {
    void window.northstar.setFocusMode(enabled).then(logIfFailed);
  }, []);

  const setLaserPointer = useCallback((enabled: boolean) => {
    void window.northstar.setLaserPointer(enabled).then(logIfFailed);
  }, []);

  const setHighlighter = useCallback((enabled: boolean) => {
    void window.northstar.setHighlighter(enabled).then(logIfFailed);
  }, []);

  const setCommentTool = useCallback((enabled: boolean) => {
    void window.northstar.setCommentTool(enabled).then(logIfFailed);
  }, []);

  const setTextTool = useCallback((enabled: boolean) => {
    void window.northstar.setTextTool(enabled).then(logIfFailed);
  }, []);

  const setFind = useCallback((enabled: boolean) => {
    void window.northstar.setFind(enabled).then(logIfFailed);
  }, []);

  const setCrop = useCallback((enabled: boolean) => {
    void window.northstar.setCrop(enabled).then(logIfFailed);
  }, []);

  const closePdfFile = useCallback((id: string) => {
    void window.northstar.closePdfFile(id).then(logIfFailed);
  }, []);

  const exportPdfFile = useCallback((id: string) => {
    void window.northstar.exportPdfFile(id).then(logIfFailed);
  }, []);

  const setPen = useCallback((enabled: boolean) => {
    void window.northstar.setPen(enabled).then(logIfFailed);
  }, []);

  const zoomIn = useCallback(() => {
    void window.northstar.zoomIn().then(logIfFailed);
  }, []);
  const zoomOut = useCallback(() => {
    void window.northstar.zoomOut().then(logIfFailed);
  }, []);
  const setZoom = useCallback((percent: number) => {
    void window.northstar.setZoom(percent).then(logIfFailed);
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
    sidebarVisible: state.sidebarVisible,
    grabbedTabId: state.grabbedTabId,
    selectedTabIds: state.selectedTabIds,
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
    openPdfFile,
    goToPdfPage,
    setPdfPointerMode,
    renamePdfFile,
    createMarkdownTab,
    openMarkdownFile,
    newMarkdownFile,
    closeMarkdownFile,
    renameMarkdownFile,
    setMarkdownMode,
    setMarkdownDisplay,
    navigateMarkdownHistory,
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

    setFocusMode,
    zoomPercent: state.zoomPercent,
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
