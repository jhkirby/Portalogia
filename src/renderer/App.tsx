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
    moveTab,
    navigate,
    goBack,
    goForward,
    reload,
    stop,
    exportToPdf,
    createTerminalTab,
    createWorkspace,
    switchWorkspace,
    renameWorkspace,
    removeWorkspace,
    addBookmark,
    removeBookmark,
    beginTabPreview,
    endTabPreview,
    enterSplitView,
    exitSplitView,
    setFocusMode,
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

  // Belt-and-suspenders for the chrome-focused case, same reasoning as
  // Ctrl+Shift+F's menu accelerator: reliable when chrome itself has OS
  // focus, which is the case this covers (TabManager's own
  // `before-input-event` handler covers the tab-focused case, the far
  // more likely one while Focus Mode is fullscreen — see there). Gated on
  // `focusMode` so it can never interfere with Escape's other, unrelated
  // uses elsewhere in the chrome (AddressBar, WorkspaceBar's rename,
  // TabSearch) — none of which are even reachable while this is on, since
  // Focus Mode hides all of them.
  useEffect(() => {
    if (!focusMode) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setFocusMode(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusMode, setFocusMode]);

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
    if (!browserTab || !activeTabId) {
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
            <TabBar
              tabs={workspaceTabs}
              activeTabId={activeTabId}
              onActivate={activateTab}
              onClose={closeTab}
              onReorder={moveTab}
              grabbedTabId={grabbedTabId}
              onNewTab={() => createTab()}
            />
            <WindowControls />
          </div>
          <div className="toolbar">
            {activeTab?.kind === 'terminal' ? (
              <span className="toolbar__terminal-label">{activeTab.title}</span>
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
                  activeTabId={activeTabId}
                  onBeginTabPreview={beginTabPreview}
                  onEndTabPreview={endTabPreview}
                />
              </>
            )}
            {secondaryTab && <SplitIndicator secondaryTab={secondaryTab} onExit={exitSplitView} />}
            <PageActions
              isBookmarked={activeBookmark !== null}
              canActOnPage={browserTab !== null}
              focusMode={focusMode}
              theme={theme}
              onToggleBookmark={handleToggleBookmark}
              onExportPdf={() => activeTabId && exportToPdf(activeTabId)}
              onNewTerminal={createTerminalTab}
              onOpenTabSearch={() => setTabSearchOpen(true)}
              onToggleFocusMode={() => setFocusMode(!focusMode)}
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
          onSwitch={switchWorkspace}
          onCreate={() => createWorkspace()}
          onRename={renameWorkspace}
          onRemove={removeWorkspace}
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
