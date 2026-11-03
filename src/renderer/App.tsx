// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { HistoryClearRange, MarkdownFormatAction, PageStats } from '@shared/ipc-contract';
import { HOME_URL, ZOOM_PERCENT_STEP } from '@shared/constants';
import type { TabState } from '@shared/tab-state';
import { AddressBar } from './components/AddressBar';
import { BookmarkPopup } from './components/BookmarkPopup';
import { ClearHistoryPopup } from './components/ClearHistoryPopup';
import { ConfirmWordPopup } from './components/ConfirmWordPopup';
import { Mist } from './components/Mist';
import { ToolsBar, type ToolsBarAction } from './components/ToolsBar';
import {
  BoldIcon,
  CodeBlockIcon,
  ExportIcon,
  EyeIcon,
  FileCloseIcon,
  FileNewIcon,
  FileOpenIcon,
  FormattedIcon,
  ItalicIcon,
  LatexIcon,
  LinkIcon,
  NoteEditIcon,
  RawIcon,
  TableIcon,
  TrashIcon,
} from './components/icons';
import { formatShortcut } from './lib/shortcuts';
import { ContentSnapshot } from './components/ContentSnapshot';
import { NavControls } from './components/NavControls';
import { PageActions, TabActions } from './components/PageActions';
import { HistoryToolbar } from './components/HistoryToolbar';
import { BookmarksToolbar } from './components/BookmarksToolbar';
import { SecretsToolbar } from './components/SecretsToolbar';
import { MarkdownToolbar } from './components/MarkdownToolbar';
import { MetalBackground } from './components/MetalBackground';
import { PdfToolbar } from './components/PdfToolbar';
import { PopupTransition } from './components/PopupTransition';
import { TabBar } from './components/TabBar';
import { TitlebarClock } from './components/TitlebarClock';
import { TabSearchPopup } from './components/TabSearchPopup';
import { WorkspaceEditPopup } from './components/WorkspaceEditPopup';
import { WindowControls } from './components/WindowControls';
import { WorkspaceBar } from './components/WorkspaceBar';
import { ItemsStatusBar, WebStatusBar } from './components/WebStatusBar';
import { PAGE_UNFOCUS_KEYS, TERMINAL_UNFOCUS_KEYS } from './components/FocusHint';
import { WorkspaceImagesPopup } from './components/WorkspaceImagesPopup';
import { hostOfUrl, useAdBlock } from './hooks/useAdBlock';
import { useTabs } from './hooks/useTabs';
import { useTheme } from './hooks/useTheme';
import { usePointerGlow } from './hooks/usePointerGlow';

/** The popups that cover the page, each closed with an animation (see `PopupTransition`). */
type PopupName = 'bookmark' | 'tabSearch' | 'images' | 'workspaceEdit' | 'clearHistory' | 'deleteNote' | 'revert';

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
    splitView,
    tabSelectionOrder,
    focusedTabId,
    toggleSplitScreen,
    swapSplitSides,
    focusMode,
    contentFocused,
    sidebarVisible,
    toolsSidebarVisible,
    toggleToolsSidebar,
    canRevert,
    grabbedTabId,
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
    openPdfFile,
    setPointerMode,
    toggleEditMode,
    renamePdfFile,
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
    toggleSidebar,
    setFocusMode,
    zoomPercent,
    splitZoomPercent,
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
  useEffect(() => window.portalogia.onTitlebarPointer(setPointerOnTitlebar), []);
  const titlebarRef = useRef<HTMLDivElement>(null);
  usePointerGlow(titlebarRef, true);
  /** The latest stats main sent for the active web page, with the tab they're for (`WebStatusBar`). */
  const [pageStats, setPageStats] = useState<{
    readonly tabId: string;
    readonly stats: PageStats | null;
    readonly items: readonly string[] | null;
  } | null>(null);
  useEffect(() => window.portalogia.onPageStats((tabId, stats, items) => setPageStats({ tabId, stats, items })), []);
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
  // Escape in the chrome with nothing there using it — no tool or Focus Mode to leave (the effect below), no text box
  // (whose Escape only leaves it), no popup (whose own handler takes the key) — hands the keyboard to the active tab's
  // page, the other half of the page's Shift+Escape.
  useEffect(() => {
    if (focusMode || laserPointerActive || highlighterActive || commentToolActive || textToolActive || penActive || cropActive) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLInputElement && target.type !== 'checkbox' && target.type !== 'radio') ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      void window.portalogia.focusContent();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusMode, laserPointerActive, highlighterActive, commentToolActive, textToolActive, penActive, cropActive]);

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
  // A web tab with no site loaded (its home page) has nothing to search either.
  const canFind =
    (activeTab?.kind === 'browser' && activeTab.url !== '' && activeTab.url !== HOME_URL && !activeTab.url.startsWith('about:')) ||
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
  // PDF bookmarks are files, not pages: the address bar and tab labels only ever deal in the page ones.
  const pageBookmarks = useMemo(() => bookmarks.filter((bookmark) => bookmark.kind === 'page'), [bookmarks]);
  const pdfBookmarks = useMemo(() => bookmarks.filter((bookmark) => bookmark.kind === 'pdf'), [bookmarks]);
  const markdownBookmarks = useMemo(() => bookmarks.filter((bookmark) => bookmark.kind === 'markdown'), [bookmarks]);
  // Whether a PDF's or note's file is bookmarked.
  const isFileBookmarked = (kind: 'pdf' | 'markdown', path: string | null): boolean =>
    path !== null && bookmarks.some((bookmark) => bookmark.kind === kind && bookmark.path === path);
  const handleReloadOrStop = (tab: TabState | null | undefined): void => {
    if (tab?.kind !== 'browser') {
      return;
    }
    if (tab.isLoading) {
      stop(tab.id);
    } else {
      reload(tab.id);
    }
  };

  // Already-bookmarked stays an instant toggle (no popup, nothing to
  // confirm) — the popup is only for the "not yet bookmarked" case, where
  // there's a real name/URL choice to make before committing.
  const handleToggleBookmark = (tab: TabState | null | undefined): void => {
    // The blank default page has no address to save.
    if (tab?.kind !== 'browser' || tab.url === HOME_URL) {
      return;
    }
    const bookmark = pageBookmarks.find((candidate) => candidate.url === tab.url);
    if (bookmark) {
      removeBookmark(bookmark.id);
      return;
    }
    const { id: tabId, url, title } = tab;
    void beginTabPreview(tabId).then((previewImage) => {
      setBookmarkPopup({ tabId, variant: 'page', url, title, previewImage });
    });
  };

  // The same shape as the page star: an already-bookmarked PDF un-bookmarks instantly; otherwise the
  // popup asks for the name first, with the file's path where a page shows its URL.
  const handleTogglePdfBookmark = (tab: TabState): void => {
    if (tab.kind !== 'pdf' || tab.filePath === null || tab.fileName === null) {
      return;
    }
    if (isFileBookmarked('pdf', tab.filePath)) {
      toggleBookmark(tab.id);
      return;
    }
    const { id: tabId, filePath, fileName } = tab;
    void beginTabPreview(tabId).then((previewImage) => {
      setBookmarkPopup({ tabId, variant: 'pdf', url: filePath, title: withoutExtension(fileName), previewImage });
    });
  };

  // The same again for a note: the popup asks for the name, with the file's path where a page shows its URL.
  const handleToggleMarkdownBookmark = (tab: TabState): void => {
    if (tab.kind !== 'markdown' || tab.filePath === null || tab.fileName === null) {
      return;
    }
    if (isFileBookmarked('markdown', tab.filePath)) {
      toggleBookmark(tab.id);
      return;
    }
    const { id: tabId, filePath, fileName } = tab;
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

  const openClearHistory = (range: HistoryClearRange, tabId: string): void => {
    if (clearHistoryPopup) {
      return;
    }
    setClearHistoryPopup({ tabId, range, count: null, previewImage: null });
    void window.portalogia.countHistory(range).then((result) => {
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
        void window.portalogia.clearHistory(range);
      }
    });
  };

  /**
   * The toolbar's tools for one tab — the active tab's, or in split screen each side's: a PDF's or note's file bar
   * and buttons, a table tab's search, or a web page's navigation and address bar.
   */
  const tabToolsFor = (tab: TabState | null | undefined): ReactNode => {
    if (tab?.kind === 'pdf') {
      return (
        <PdfToolbar
          key={tab.id}
          tab={tab}
          isBookmarked={isFileBookmarked('pdf', tab.filePath)}
          onToggleBookmark={() => handleTogglePdfBookmark(tab)}
          pdfBookmarks={pdfBookmarks}
          onOpenBookmark={openPdfBookmark}
          onOpenPdfPath={openPdfPath}
          onNavigate={(id, direction) => (direction === -1 ? goBack(id) : goForward(id))}
          onRename={renamePdfFile}
        />
      );
    }
    if (tab?.kind === 'markdown') {
      return (
        <MarkdownToolbar
          key={tab.id}
          tab={tab}
          isBookmarked={isFileBookmarked('markdown', tab.filePath)}
          onToggleBookmark={() => handleToggleMarkdownBookmark(tab)}
          markdownBookmarks={markdownBookmarks}
          onOpenBookmark={openMarkdownBookmark}
          onOpenPath={openMarkdownPath}
          onNavigate={navigateMarkdownHistory}
          onRename={renameMarkdownFile}
        />
      );
    }
    if (tab?.kind === 'history') {
      return <HistoryToolbar key={tab.id} tab={tab} onRequestClear={(range) => openClearHistory(range, tab.id)} />;
    }
    if (tab?.kind === 'bookmarks') {
      return <BookmarksToolbar key={tab.id} tab={tab} />;
    }
    if (tab?.kind === 'secrets') {
      return <SecretsToolbar key={tab.id} tab={tab} />;
    }
    if (tab?.kind === 'terminal') {
      // Empty on purpose — occupies the same flex space NavControls + AddressBar would, so the page tools stay
      // right-aligned, without showing the tab's title text.
      return <span key={tab.id} className="toolbar__terminal-label" />;
    }
    const pageTab = tab?.kind === 'browser' ? tab : null;
    const pageIsHome = pageTab?.url === HOME_URL;
    const pageBookmark = pageTab ? (pageBookmarks.find((bookmark) => bookmark.url === pageTab.url) ?? null) : null;
    return (
      <>
        <NavControls
          canGoBack={pageTab?.canGoBack ?? false}
          canGoForward={pageTab?.canGoForward ?? false}
          isLoading={pageTab?.isLoading ?? false}
          onBack={() => tab && goBack(tab.id)}
          onForward={() => tab && goForward(tab.id)}
          onReloadOrStop={() => handleReloadOrStop(tab)}
          onHome={() => tab && navigate(tab.id, HOME_URL)}
        />
        {/* Remounted per tab (via key) so its draft text never leaks between tabs. */}
        <AddressBar
          key={tab?.id ?? 'none'}
          url={pageIsHome ? '' : (pageTab?.url ?? '')}
          isLoading={pageTab?.isLoading ?? false}
          loadProgress={pageTab?.loadProgress ?? null}
          onNavigate={(input) => tab && navigate(tab.id, input)}
          bookmarks={pageBookmarks}
          isBookmarked={pageBookmark !== null}
          canBookmark={pageTab !== null && !pageIsHome}
          bookmarkName={pageBookmark?.title ?? null}
          onToggleBookmark={() => handleToggleBookmark(tab)}
        />
      </>
    );
  };

  /**
   * One tab's own page tools (`TabActions`): the ad blocker for its site, and its zoom.
   * @param tab The tab.
   * @param zoom Its zoom and how to change it: the active tab's, or the split's right side's.
   * @param inStrip Whether they sit in `PageActions`' strip, rather than at the end of one half of a split's toolbar.
   */
  const tabActionsFor = (
    tab: TabState | null | undefined,
    zoom: { readonly percent: number; readonly zoomIn: () => void; readonly zoomOut: () => void; readonly set: (percent: number) => void },
    inStrip: boolean,
  ): ReactNode => {
    const pageTab = tab?.kind === 'browser' ? tab : null;
    const site = hostOfUrl(pageTab?.url);
    const siteAllowed = site !== null && adBlock.allowedSites.includes(site);
    const tablePage = tab?.kind === 'history' || tab?.kind === 'bookmarks' || tab?.kind === 'secrets';
    return (
      <TabActions
        showAdBlock={site !== null && pageTab?.url !== HOME_URL}
        adBlockActive={adBlock.enabled && !siteAllowed}
        adBlockGloballyOff={!adBlock.enabled}
        adBlockBlockedCount={tab ? (adBlock.blockedByTab[tab.id] ?? 0) : 0}
        adBlockSite={site ?? ''}
        onToggleAdBlock={() => site && window.portalogia.setAdBlockSiteAllowed(site, !siteAllowed)}
        showZoom={!tablePage}
        canZoom={tab !== undefined}
        zoomPercent={zoom.percent}
        onZoomOut={zoom.zoomOut}
        onZoomIn={zoom.zoomIn}
        onSetZoom={zoom.set}
        noteWidth={
          tab?.kind === 'markdown' && tab.fileName !== null
            ? {
                percent: tab.contentWidth,
                minPercent: tab.contentWidthMin,
                enabled: tab.display === 'formatted',
                onChange: (percent: number) => void window.portalogia.setMarkdownContentWidth(tab.id, percent),
              }
            : null
        }
        inStrip={inStrip}
      />
    );
  };
  const activeZoom = { percent: zoomPercent, zoomIn, zoomOut, set: (percent: number) => setZoom(percent) };

  // Split screen: the two sides' tabs, each with its own half of the toolbar.
  const splitLeftTab = splitView ? tabs.find((tab) => tab.id === splitView.primaryTabId) : undefined;
  const splitRightTab = splitView ? tabs.find((tab) => tab.id === splitView.secondaryTabId) : undefined;
  // A side's zoom: the active side's is the active tab's; the other side's is its own (`splitZoomPercent`).
  const zoomFor = (tab: TabState) =>
    tab.id === activeTabId
      ? activeZoom
      : {
          percent: splitZoomPercent,
          zoomIn: () => setZoom(splitZoomPercent + ZOOM_PERCENT_STEP, tab.id),
          zoomOut: () => setZoom(splitZoomPercent - ZOOM_PERCENT_STEP, tab.id),
          set: (percent: number) => setZoom(percent, tab.id),
        };

  // The frames move with the split: the two come apart from one (`entering`), or the one left widens back out of
  // its half as they come back together — out of the left half, or the right if that side was kept.
  const [shownSplit, setShownSplit] = useState(splitView);
  const [frameMotion, setFrameMotion] = useState<'entering' | 'joining-left' | 'joining-right' | null>(null);
  if (shownSplit?.primaryTabId !== splitView?.primaryTabId || shownSplit?.secondaryTabId !== splitView?.secondaryTabId) {
    if ((shownSplit === null) !== (splitView === null)) {
      setFrameMotion(splitView ? 'entering' : shownSplit?.secondaryTabId === activeTabId ? 'joining-right' : 'joining-left');
    }
    setShownSplit(splitView);
  }

  // A note's or PDF's own file actions, in the Tools sidebar: a note's New, Open, Close and Delete (its Export menu
  // follows them); a PDF's Open, Close, Delete and Export.
  const fileActions = ((): readonly ToolsBarAction[] => {
    if (activeTab?.kind !== 'markdown' && activeTab?.kind !== 'pdf') {
      return [];
    }
    const { id, kind } = activeTab;
    const noFile = activeTab.fileName === null;
    const what = kind === 'pdf' ? 'PDF' : 'note';
    const actions: ToolsBarAction[] = [];
    if (kind === 'markdown') {
      actions.push({
        id: 'file-new',
        name: 'New',
        icon: <FileNewIcon />,
        disabled: false,
        tooltip: 'Create a new note',
        onClick: () => newMarkdownFile(id),
      });
    }
    actions.push(
      {
        id: 'file-open',
        name: 'Open',
        icon: <FileOpenIcon />,
        disabled: false,
        tooltip: `Open a ${what} (${formatShortcut('O')})`,
        onClick: () => (kind === 'pdf' ? openPdfFile(id) : openMarkdownFile(id)),
      },
      {
        id: 'file-close',
        name: 'Close',
        icon: <FileCloseIcon />,
        disabled: noFile,
        tooltip: `Close the open ${what} (${formatShortcut('Shift+C')})`,
        onClick: () => (kind === 'pdf' ? closePdfFile(id) : closeMarkdownFile(id)),
      },
      {
        id: 'file-delete',
        name: 'Delete',
        icon: <TrashIcon />,
        disabled: noFile,
        tooltip: `Delete the open ${what}`,
        onClick: () => openDeleteNote(id),
      },
    );
    if (kind === 'pdf') {
      actions.push({
        id: 'file-export',
        name: 'Export',
        icon: <ExportIcon />,
        disabled: noFile,
        tooltip: 'Export a copy with crops, drawings, text boxes and highlights',
        onClick: () => exportPdfFile(id),
      });
    }
    return actions;
  })();

  // A note's own sections in the Tools sidebar, between the tools and its file actions: first its View/Edit and
  // Formatted/Raw buttons, each named and drawn for the state the note is in and flipping it on a click; then its
  // formatting buttons, which work while it's being edited.
  const noteSections = ((): readonly (readonly ToolsBarAction[])[] => {
    if (activeTab?.kind !== 'markdown') {
      return [];
    }
    const { id, mode, display } = activeTab;
    const noFile = activeTab.fileName === null;
    const editing = mode === 'edit';
    const raw = display === 'raw';
    const modes: ToolsBarAction[] = [
      {
        id: 'note-mode',
        name: editing ? 'Editing' : 'Viewing',
        label: editing ? 'Switch to viewing' : 'Switch to editing',
        icon: editing ? <NoteEditIcon /> : <EyeIcon />,
        disabled: noFile,
        tooltip: `${editing ? 'Editing: switch to viewing, read-only' : 'Viewing: switch to editing'} (${formatShortcut('Shift+G')})`,
        onClick: () => setMarkdownMode(id, editing ? 'view' : 'edit'),
      },
      {
        id: 'note-display',
        name: raw ? 'Raw' : 'Formatted',
        label: raw ? 'Show the formatted note' : 'Show the raw text',
        icon: raw ? <RawIcon /> : <FormattedIcon />,
        disabled: noFile,
        tooltip: raw ? 'Raw text: switch to the formatted note' : 'Formatted note: switch to the raw text',
        onClick: () => setMarkdownDisplay(id, raw ? 'formatted' : 'raw'),
      },
    ];
    const format = (action: MarkdownFormatAction, name: string, icon: ReactNode, tooltip: string): ToolsBarAction => ({
      id: `format-${action}`,
      name,
      icon,
      // Formatting edits the note, so only while it's open for editing.
      disabled: noFile || !editing,
      tooltip: editing ? tooltip : `${tooltip}: switch to editing first`,
      onClick: () => formatMarkdown(id, action),
    });
    const formatting: ToolsBarAction[] = [
      format('bold', 'Bold', <BoldIcon />, `Bold (${formatShortcut('B')})`),
      format('italic', 'Italic', <ItalicIcon />, `Italic (${formatShortcut('I')})`),
      format('link', 'Link', <LinkIcon />, `Make a link (${formatShortcut('Shift+U')})`),
      format('latex', 'LaTeX block', <LatexIcon />, `Wrap in a LaTeX block (${formatShortcut('Shift+L')})`),
      format('code', 'Code block', <CodeBlockIcon />, `Wrap in a code block (${formatShortcut('Shift+K')})`),
      format('table', 'Table', <TableIcon />, 'Insert a table at the caret'),
    ];
    return [modes, formatting];
  })();

  // Split screen: while its button is hovered with two tabs selected, the tab row marks them "L" and "R" (the first
  // selected goes on the left); while split, the two sides stay marked.
  const [splitHover, setSplitHover] = useState(false);
  const splitSides = useMemo((): Readonly<Record<string, 'L' | 'R'>> => {
    if (splitView) {
      return { [splitView.primaryTabId]: 'L', [splitView.secondaryTabId]: 'R' };
    }
    const [left, right, ...more] = tabSelectionOrder;
    return splitHover && left && right && more.length === 0 ? { [left]: 'L', [right]: 'R' } : {};
  }, [splitView, tabSelectionOrder, splitHover]);

  // A note's or PDF's Delete: confirmed the same way as Clear History (typing "delete"), over its tab, before its
  // file goes to the Recycle Bin.
  const [deleteNotePopup, setDeleteNotePopup] = useState<{
    readonly tabId: string;
    readonly kind: 'markdown' | 'pdf';
    readonly fileName: string;
    readonly previewImage: string | null;
  } | null>(null);

  const openDeleteNote = (tabId: string): void => {
    const tab = tabs.find((candidate) => candidate.id === tabId);
    if (deleteNotePopup || (tab?.kind !== 'markdown' && tab?.kind !== 'pdf') || tab.fileName === null) {
      return;
    }
    setDeleteNotePopup({ tabId, kind: tab.kind, fileName: tab.fileName, previewImage: null });
    void beginTabPreview(tabId).then((previewImage) => {
      setDeleteNotePopup((current) => (current ? { ...current, previewImage } : current));
    });
  };

  // Revert annotations takes every mark off the page, so it's confirmed the same way: by typing "revert". The Tools
  // sidebar's Revert opens it, and so does its shortcut (main asks, `onRevertRequested`).
  const [revertPopup, setRevertPopup] = useState<{ readonly tabId: string; readonly previewImage: string | null } | null>(null);

  const openRevert = (): void => {
    const tabId = activeTabId;
    if (revertPopup || !tabId) {
      return;
    }
    setRevertPopup({ tabId, previewImage: null });
    void beginTabPreview(tabId).then((previewImage) => {
      setRevertPopup((current) => (current ? { ...current, previewImage } : current));
    });
  };

  const closeRevert = (confirmed: boolean): void => {
    if (!revertPopup) {
      return;
    }
    const { tabId } = revertPopup;
    closePopupAnimated('revert', () => {
      endTabPreview(tabId);
      setRevertPopup(null);
      // Reverted once the page is back in view, so its marks can be seen going.
      if (confirmed) {
        revertPage(tabId);
      }
    });
  };

  // The latest `openRevert` for the shortcut's listener, which subscribes once.
  const openRevertRef = useRef(openRevert);
  openRevertRef.current = openRevert;
  useEffect(() => window.portalogia.onRevertRequested(() => openRevertRef.current()), []);

  const closeDeleteNote = (confirmed: boolean): void => {
    if (!deleteNotePopup) {
      return;
    }
    const { tabId, kind } = deleteNotePopup;
    closePopupAnimated('deleteNote', () => {
      endTabPreview(tabId);
      setDeleteNotePopup(null);
      if (confirmed) {
        void (kind === 'pdf' ? window.portalogia.deletePdfFile(tabId) : window.portalogia.deleteMarkdownFile(tabId));
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

  useEffect(() => window.portalogia.onOpenWorkspaceImages(openWorkspaceImages));

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
  useEffect(() => window.portalogia.onEditWorkspace(() => openWorkspaceEditor(activeWorkspaceId)));

  // The chrome window can lose OS focus to whatever tab's WebContentsView
  // the user last clicked into, so the "Search Tabs" keyboard shortcut is
  // an Electron menu accelerator (see buildMenu.ts) that reaches here via
  // this push instead of a renderer-level keydown listener, which a
  // focused tab would simply swallow.
  useEffect(() => window.portalogia.onOpenTabSearch(openTabSearch));

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
            {/* Mist drifting along the row, then the accent glowing around the pointer, both under the tabs and buttons. */}
            <Mist variant="row" />
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
              onDragEndOutside={tearOffTab}
              onDragOutOfWindow={(id, x, y) => tearOffTab(id, x, y, true)}
              onTearOffEnd={tearOffTabEnd}
              onReportDropRegions={reportDropRegions}
              splitSides={splitSides}
              splitTabIds={splitView ? [splitView.primaryTabId, splitView.secondaryTabId] : []}
            />
            <div className="titlebar__corner">
              <TitlebarClock />
              <WindowControls />
            </div>
          </div>
          <div className={`toolbar${splitLeftTab && splitRightTab ? ' toolbar--split' : ''}`}>
            {splitLeftTab && splitRightTab ? (
              // Split screen: each side's tools in its own half, a line between them; the window's own after.
              <>
                <div className="toolbar__side">
                  {tabToolsFor(splitLeftTab)}
                  <div className="page-actions page-actions--side">{tabActionsFor(splitLeftTab, zoomFor(splitLeftTab), false)}</div>
                </div>
                <span className="toolbar__split-divider" role="separator" aria-hidden="true" />
                <div className="toolbar__side">
                  {tabToolsFor(splitRightTab)}
                  <div className="page-actions page-actions--side">{tabActionsFor(splitRightTab, zoomFor(splitRightTab), false)}</div>
                </div>
                <span className="page-actions__divider" role="separator" aria-hidden="true" />
              </>
            ) : (
              tabToolsFor(activeTab)
            )}
            <PageActions
              tabActions={splitLeftTab && splitRightTab ? null : tabActionsFor(activeTab, activeZoom, true)}
              focusMode={focusMode}
              theme={theme}
              splitActive={splitView !== null}
              canSplit={tabSelectionOrder.length === 2}
              onToggleSplit={toggleSplitScreen}
              onSwapSplit={swapSplitSides}
              onSplitHover={setSplitHover}
              onOpenTabSearch={openTabSearch}
              findOpen={findOpen}
              canFind={canFind}
              onToggleFind={() => setFind(!findOpen)}
              onOpenWorkspaceInNewWindow={openWorkspaceInNewWindow}
              onToggleFocusMode={() => setFocusMode(!focusMode)}
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
          {!focusMode &&
            (splitView ? (
              // Split screen: a frame for each side showing a web page (a note, PDF or terminal draws its own), lit on
              // whichever side has the keyboard.
              ([
                [splitView.primaryTabId, 'left'],
                [splitView.secondaryTabId, 'right'],
              ] as const).map(([tabId, side]) =>
                tabs.find((tab) => tab.id === tabId)?.kind === 'browser' ? (
                  <div
                    key={side}
                    className={`tab-content__frame tab-content__frame--split-${side}${focusedTabId === tabId ? ' tab-content__frame--focused' : ''}${frameMotion === 'entering' ? ' tab-content__frame--entering' : ''}`}
                    aria-hidden="true"
                    onAnimationEnd={() => setFrameMotion(null)}
                  />
                ) : null,
              )
            ) : (
              activeTab?.kind === 'browser' && (
                <div
                  className={`tab-content__frame${contentFocused ? ' tab-content__frame--focused' : ''}${frameMotion === 'joining-left' ? ' tab-content__frame--joining' : ''}${frameMotion === 'joining-right' ? ' tab-content__frame--joining-right' : ''}`}
                  aria-hidden="true"
                  onAnimationEnd={() => setFrameMotion(null)}
                />
              )
            ))}
          {/* The tab's pages in picture, standing in for them while the sidebar slides. */}
          <ContentSnapshot />
          {/* In the strip main keeps free below a web page; a note, PDF or terminal draws its own — except in split
              screen, where this one bar runs the whole way across with the stats of the side used last. Focus Mode
              shows none. */}
          {activeTab?.kind === 'browser' && !focusMode && (
            <WebStatusBar stats={pageStats?.tabId === activeTab.id ? pageStats.stats : null} contentFocused={contentFocused} />
          )}
          {activeTab && activeTab.kind !== 'browser' && splitView && !focusMode && (
            <ItemsStatusBar
              items={pageStats?.tabId === activeTab.id ? pageStats.items : null}
              contentFocused={contentFocused}
              unfocusKeys={activeTab.kind === 'terminal' ? TERMINAL_UNFOCUS_KEYS : PAGE_UNFOCUS_KEYS}
              label={
                activeTab.kind === 'pdf'
                  ? 'PDF statistics'
                  : activeTab.kind === 'markdown'
                    ? 'Note statistics'
                    : activeTab.kind === 'terminal'
                      ? 'Terminal statistics'
                      : 'Statistics'
              }
            />
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
          {deleteNotePopup && (
            <PopupTransition closing={closingPopups.has('deleteNote')} onExited={() => finishPopupClose('deleteNote')}>
              <ConfirmWordPopup
                title={`Delete ${deleteNotePopup.fileName}?`}
                detail={
                  deleteNotePopup.kind === 'pdf'
                    ? 'The file goes to the Recycle Bin.'
                    : 'The file goes to the Recycle Bin, and its marks are removed.'
                }
                word="DELETE"
                dialogLabel={deleteNotePopup.kind === 'pdf' ? 'Delete PDF' : 'Delete note'}
                previewImage={deleteNotePopup.previewImage}
                onConfirm={() => closeDeleteNote(true)}
                onClose={() => closeDeleteNote(false)}
              />
            </PopupTransition>
          )}
          {revertPopup && (
            <PopupTransition closing={closingPopups.has('revert')} onExited={() => finishPopupClose('revert')}>
              <ConfirmWordPopup
                title="Revert annotations?"
                detail="Every highlight, drawing, comment, text box and crop on this page is removed."
                word="REVERT"
                dialogLabel="Revert annotations"
                previewImage={revertPopup.previewImage}
                onConfirm={() => closeRevert(true)}
                onClose={() => closeRevert(false)}
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
        {/* The page tools, on the right — mirrored from the workspaces on the left, and only those the tab can use. */}
        <ToolsBar
          visible={toolsSidebarVisible}
          focusMode={focusMode}
          onToggleVisible={toggleToolsSidebar}
          canAnnotate={browserTab !== null || activeTab?.kind === 'pdf' || activeTab?.kind === 'markdown'}
          canPoint={activeTabId !== null}
          // Marks go on the formatted, read-only note, so editing or raw text locks them too.
          annotationToolsLocked={
            isHome ||
            ((activeTab?.kind === 'pdf' || activeTab?.kind === 'markdown') && activeTab.fileName === null) ||
            (activeTab?.kind === 'markdown' && (activeTab.mode === 'edit' || activeTab.display === 'raw'))
          }
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
          showLaserPointer={!isTablePage}
          laserPointerActive={laserPointerActive}
          onToggleLaserPointer={() => setLaserPointer(!laserPointerActive)}
          showPen={!isAppPage}
          penActive={penActive}
          onTogglePen={() => setPen(!penActive)}
          showHighlighter={!isAppPage}
          highlighterActive={highlighterActive}
          onToggleHighlighter={() => setHighlighter(!highlighterActive)}
          showCommentTool={!isAppPage}
          commentToolActive={commentToolActive}
          onToggleCommentTool={() => setCommentTool(!commentToolActive)}
          showTextTool={!isAppPage && activeTab?.kind !== 'markdown'}
          textToolActive={textToolActive}
          onToggleTextTool={() => setTextTool(!textToolActive)}
          showCrop={activeTab?.kind === 'pdf'}
          cropActive={cropActive}
          onToggleCrop={() => setCrop(!cropActive)}
          showRevert={!isAppPage}
          canRevert={canRevert}
          showExport={activeTab?.kind !== 'pdf' && !isTablePage}
          canExport={
            activeTabId !== null &&
            !isHome &&
            activeTab?.kind !== 'pdf' &&
            !isTablePage &&
            !(activeTab?.kind === 'markdown' && activeTab.fileName === null)
          }
          canExportDocuments={browserTab !== null && !isHome}
          exportMarkdown={activeTab?.kind === 'markdown'}
          fileActions={fileActions}
          actionSections={noteSections}
          onRevertPage={openRevert}
        />
      </div>
    </div>
  );
}
