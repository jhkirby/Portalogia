// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-17

import { useEffect, useMemo, useState } from 'react';
import { HOME_URL } from '@shared/constants';
import { AddressBar } from './components/AddressBar';
import { BookmarkPopup } from './components/BookmarkPopup';
import { NavControls } from './components/NavControls';
import { PageActions } from './components/PageActions';
import { HistoryToolbar } from './components/HistoryToolbar';
import { MarkdownToolbar } from './components/MarkdownToolbar';
import { PdfToolbar } from './components/PdfToolbar';
import { SplitIndicator } from './components/SplitIndicator';
import { TabBar } from './components/TabBar';
import { TitlebarGrip } from './components/TitlebarGrip';
import { TabSearchPopup } from './components/TabSearchPopup';
import { WorkspaceEditPopup } from './components/WorkspaceEditPopup';
import { WindowControls } from './components/WindowControls';
import { WorkspaceBar } from './components/WorkspaceBar';
import { WorkspaceImagesPopup } from './components/WorkspaceImagesPopup';
import { hostOfUrl, useAdBlock } from './hooks/useAdBlock';
import { useTabs } from './hooks/useTabs';
import { useTheme } from './hooks/useTheme';

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
    createTerminalTab,
    revertPage,
    createWorkspace,
    switchWorkspace,
    renameWorkspace,
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
  // Find searches a page, a terminal's buffer, or a PDF or note that has a file open — not the History tab (it has its own search) or an empty PDF or note.
  const canFind =
    activeTab?.kind === 'browser' ||
    activeTab?.kind === 'terminal' ||
    ((activeTab?.kind === 'pdf' || activeTab?.kind === 'markdown') && activeTab.fileName !== null);
  // A terminal or History tab is an app page, not a document: none of the page-marking tools apply to it.
  const isAppPage = activeTab?.kind === 'terminal' || activeTab?.kind === 'history';
  const isHome = browserTab?.url === HOME_URL;
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
      setBookmarkPopup({ tabId, variant: 'pdf', url: filePath, title: fileName, previewImage });
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
      setBookmarkPopup({ tabId, variant: 'markdown', url: filePath, title: fileName, previewImage });
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
    endTabPreview(bookmarkPopup.tabId);
    setBookmarkPopup(null);
  };

  const handleCloseBookmarkPopup = (): void => {
    if (!bookmarkPopup) {
      return;
    }
    endTabPreview(bookmarkPopup.tabId);
    setBookmarkPopup(null);
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
    if (jumpTo) {
      activateTab(jumpTo);
    }
    if (tabSearch.tabId) {
      endTabPreview(tabSearch.tabId);
    }
    setTabSearch(null);
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
    if (openId) {
      openWorkspaceImage(openId);
    }
    if (imagesPopup.tabId) {
      endTabPreview(imagesPopup.tabId);
    }
    setImagesPopup(null);
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
    if (workspaceEdit?.tabId) {
      endTabPreview(workspaceEdit.tabId);
    }
    setWorkspaceEdit(null);
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
            the window itself goes true OS fullscreen at the same time
            (see `setFocusMode` in TabManager.ts), so nothing of the
            chrome remains, Escape/Ctrl+Shift+F exit it. */}
        <div className="app__bar">
          {/* The frameless window's own drag region (see MainWindow.ts's
              `frame: false`) — the tab strip shares this row with
              WindowControls rather than sitting on a row of its own, so
              whatever space the tabs don't fill stays draggable, including
              a native double-click-to-maximize there. Tabs themselves opt
              out of dragging (see tab-bar.css) so clicking and reordering
              them still works. */}
          <div className="titlebar">
            <TitlebarGrip />
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
            <WindowControls />
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
                onGoToPage={goToPdfPage}
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
              <HistoryToolbar key={activeTab.id} tab={activeTab} />
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
              showPointerModes={activeTab?.kind === 'pdf'}
              pointerMode={activeTab?.kind === 'pdf' ? activeTab.pointerMode : 'pan'}
              pointerModesLocked={activeTab?.kind === 'pdf' && activeTab.fileName === null}
              onSetPointerMode={(mode) => {
                if (activeTab?.kind === 'pdf') {
                  setPdfPointerMode(activeTab.id, mode);
                }
              }}
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
                activeTab?.kind !== 'history' &&
                !(activeTab?.kind === 'markdown' && activeTab.fileName === null)
              }
              canExportDocuments={browserTab !== null && !isHome}
              showExportMenu={activeTab?.kind !== 'pdf' && activeTab?.kind !== 'history'}
              showCommentTool={!isAppPage}
              showLaserPointer={activeTab?.kind !== 'history'}
              showZoom={activeTab?.kind !== 'history'}
              showTextTool={!isAppPage && activeTab?.kind !== 'markdown'}
              showPen={!isAppPage}
              showHighlighter={!isAppPage}
              showRevert={!isAppPage}
              onNewTerminal={createTerminalTab}
              onOpenHistory={createHistoryTab}
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
          {bookmarkPopup && (
            <BookmarkPopup
              variant={bookmarkPopup.variant}
              url={bookmarkPopup.url}
              title={bookmarkPopup.title}
              previewImage={bookmarkPopup.previewImage}
              onSave={handleSaveBookmark}
              onClose={handleCloseBookmarkPopup}
            />
          )}
          {workspaceEdit && (
            <WorkspaceEditPopup
              // Keyed so reopening for another workspace starts from that one's values.
              key={workspaceEdit.workspaceId}
              workspace={workspaces.find((workspace) => workspace.id === workspaceEdit.workspaceId) ?? workspaces[0]!}
              previewImage={workspaceEdit.previewImage}
              onSave={handleSaveWorkspace}
              onClose={closeWorkspaceEditor}
            />
          )}
          {imagesPopup && (
            <WorkspaceImagesPopup
              images={workspaceImages}
              previewImage={imagesPopup.previewImage}
              onOpen={(id) => closeWorkspaceImages(id)}
              onRemove={removeWorkspaceImage}
              onRename={renameWorkspaceImage}
              onClose={() => closeWorkspaceImages(null)}
            />
          )}
          {tabSearch && (
            <TabSearchPopup
              tabs={tabs}
              workspaces={workspaces}
              previewImage={tabSearch.previewImage}
              onSelect={(tabId) => closeTabSearch(tabId)}
              onClose={() => closeTabSearch(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
