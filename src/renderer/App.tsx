// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-12

import { useEffect, useMemo, useState } from 'react';
import { HOME_URL } from '@shared/constants';
import { AddressBar } from './components/AddressBar';
import { BookmarkPopup } from './components/BookmarkPopup';
import { NavControls } from './components/NavControls';
import { PageActions } from './components/PageActions';
import { SplitIndicator } from './components/SplitIndicator';
import { TabBar } from './components/TabBar';
import { TitlebarGrip } from './components/TitlebarGrip';
import { TabSearch } from './components/TabSearch';
import { WindowControls } from './components/WindowControls';
import { WorkspaceBar } from './components/WorkspaceBar';
import { useTabs } from './hooks/useTabs';
import { useTheme } from './hooks/useTheme';

/** `BookmarkPopup`'s state while open — captured once, when the star button is clicked, not re-derived live, since the popup edits its own copy of the name/URL independent of whatever the tab does in the meantime. */
interface BookmarkPopupState {
  readonly tabId: string;
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
    exportToPdf,
    createTerminalTab,
    revertPage,
    createWorkspace,
    switchWorkspace,
    renameWorkspace,
    removeWorkspace,
    openWorkspaceInNewWindow,
    addBookmark,
    removeBookmark,
    beginTabPreview,
    endTabPreview,
    enterSplitView,
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
    penActive,
    setPen,
  } = useTabs();

  const [isTabSearchOpen, setTabSearchOpen] = useState(false);
  const [bookmarkPopup, setBookmarkPopup] = useState<BookmarkPopupState | null>(null);
  const { theme, toggleTheme } = useTheme();

  // The chrome window can lose OS focus to whatever tab's WebContentsView
  // the user last clicked into, so the "Search Tabs" keyboard shortcut is
  // an Electron menu accelerator (see buildMenu.ts) that reaches here via
  // this push instead of a renderer-level keydown listener, which a
  // focused tab would simply swallow.
  useEffect(() => window.northstar.onOpenTabSearch(() => setTabSearchOpen(true)), []);

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
  // WorkspaceBar's rename, TabSearch) when none of them are active.
  useEffect(() => {
    if (!focusMode && !laserPointerActive && !highlighterActive && !commentToolActive && !penActive) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
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
      if (penActive) {
        setPen(false);
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
    penActive,
    setPen,
  ]);

  const browserTab = activeTab?.kind === 'browser' ? activeTab : null;
  const isHome = browserTab?.url === HOME_URL;
  const activeBookmark = useMemo(
    () => (browserTab ? (bookmarks.find((bookmark) => bookmark.url === browserTab.url) ?? null) : null),
    [browserTab, bookmarks],
  );
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
      setBookmarkPopup({ tabId, url: browserTab.url, title: browserTab.title, previewImage });
    });
  };

  const handleSaveBookmark = (name: string, url: string): void => {
    if (!bookmarkPopup) {
      return;
    }
    addBookmark(name, url);
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

  const handleSplitWithActive = (secondaryId: string): void => {
    if (activeTabId && activeTabId !== secondaryId) {
      enterSplitView(secondaryId);
    }
    setTabSearchOpen(false);
  };

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
              bookmarks={bookmarks}
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
            {activeTab?.kind === 'terminal' ? (
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
                  bookmarks={bookmarks}
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
              canExportPdf={activeTabId !== null}
              canZoom={activeTabId !== null}
              zoomPercent={zoomPercent}
              focusMode={focusMode}
              laserPointerActive={laserPointerActive}
              highlighterActive={highlighterActive}
              commentToolActive={commentToolActive}
              penActive={penActive}
              theme={theme}
              onExportPdf={() => activeTabId && exportToPdf(activeTabId)}
              onNewTerminal={createTerminalTab}
              onOpenTabSearch={() => setTabSearchOpen(true)}
              onZoomOut={zoomOut}
              onZoomIn={zoomIn}
              onSetZoom={setZoom}
              onOpenWorkspaceInNewWindow={openWorkspaceInNewWindow}
              onToggleFocusMode={() => setFocusMode(!focusMode)}
              onToggleLaserPointer={() => setLaserPointer(!laserPointerActive)}
              onToggleHighlighter={() => setHighlighter(!highlighterActive)}
              onToggleCommentTool={() => setCommentTool(!commentToolActive)}
              onTogglePen={() => setPen(!penActive)}
              onRevertPage={() => activeTabId && revertPage(activeTabId)}
              onToggleTheme={toggleTheme}
            />
          </div>
        </div>
        {isTabSearchOpen && (
          <TabSearch
            tabs={tabs}
            workspaces={workspaces}
            activeTabId={activeTabId}
            onClose={() => setTabSearchOpen(false)}
            onActivate={(id) => {
              activateTab(id);
              setTabSearchOpen(false);
            }}
            onSplitWithActive={handleSplitWithActive}
          />
        )}
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
          activeWorkspaceId={activeWorkspaceId}
          sidebarVisible={sidebarVisible && !focusMode}
          focusMode={focusMode}
          selectedWorkspaceIds={selectedWorkspaceIds}
          onToggleSelect={toggleWorkspaceSelection}
          onSelectRange={selectWorkspaceRange}
          onSwitch={switchWorkspace}
          onCreate={() => createWorkspace()}
          onRename={renameWorkspace}
          onRemove={removeWorkspace}
          onDropTab={moveTabToWorkspace}
          onDropTabToNewWorkspace={createWorkspaceWithTab}
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
              url={bookmarkPopup.url}
              title={bookmarkPopup.title}
              previewImage={bookmarkPopup.previewImage}
              onSave={handleSaveBookmark}
              onClose={handleCloseBookmarkPopup}
            />
          )}
        </div>
      </div>
    </div>
  );
}
