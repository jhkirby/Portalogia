// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-26

import { useEffect, useMemo, useRef, useState } from 'react';
import type { HistoryClearRange, PageStats } from '@shared/ipc-contract';
import { HOME_URL } from '@shared/constants';
import { AddressBar } from './components/AddressBar';
import { BookmarkPopup } from './components/BookmarkPopup';
import { ClearHistoryPopup } from './components/ClearHistoryPopup';
import { ContentSnapshot } from './components/ContentSnapshot';
import { NavControls } from './components/NavControls';
import { PageActions } from './components/PageActions';
import { HistoryToolbar } from './components/HistoryToolbar';
import { BookmarksToolbar } from './components/BookmarksToolbar';
import { SecretsToolbar } from './components/SecretsToolbar';
import { MarkdownToolbar } from './components/MarkdownToolbar';
import { MetalBackground } from './components/MetalBackground';
import { PdfToolbar } from './components/PdfToolbar';
import { PopupTransition } from './components/PopupTransition';
import { SplitIndicator } from './components/SplitIndicator';
import { TabBar } from './components/TabBar';
import { TitlebarClock } from './components/TitlebarClock';
import { TabSearchPopup } from './components/TabSearchPopup';
import { WorkspaceEditPopup } from './components/WorkspaceEditPopup';
import { WindowControls } from './components/WindowControls';
import { WorkspaceBar } from './components/WorkspaceBar';
import { WebStatusBar } from './components/WebStatusBar';
import { WorkspaceImagesPopup } from './components/WorkspaceImagesPopup';
import { hostOfUrl, useAdBlock } from './hooks/useAdBlock';
import { useTabs } from './hooks/useTabs';
import { useTheme } from './hooks/useTheme';
import { usePointerGlow } from './hooks/usePointerGlow';

/** The popups that cover the page, each closed with an animation (see `PopupTransition`). */
type PopupName = 'bookmark' | 'tabSearch' | 'images' | 'workspaceEdit' | 'clearHistory';

/** The longest a popup's closing motion may take before it closes anyway (it can't end while the window is hidden). */
const POPUP_EXIT_FALLBACK_MS = 500;

/**
 * A file's name without its extension (`iot.md` → `iot`), the name a PDF or note bookmark starts with. A name that
 * is only an extension (`.md`) is left whole, so the box never starts empty.
 * @param fileName The file's name.
 */
function withoutExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

/** `BookmarkPopup`'s state while open — captured once, when the star button is clicked, not re-derived live, since the popup edits its own copy of the name/URL independent of whatever the tab does in the meantime. */
interface BookmarkPopupState {
  readonly tabId: string;
  /** What the popup saves: a page by its URL, or the tab's open PDF by its file path. */
  readonly variant: 'page' | 'pdf' | 'markdown';
  readonly url: string;
  readonly title: string;
  readonly previewImage: string | null;
}

/**
 * The browser chrome: a full-width top bar (tab strip, back/forward/
 * reload, address bar, and the overlays/toggles layered on top of it —
 * tab search, split view, Focus Mode), with the workspace sidebar beneath
 * it on the left rather than competing with it for the top-left corner,
 * and the tab content area filling what's left. No tab's actual content is
 * rendered here at all, browser or terminal — it's one or two native
 * `WebContentsView`s the main process positions directly over that same
 * area (see `TabManager`). `BookmarkPopup` is the one thing that does live
 * in that area's own DOM node (`.tab-content`) — see its render below for
 * why.
 */
export function App() {
  const {
    activeTab,
    activeTabId,
    workspaces,
    activeWorkspaceId,
    workspaceTabs,
    tabs,
    bookmarks,
    workspaceImages,
    savedWorkspaceImages,
    secondaryTab,
    focusMode,
    sidebarVisible,
    grabbedTabId,
    createTab,
    closeTab,
    activateTab,
    selectedTabIds,
    selectedWorkspaceIds,
    toggleTabSelection,
    selectTabRange,
    toggleWorkspaceSelection,
    selectWorkspaceRange,
    moveTab,
    moveTabToWorkspace,
    tearOffTab,
    tearOffTabEnd,
    reportDropRegions,
    createWorkspaceWithTab,
    navigate,
    goBack,
    goForward,
    reload,
    stop,
    createPdfTab,
    createHistoryTab,
    createBookmarksTab,
    createSecretsTab,
    openPdfFile,
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
    addMarkdownBookmark,
    openMarkdownPath,
    openMarkdownBookmark,
    createTerminalTab,
    revertPage,
    createWorkspace,
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
    exitSplitView,
    toggleSidebar,
    setFocusMode,
    zoomPercent,
    zoomIn,
    zoomOut,
    setZoom,
    laserPointerActive,
    setLaserPointer,
    highlighterActive,
    setHighlighter,
    commentToolActive,
    setCommentTool,
    textToolActive,
    setTextTool,
    findOpen,
    setFind,
    penActive,
    setPen,
    cropActive,
    setCrop,
    exportPdfFile,
    closePdfFile,
  } = useTabs();

  /** The tab-search popup's state while open: the active tab's last frame, shown blurred behind it. */
  const [tabSearch, setTabSearch] = useState<{ readonly tabId: string | null; readonly previewImage: string | null } | null>(null);
  const [bookmarkPopup, setBookmarkPopup] = useState<BookmarkPopupState | null>(null);
  /**
   * Whether the pointer is on the tab row, as main reports it (`watchTitlebarHover`): the row's empty space is the
   * window's drag region, where the page never sees the pointer, so `:hover` alone can't show the controls there.
   */
  const [pointerOnTitlebar, setPointerOnTitlebar] = useState(false);
  useEffect(() => window.northstar.onTitlebarPointer(setPointerOnTitlebar), []);
  const titlebarRef = useRef<HTMLDivElement>(null);
  usePointerGlow(titlebarRef, true);
  /** The latest stats main sent for the active web page, with the tab they're for (`WebStatusBar`). */
  const [pageStats, setPageStats] = useState<{ readonly tabId: string; readonly stats: PageStats | null } | null>(null);
  useEffect(() => window.northstar.onPageStats((tabId, stats) => setPageStats({ tabId, stats })), []);
  /** Popups playing their closing motion; each one's real close waits in `popupFinishers` until it ends. */
  const [closingPopups, setClosingPopups] = useState<ReadonlySet<PopupName>>(() => new Set());
  const popupFinishers = useRef(new Map<PopupName, () => void>());

  /** Really closes a popup whose closing motion has ended (or run out of time). Safe to call twice. */
  const finishPopupClose = (name: PopupName): void => {
    const finish = popupFinishers.current.get(name);
    if (!finish) {
      return;
    }
    popupFinishers.current.delete(name);
    setClosingPopups((current) => {
      const next = new Set(current);
      next.delete(name);
      return next;
    });
    finish();
  };

  /**
   * Closes a popup with its closing motion first: the page's still sharpens as the panel shrinks, and only then does
   * `finish` take it away and give the tab its live view back — which, coming back sooner, would cover the motion.
   * What the close leads to (another tab, a new workspace) waits for `finish` too, for the same reason.
   * @param name The popup.
   * @param finish What really closing it takes.
   */
  const closePopupAnimated = (name: PopupName, finish: () => void): void => {
    if (popupFinishers.current.has(name)) {
      return;
    }
    popupFinishers.current.set(name, finish);
    setClosingPopups((current) => new Set([...current, name]));
    window.setTimeout(() => finishPopupClose(name), POPUP_EXIT_FALLBACK_MS);
  };
  /** The workspace images popup while open: the still of the tab standing in behind it. */
  const [imagesPopup, setImagesPopup] = useState<{ readonly tabId: string | null; readonly previewImage: string | null } | null>(null);
  /** The workspace editor while open: which workspace, and the still of the tab standing in behind it. */
  const [workspaceEdit, setWorkspaceEdit] = useState<{ readonly workspaceId: string; readonly tabId: string | null; readonly previewImage: string | null } | null>(null);
  const { theme, toggleTheme } = useTheme();
  const adBlock = useAdBlock();

  // Tells main a dragged tab was dropped on this window, as a backup to the
  // dragged tab's own `dragend` (which can go missing if the tab's element
  // is moved while the drag is in flight) — main uses either to finish a
  // live tear-off. A drop that isn't a tab drag carries no tab id and is ignored.
  useEffect(() => {
    const handleDrop = (event: DragEvent): void => {
      const tabId = event.dataTransfer?.getData('text/plain');
      if (tabId) {
        tearOffTabEnd(tabId, true);
      }
    };
    document.addEventListener('drop', handleDrop, true);
    return () => document.removeEventListener('drop', handleDrop, true);
  }, [tearOffTabEnd]);

  // Belt-and-suspenders for the chrome-focused case, same reasoning as
  // Ctrl+Shift+F's menu accelerator: reliable when chrome itself has OS
  // focus, which is the case this covers (TabManager's own
  // `before-input-event` handler covers the tab-focused case, the far more
  // likely one while Focus Mode is fullscreen or the laser pointer/
  // highlighter is on, both of which are meant to be used over a tab's own
  // content — see there). Gated on all three so it can never interfere with
  // Escape's other, unrelated uses elsewhere in the chrome (AddressBar,
  // WorkspaceBar's rename, the tab search popup) when none of them are active.
  useEffect(() => {
    if (!focusMode && !laserPointerActive && !highlighterActive && !commentToolActive && !textToolActive && !penActive && !cropActive) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }
      // Escape in a text box only takes the caret out of it (the preload does that); the next one reaches here.
      const target = event.target;
      if (
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLInputElement && target.type !== 'checkbox' && target.type !== 'radio') ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (focusMode) {
        setFocusMode(false);
      }
      if (laserPointerActive) {
        setLaserPointer(false);
      }
      if (highlighterActive) {
        setHighlighter(false);
      }
      if (commentToolActive) {
        setCommentTool(false);
      }
      if (textToolActive) {
        setTextTool(false);
      }
      if (penActive) {
        setPen(false);
      }
      if (cropActive) {
        setCrop(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    focusMode,
    setFocusMode,
    laserPointerActive,
    setLaserPointer,
    highlighterActive,
    setHighlighter,
    commentToolActive,
    setCommentTool,
    textToolActive,
    setTextTool,
    penActive,
    setPen,
    cropActive,
    setCrop,
  ]);

  const browserTab = activeTab?.kind === 'browser' ? activeTab : null;
  // Find searches a page, a terminal's buffer, or a PDF or note that has a file open — not a History, Bookmarks or Secrets tab (each has its own search) or an empty PDF or note.
  const canFind =
    activeTab?.kind === 'browser' ||
    activeTab?.kind === 'terminal' ||
    ((activeTab?.kind === 'pdf' || activeTab?.kind === 'markdown') && activeTab.fileName !== null);
  // The History, Bookmarks and Secrets tabs are fixed tables: no zoom, laser pointer or export.
  const isTablePage = activeTab?.kind === 'history' || activeTab?.kind === 'bookmarks' || activeTab?.kind === 'secrets';
  // A terminal or a table tab is an app page, not a document: none of the page-marking tools apply to it.
  const isAppPage = activeTab?.kind === 'terminal' || isTablePage;
  const isHome = browserTab?.url === HOME_URL;
  // The tab kinds with the Pan and Select pointer modes.
  const pointerModeTab =
    activeTab?.kind === 'pdf' || activeTab?.kind === 'markdown' || activeTab?.kind === 'browser' ? activeTab : null;
  const adBlockSite = hostOfUrl(browserTab?.url);
  const adBlockSiteAllowed = adBlockSite !== null && adBlock.allowedSites.includes(adBlockSite);
  // PDF bookmarks are files, not pages: the address bar and tab labels only ever deal in the page ones.
  const pageBookmarks = useMemo(() => bookmarks.filter((bookmark) => bookmark.kind === 'page'), [bookmarks]);
  const activeBookmark = useMemo(
    () => (browserTab ? (pageBookmarks.find((bookmark) => bookmark.url === browserTab.url) ?? null) : null),
    [browserTab, pageBookmarks],
  );
  const pdfBookmarks = useMemo(() => bookmarks.filter((bookmark) => bookmark.kind === 'pdf'), [bookmarks]);
  const markdownBookmarks = useMemo(() => bookmarks.filter((bookmark) => bookmark.kind === 'markdown'), [bookmarks]);
  const markdownBookmarked =
    activeTab?.kind === 'markdown' &&
    activeTab.filePath !== null &&
    bookmarks.some((bookmark) => bookmark.kind === 'markdown' && bookmark.path === activeTab.filePath);
  const pdfBookmarked =
    activeTab?.kind === 'pdf' &&
    activeTab.filePath !== null &&
    bookmarks.some((bookmark) => bookmark.kind === 'pdf' && bookmark.path === activeTab.filePath);
  const handleReloadOrStop = (): void => {
    if (!activeTabId) {
      return;
    }
    if (browserTab?.isLoading) {
      stop(activeTabId);
    } else {
      reload(activeTabId);
    }
  };

  // Already-bookmarked stays an instant toggle (no popup, nothing to
  // confirm) — the popup is only for the "not yet bookmarked" case, where
  // there's a real name/URL choice to make before committing.
  const handleToggleBookmark = (): void => {
    // The blank default page has no address to save.
    if (!browserTab || !activeTabId || isHome) {
      return;
    }
    if (activeBookmark) {
      removeBookmark(activeBookmark.id);
      return;
    }
    const tabId = activeTabId;
    void beginTabPreview(tabId).then((previewImage) => {
      setBookmarkPopup({ tabId, variant: 'page', url: browserTab.url, title: browserTab.title, previewImage });
    });
  };

  // The same shape as the page star: an already-bookmarked PDF un-bookmarks instantly; otherwise the
  // popup asks for the name first, with the file's path where a page shows its URL.
  const handleTogglePdfBookmark = (): void => {
    if (activeTab?.kind !== 'pdf' || activeTab.filePath === null || activeTab.fileName === null) {
      return;
    }
    if (pdfBookmarked) {
      toggleBookmark(activeTab.id);
      return;
    }
    const { id: tabId, filePath, fileName } = activeTab;
    void beginTabPreview(tabId).then((previewImage) => {
      setBookmarkPopup({ tabId, variant: 'pdf', url: filePath, title: withoutExtension(fileName), previewImage });
    });
  };

  // The same again for a note: the popup asks for the name, with the file's path where a page shows its URL.
  const handleToggleMarkdownBookmark = (): void => {
    if (activeTab?.kind !== 'markdown' || activeTab.filePath === null || activeTab.fileName === null) {
      return;
    }
    if (markdownBookmarked) {
      toggleBookmark(activeTab.id);
      return;
    }
    const { id: tabId, filePath, fileName } = activeTab;
    void beginTabPreview(tabId).then((previewImage) => {
      setBookmarkPopup({ tabId, variant: 'markdown', url: filePath, title: withoutExtension(fileName), previewImage });
    });
  };

  const handleSaveBookmark = (name: string, url: string): void => {
    if (!bookmarkPopup) {
      return;
    }
    if (bookmarkPopup.variant === 'markdown') {
      addMarkdownBookmark(bookmarkPopup.tabId, name);
    } else if (bookmarkPopup.variant === 'pdf') {
      // The path isn't editable, so only the name travels: main knows which file the tab has open.
      addPdfBookmark(bookmarkPopup.tabId, name);
    } else {
      addBookmark(name, url);
    }
    handleCloseBookmarkPopup();
  };

  const handleCloseBookmarkPopup = (): void => {
    if (!bookmarkPopup) {
      return;
    }
    const { tabId } = bookmarkPopup;
    closePopupAnimated('bookmark', () => {
      endTabPreview(tabId);
      setBookmarkPopup(null);
    });
  };

  // Clear History's confirmation: says how many visits would go, and deletes them only once "delete" is typed. Opens
  // over the History tab like the other popups (its native view comes off the window, a blurred still stands in).
  const [clearHistoryPopup, setClearHistoryPopup] = useState<{
    readonly tabId: string;
    readonly range: HistoryClearRange;
    readonly count: number | null;
    readonly previewImage: string | null;
  } | null>(null);

  const openClearHistory = (range: HistoryClearRange): void => {
    const tabId = activeTabId;
    if (clearHistoryPopup || !tabId) {
      return;
    }
    setClearHistoryPopup({ tabId, range, count: null, previewImage: null });
    void window.northstar.countHistory(range).then((result) => {
      setClearHistoryPopup((current) => (current ? { ...current, count: result.ok ? result.data : 0 } : current));
    });
    void beginTabPreview(tabId).then((previewImage) => {
      setClearHistoryPopup((current) => (current ? { ...current, previewImage } : current));
    });
  };

  const closeClearHistory = (confirmed: boolean): void => {
    if (!clearHistoryPopup) {
      return;
    }
    const { tabId, range } = clearHistoryPopup;
    closePopupAnimated('clearHistory', () => {
      endTabPreview(tabId);
      setClearHistoryPopup(null);
      // Deleted once the History page is back in view, so its rows can be seen fading out.
      if (confirmed) {
        void window.northstar.clearHistory(range);
      }
    });
  };

  // Opens over whichever kind of tab is showing, so the tab's native view comes off the window first (it would paint above
  // this popup and swallow its clicks) and a still of its last frame stands in behind it — same as the bookmark popup.
  const openTabSearch = (): void => {
    if (tabSearch) {
      return;
    }
    const tabId = activeTabId;
    if (!tabId) {
      setTabSearch({ tabId: null, previewImage: null });
      return;
    }
    // Set at once, before the capture resolves, so a second press while it's in flight doesn't open another.
    setTabSearch({ tabId, previewImage: null });
    void beginTabPreview(tabId).then((previewImage) => {
      setTabSearch((current) => (current ? { tabId, previewImage } : current));
    });
  };

  // Jumping to a tab: it's activated first, so the view `endTabPreview` re-shows (the old active tab's) is only
  // put back if the search ended on that same tab — otherwise main finds it's no longer the active one and leaves it be.
  const closeTabSearch = (jumpTo: string | null): void => {
    if (!tabSearch) {
      return;
    }
    const { tabId } = tabSearch;
    closePopupAnimated('tabSearch', () => {
      if (jumpTo) {
        activateTab(jumpTo);
      }
      if (tabId) {
        endTabPreview(tabId);
      }
      setTabSearch(null);
    });
  };

  // Opens like the tab search: the active tab's native view comes off the window and a blurred still of it stands in.
  const openWorkspaceImages = (): void => {
    // Pressed again while open — the button, or Ctrl+Shift+S — it closes, rather than ignoring the press.
    if (imagesPopup) {
      closeWorkspaceImages(null);
      return;
    }
    const tabId = activeTabId;
    if (!tabId) {
      setImagesPopup({ tabId: null, previewImage: null });
      return;
    }
    setImagesPopup({ tabId, previewImage: null });
    void beginTabPreview(tabId).then((previewImage) => {
      setImagesPopup((current) => (current ? { tabId, previewImage } : current));
    });
  };

  // Opening an image makes a new workspace, so the tab left behind is only put back if it is still the active one (main checks).
  const closeWorkspaceImages = (openId: string | null): void => {
    if (!imagesPopup) {
      return;
    }
    const { tabId } = imagesPopup;
    closePopupAnimated('images', () => {
      if (openId) {
        openWorkspaceImage(openId);
      }
      if (tabId) {
        endTabPreview(tabId);
      }
      setImagesPopup(null);
    });
  };

  useEffect(() => window.northstar.onOpenWorkspaceImages(openWorkspaceImages));

  // Like the bookmark popup, the editor covers whichever kind of tab is showing, so that tab's native view comes off
  // the window first and a still of its last frame stands in behind the popup.
  const openWorkspaceEditor = (workspaceId: string): void => {
    if (workspaceEdit) {
      return;
    }
    const tabId = activeTabId;
    // Set at once, before the capture resolves, so a second press while it is in flight does not open another.
    setWorkspaceEdit({ workspaceId, tabId, previewImage: null });
    if (tabId) {
      void beginTabPreview(tabId).then((previewImage) => {
        setWorkspaceEdit((current) => (current ? { ...current, previewImage } : current));
      });
    }
  };

  const closeWorkspaceEditor = (): void => {
    if (!workspaceEdit) {
      return;
    }
    const { tabId } = workspaceEdit;
    closePopupAnimated('workspaceEdit', () => {
      if (tabId) {
        endTabPreview(tabId);
      }
      setWorkspaceEdit(null);
    });
  };

  const handleSaveWorkspace = (name: string, color: string, icon: string): void => {
    if (workspaceEdit) {
      updateWorkspace(workspaceEdit.workspaceId, { name, color, icon });
    }
    closeWorkspaceEditor();
  };

  // The keyboard command (Ctrl+Shift+E) is an Electron menu accelerator for the same reason Search Tabs is: a focused
  // tab would swallow a renderer-level keydown. It always means the active workspace.
  useEffect(() => window.northstar.onEditWorkspace(() => openWorkspaceEditor(activeWorkspaceId)));

  // The chrome window can lose OS focus to whatever tab's WebContentsView
  // the user last clicked into, so the "Search Tabs" keyboard shortcut is
  // an Electron menu accelerator (see buildMenu.ts) that reaches here via
  // this push instead of a renderer-level keydown listener, which a
  // focused tab would simply swallow.
  useEffect(() => window.northstar.onOpenTabSearch(openTabSearch));

  return (
    <div className="app-shell">
      <div className={`app${focusMode ? ' app--focus-mode' : ''}`}>
        {/* Both bars stay mounted and slide away together as one unit in
            Focus Mode (see `.app__bar` in app.css) rather than unmounting,
            so there's something to animate instead of an instant cut —
            the page then fills the window (which keeps its own size; see
            `setFocusMode` in TabManager.ts) with nothing of the chrome
            left. Escape/Ctrl+Shift+F exit it. */}
        <div className="app__bar">
          {/* The frameless window's own drag region (see MainWindow.ts's
              `frame: false`) — the tab strip shares this row with
              WindowControls rather than sitting on a row of its own, so
              whatever space the tabs don't fill stays draggable, including
              a native double-click-to-maximize there. Tabs themselves opt
              out of dragging (see tab-bar.css) so clicking and reordering
              them still works. */}
          <div ref={titlebarRef} className={`titlebar pointer-glow-host${pointerOnTitlebar ? ' pointer-glow-host--pointer-inside titlebar--pointer-inside' : ''}`}>
            {/* The accent glowing around the pointer while it's on the row, under the tabs and buttons. */}
            <div className="pointer-glow" aria-hidden="true" />
            <TabBar
              tabs={workspaceTabs}
              workspaceId={activeWorkspaceId}
              bookmarks={pageBookmarks}
              activeTabId={activeTabId}
              selectedTabIds={selectedTabIds}
              onToggleSelect={toggleTabSelection}
              onSelectRange={selectTabRange}
              onActivate={activateTab}
              onClose={closeTab}
              onReorder={moveTab}
              grabbedTabId={grabbedTabId}
              onNewTab={() => createTab()}
              onDragEndOutside={tearOffTab}
              onDragOutOfWindow={(id, x, y) => tearOffTab(id, x, y, true)}
              onTearOffEnd={tearOffTabEnd}
              onReportDropRegions={reportDropRegions}
            />
            <div className="titlebar__corner">
              <TitlebarClock />
              <WindowControls />
            </div>
          </div>
          <div className="toolbar">
            {activeTab?.kind === 'pdf' ? (
              <PdfToolbar
                key={activeTab.id}
                tab={activeTab}
                isBookmarked={pdfBookmarked}
                onToggleBookmark={handleTogglePdfBookmark}
                pdfBookmarks={pdfBookmarks}
                onOpenBookmark={openPdfBookmark}
                onOpenPdfPath={openPdfPath}
                onOpen={openPdfFile}
                onNavigate={(id, direction) => (direction === -1 ? goBack(id) : goForward(id))}
                onExport={exportPdfFile}
                onClose={closePdfFile}
                onRename={renamePdfFile}
              />
            ) : activeTab?.kind === 'markdown' ? (
              <MarkdownToolbar
                key={activeTab.id}
                tab={activeTab}
                isBookmarked={markdownBookmarked}
                onToggleBookmark={handleToggleMarkdownBookmark}
                markdownBookmarks={markdownBookmarks}
                onOpenBookmark={openMarkdownBookmark}
                onOpenPath={openMarkdownPath}
                onNew={newMarkdownFile}
                onOpen={openMarkdownFile}
                onClose={closeMarkdownFile}
                onSetMode={setMarkdownMode}
                onSetDisplay={setMarkdownDisplay}
                onNavigate={navigateMarkdownHistory}
                onRename={renameMarkdownFile}
              />
            ) : activeTab?.kind === 'history' ? (
              <HistoryToolbar key={activeTab.id} tab={activeTab} onRequestClear={openClearHistory} />
            ) : activeTab?.kind === 'bookmarks' ? (
              <BookmarksToolbar key={activeTab.id} tab={activeTab} />
            ) : activeTab?.kind === 'secrets' ? (
              <SecretsToolbar key={activeTab.id} tab={activeTab} />
            ) : activeTab?.kind === 'terminal' ? (
              // Empty on purpose — occupies the same flex space
              // NavControls + AddressBar would, so PageActions stays
              // right-aligned, without showing the tab's title text.
              <span className="toolbar__terminal-label" />
            ) : (
              <>
                <NavControls
                  canGoBack={browserTab?.canGoBack ?? false}
                  canGoForward={browserTab?.canGoForward ?? false}
                  isLoading={browserTab?.isLoading ?? false}
                  onBack={() => activeTabId && goBack(activeTabId)}
                  onForward={() => activeTabId && goForward(activeTabId)}
                  onReloadOrStop={handleReloadOrStop}
                  onHome={() => activeTabId && navigate(activeTabId, HOME_URL)}
                />
                {/* Remounted per tab (via key) so its draft text never leaks between tabs. */}
                <AddressBar
                  key={activeTabId ?? 'none'}
                  url={isHome ? '' : (browserTab?.url ?? '')}
                  isLoading={browserTab?.isLoading ?? false}
                  loadProgress={browserTab?.loadProgress ?? null}
                  onNavigate={(input) => activeTabId && navigate(activeTabId, input)}
                  bookmarks={pageBookmarks}
                  isBookmarked={activeBookmark !== null}
                  canBookmark={browserTab !== null && !isHome}
                  bookmarkName={activeBookmark?.title ?? null}
                  onToggleBookmark={handleToggleBookmark}
                />
              </>
            )}
            {secondaryTab && <SplitIndicator secondaryTab={secondaryTab} onExit={exitSplitView} />}
            <PageActions
              canActOnPage={browserTab !== null}
              canAnnotate={browserTab !== null || activeTab?.kind === 'pdf' || activeTab?.kind === 'markdown'}
              // Marks go on the formatted, read-only note, so editing or raw text locks them too.
              annotationToolsLocked={
                isHome ||
                ((activeTab?.kind === 'pdf' || activeTab?.kind === 'markdown') && activeTab.fileName === null) ||
                (activeTab?.kind === 'markdown' && (activeTab.mode === 'edit' || activeTab.display === 'raw'))
              }
              canExportPdf={activeTabId !== null}
              canZoom={activeTabId !== null}
              zoomPercent={zoomPercent}
              focusMode={focusMode}
              laserPointerActive={laserPointerActive}
              highlighterActive={highlighterActive}
              commentToolActive={commentToolActive}
              textToolActive={textToolActive}
              penActive={penActive}
              cropActive={cropActive}
              showCrop={activeTab?.kind === 'pdf'}
              showPointerModes={pointerModeTab !== null}
              pointerMode={pointerModeTab?.pointerMode ?? 'select'}
              pointerModesLocked={
                isHome || ((pointerModeTab?.kind === 'pdf' || pointerModeTab?.kind === 'markdown') && pointerModeTab.fileName === null)
              }
              onSetPointerMode={(mode) => {
                if (pointerModeTab) {
                  setPointerMode(pointerModeTab.id, mode);
                }
              }}
              showEditMode={browserTab !== null}
              editMode={browserTab?.editMode ?? false}
              onToggleEditMode={() => browserTab && toggleEditMode(browserTab.id)}
              theme={theme}
              showAdBlock={adBlockSite !== null && !isHome}
              adBlockActive={adBlock.enabled && !adBlockSiteAllowed}
              adBlockGloballyOff={!adBlock.enabled}
              adBlockBlockedCount={activeTabId ? (adBlock.blockedByTab[activeTabId] ?? 0) : 0}
              adBlockSite={adBlockSite ?? ''}
              onToggleAdBlock={() => adBlockSite && window.northstar.setAdBlockSiteAllowed(adBlockSite, !adBlockSiteAllowed)}
              onOpenPdfViewer={createPdfTab}
              onOpenMarkdown={createMarkdownTab}
              markdownExport={activeTab?.kind === 'markdown'}
              canExportMenu={
                activeTabId !== null &&
                !isHome &&
                activeTab?.kind !== 'pdf' &&
                !isTablePage &&
                !(activeTab?.kind === 'markdown' && activeTab.fileName === null)
              }
              canExportDocuments={browserTab !== null && !isHome}
              showExportMenu={activeTab?.kind !== 'pdf' && !isTablePage}
              showCommentTool={!isAppPage}
              showLaserPointer={!isTablePage}
              showZoom={!isTablePage}
              showTextTool={!isAppPage && activeTab?.kind !== 'markdown'}
              showPen={!isAppPage}
              showHighlighter={!isAppPage}
              showRevert={!isAppPage}
              onNewTerminal={createTerminalTab}
              onOpenHistory={createHistoryTab}
              onOpenBookmarks={createBookmarksTab}
              onOpenSecrets={createSecretsTab}
              onOpenTabSearch={openTabSearch}
              findOpen={findOpen}
              canFind={canFind}
              onToggleFind={() => setFind(!findOpen)}
              onZoomOut={zoomOut}
              onZoomIn={zoomIn}
              onSetZoom={setZoom}
              onOpenWorkspaceInNewWindow={openWorkspaceInNewWindow}
              onToggleFocusMode={() => setFocusMode(!focusMode)}
              onToggleLaserPointer={() => setLaserPointer(!laserPointerActive)}
              onToggleHighlighter={() => setHighlighter(!highlighterActive)}
              onToggleCommentTool={() => setCommentTool(!commentToolActive)}
              onToggleTextTool={() => setTextTool(!textToolActive)}
              onTogglePen={() => setPen(!penActive)}
              onToggleCrop={() => setCrop(!cropActive)}
              onRevertPage={() => activeTabId && revertPage(activeTabId)}
              onToggleTheme={toggleTheme}
            />
          </div>
        </div>
      </div>
      <div className="main-row">
        {/* Stays mounted (same reasoning as `.app__bar` above) so Focus
            Mode's slide-away reuses the sidebar's existing Ctrl+L
            transition (see `.sidebar--hidden` in workspace-bar.css)
            instead of an instant cut — Focus Mode counts as "hidden" here
            regardless of the user's own Ctrl+L choice, same as
            TabManager's `targetLeftInset`. */}
        <WorkspaceBar
          workspaces={workspaces}
          savedImageIds={savedWorkspaceImages}
          activeWorkspaceId={activeWorkspaceId}
          sidebarVisible={sidebarVisible && !focusMode}
          focusMode={focusMode}
          selectedWorkspaceIds={selectedWorkspaceIds}
          onToggleSelect={toggleWorkspaceSelection}
          onSelectRange={selectWorkspaceRange}
          onSwitch={switchWorkspace}
          onCreate={() => createWorkspace()}
          onRename={renameWorkspace}
          onMove={moveWorkspace}
          onEdit={openWorkspaceEditor}
          onRemove={removeWorkspace}
          onDropTab={moveTabToWorkspace}
          onDropTabToNewWorkspace={createWorkspaceWithTab}
          onSaveImage={saveWorkspaceImage}
          onRemoveImage={removeWorkspaceImage}
          onOpenImages={openWorkspaceImages}
          onToggleSidebar={toggleSidebar}
        />
        {/* Every tab, browser or terminal, renders below via the main
            process's own native WebContentsViews, positioned directly
            beneath this area by TabManager — see App's doc comment.
            `BookmarkPopup` is the one thing actually in this DOM node: it
            needs to cover exactly the page area (not the toolbar/sidebar
            too), and this element's bounds already match that natively —
            same area the hidden `WebContentsView` it's standing in for
            would otherwise occupy. */}
        <div className="tab-content">
          {/* The metal flowing behind every tab, seen in the margin around its frame (and behind the stat bar's strip). */}
          <MetalBackground />
          {/* The border of the frame a web page sits in (main places the page's view just inside it); a note, PDF,
              terminal or History page draws its own frame, and Focus Mode shows none. */}
          {activeTab?.kind === 'browser' && !focusMode && <div className="tab-content__frame" aria-hidden="true" />}
          {/* The tab's pages in picture, standing in for them while the sidebar slides. */}
          <ContentSnapshot />
          {/* In the strip main keeps free below a web page; a note or PDF draws its own, and Focus Mode shows none. */}
          {activeTab?.kind === 'browser' && !focusMode && (
            <WebStatusBar stats={pageStats?.tabId === activeTab.id ? pageStats.stats : null} />
          )}
          {bookmarkPopup && (
            <PopupTransition closing={closingPopups.has('bookmark')} onExited={() => finishPopupClose('bookmark')}>
              <BookmarkPopup
                variant={bookmarkPopup.variant}
                url={bookmarkPopup.url}
                title={bookmarkPopup.title}
                previewImage={bookmarkPopup.previewImage}
                onSave={handleSaveBookmark}
                onClose={handleCloseBookmarkPopup}
              />
            </PopupTransition>
          )}
          {workspaceEdit && (
            <PopupTransition closing={closingPopups.has('workspaceEdit')} onExited={() => finishPopupClose('workspaceEdit')}>
              <WorkspaceEditPopup
                // Keyed so reopening for another workspace starts from that one's values.
                key={workspaceEdit.workspaceId}
                workspace={workspaces.find((workspace) => workspace.id === workspaceEdit.workspaceId) ?? workspaces[0]!}
                previewImage={workspaceEdit.previewImage}
                onSave={handleSaveWorkspace}
                onClose={closeWorkspaceEditor}
              />
            </PopupTransition>
          )}
          {imagesPopup && (
            <PopupTransition closing={closingPopups.has('images')} onExited={() => finishPopupClose('images')}>
              <WorkspaceImagesPopup
                images={workspaceImages}
                previewImage={imagesPopup.previewImage}
                onOpen={(id) => closeWorkspaceImages(id)}
                onRemove={removeWorkspaceImage}
                onRename={renameWorkspaceImage}
                onClose={() => closeWorkspaceImages(null)}
              />
            </PopupTransition>
          )}
          {clearHistoryPopup && (
            <PopupTransition closing={closingPopups.has('clearHistory')} onExited={() => finishPopupClose('clearHistory')}>
              <ClearHistoryPopup
                count={clearHistoryPopup.count}
                previewImage={clearHistoryPopup.previewImage}
                onConfirm={() => closeClearHistory(true)}
                onClose={() => closeClearHistory(false)}
              />
            </PopupTransition>
          )}
          {tabSearch && (
            <PopupTransition closing={closingPopups.has('tabSearch')} onExited={() => finishPopupClose('tabSearch')}>
              <TabSearchPopup
                tabs={tabs}
                workspaces={workspaces}
                previewImage={tabSearch.previewImage}
                onSelect={(tabId) => closeTabSearch(tabId)}
                onClose={() => closeTabSearch(null)}
              />
            </PopupTransition>
          )}
        </div>
      </div>
    </div>
  );
}
