// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-12

import { useEffect, useMemo, useState } from 'react';
import { HOME_URL } from '@shared/constants';
import type { TerminalTabState } from '@shared/tab-state';
import { AddressBar } from './components/AddressBar';
import { NavControls } from './components/NavControls';
import { PageActions } from './components/PageActions';
import { SplitIndicator } from './components/SplitIndicator';
import { TabBar } from './components/TabBar';
import { TabSearch } from './components/TabSearch';
import { Terminal } from './components/Terminal';
import { WorkspaceBar } from './components/WorkspaceBar';
import { useTabs } from './hooks/useTabs';

/**
 * The browser chrome: a full-width top bar (tab strip, back/forward/
 * reload, address bar, and the overlays/toggles layered on top of it —
 * tab search, split view, Focus Mode), with the workspace sidebar beneath
 * it on the left rather than competing with it for the top-left corner,
 * and the tab content area filling what's left. A browser tab's actual
 * page content isn't rendered here at all — it's one or two native
 * `WebContentsView`s the main process positions directly over that same
 * area. A terminal tab is the one exception: it has no native view of its
 * own, so its `Terminal` component (xterm.js) renders right in `.tab-content`.
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
    enterSplitView,
    exitSplitView,
    setFocusMode,
  } = useTabs();

  const [isTabSearchOpen, setTabSearchOpen] = useState(false);

  // The chrome window can lose OS focus to whatever tab's WebContentsView
  // the user last clicked into, so the "Search Tabs" keyboard shortcut is
  // an Electron menu accelerator (see buildMenu.ts) that reaches here via
  // this push instead of a renderer-level keydown listener, which a
  // focused tab would simply swallow.
  useEffect(() => window.northstar.onOpenTabSearch(() => setTabSearchOpen(true)), []);

  const browserTab = activeTab?.kind === 'browser' ? activeTab : null;
  const isHome = browserTab?.url === HOME_URL;
  const activeBookmark = useMemo(
    () => (browserTab ? (bookmarks.find((bookmark) => bookmark.url === browserTab.url) ?? null) : null),
    [browserTab, bookmarks],
  );
  const terminalTabs = useMemo(
    () => tabs.filter((tab): tab is TerminalTabState => tab.kind === 'terminal'),
    [tabs],
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

  const handleToggleBookmark = (): void => {
    if (!browserTab) {
      return;
    }
    if (activeBookmark) {
      removeBookmark(activeBookmark.id);
    } else {
      addBookmark(browserTab.title, browserTab.url);
    }
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
        {!focusMode && (
          <div className="tab-row">
            <TabBar
              tabs={workspaceTabs}
              activeTabId={activeTabId}
              onActivate={activateTab}
              onClose={closeTab}
              onReorder={moveTab}
              grabbedTabId={grabbedTabId}
              onNewTab={() => createTab()}
            />
          </div>
        )}
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
              />
            </>
          )}
          {secondaryTab && <SplitIndicator secondaryTab={secondaryTab} onExit={exitSplitView} />}
          <PageActions
            isBookmarked={activeBookmark !== null}
            canActOnPage={browserTab !== null}
            focusMode={focusMode}
            onToggleBookmark={handleToggleBookmark}
            onExportPdf={() => activeTabId && exportToPdf(activeTabId)}
            onNewTerminal={createTerminalTab}
            onOpenTabSearch={() => setTabSearchOpen(true)}
            onToggleFocusMode={() => setFocusMode(!focusMode)}
          />
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
        {!focusMode && (
          <WorkspaceBar
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            sidebarVisible={sidebarVisible}
            onSwitch={switchWorkspace}
            onCreate={() => createWorkspace()}
            onRename={renameWorkspace}
            onRemove={removeWorkspace}
          />
        )}
        {/* Browser tabs render below via the main process's own native
            WebContentsViews, positioned directly beneath this (empty) area
            by TabManager — see App's doc comment. Terminal tabs are the one
            exception: each stays mounted here for as long as its tab
            exists, shown or hidden by `isActive` rather than by mounting
            only the active one, so its pty and scrollback survive
            switching away and back. */}
        <div className="tab-content">
          {terminalTabs.map((tab) => (
            <Terminal key={tab.id} id={tab.id} isActive={tab.id === activeTabId} exited={tab.exited} />
          ))}
        </div>
      </div>
    </div>
  );
}
