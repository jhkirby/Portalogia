// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-21

import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import {
  app,
  BrowserWindow,
  WebContentsView,
  dialog,
  ipcMain,
  nativeTheme,
  screen,
  shell,
  type IpcMainEvent,
  type WebContents,
} from 'electron';
import { findResultRequestSchema, type MarkdownAnnotations } from '@shared/ipc-schemas';
import {
  CHROME_HEIGHT_FOCUSED_PX,
  CHROME_HEIGHT_PX,
  MAX_TABS_PER_WORKSPACE,
  MAX_WORKSPACES,
  TAB_STRIP_HEIGHT_PX,
  DEFAULT_TAB_URL,
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_NAME,
  HOME_URL,
  MARKDOWN_PRINT_GLOBAL,
  SIDEBAR_COLLAPSED_WIDTH_PX,
  SIDEBAR_TOGGLE_DURATION_MS,
  SPLIT_ANIMATION_MS,
  SIDEBAR_WIDTH_PX,
  TOOLS_SIDEBAR_WIDTH_PX,
  TERMINAL_PREPARE_PRINT_GLOBAL,
  WORKSPACE_COLORS,
  ZOOM_PERCENT_DEFAULT,
  ZOOM_PERCENT_MAX,
  ZOOM_PERCENT_MIN,
  ZOOM_PERCENT_STEP,
  ZOOM_PERCENT_WHEEL_STEP,
  ZOOM_PERCENT_WHEEL_STEP_COARSE,
  STATUS_BAR_HEIGHT_PX,
  CONTENT_FRAME_BORDER_PX,
  CONTENT_FRAME_INSET_X_PX,
  CONTENT_FRAME_INSET_Y_PX,
  CONTENT_FRAME_RADIUS_PX,
} from '@shared/constants';
import { escapeHtml } from '@shared/html';
import { DEFAULT_WORKSPACE_ICON, isWorkspaceIconId } from '@shared/workspaceIcons';
import {
  IpcChannel,
  type AddressSuggestionsSyncPayload,
  type BookmarkUpdateResult,
  type ColorPickerSyncPayload,
  type ExportMenuAction,
  type MenuOverlayAction,
  type NewTabMenuAction,
  type ExportMenuSyncPayload,
  type FindCommand,
  type FindResult,
  type HistoryClearRange,
  type HistoryEntry,
  type HistorySuggestion,
  type MarkdownBacklink,
  type MarkdownFormatAction,
  type MarkdownFileData,
  type MarkdownRunResult,
  type PdfOpenResult,
  type TooltipSyncPayload,
  type PageStats,
  type SecretPromptOffer,
} from '@shared/ipc-contract';
import { isNavigableUrl, normalizeUrlOrSearch } from '@shared/url';
import { LOCAL_PAGE_EXTENSIONS, localPageUrl } from './localPage';
import type {
  BrowserState,
  BrowserTabState,
  MarkdownDisplay,
  PointerMode,
  SplitViewState,
  TabState,
  WorkspaceState,
} from '@shared/tab-state';
import type { ImageTab, WorkspaceImageStore } from './WorkspaceImageStore';
import { pdfAnnotationStore } from './PdfAnnotationStore';
import { PdfCropExporter } from './PdfCropExporter';
import { buildMarkdownCsp } from '@shared/markdown/csp';
import { listCodeBlocks, splitWikiTarget } from '@shared/markdown/parser';
import { markdownToPlainText } from '@shared/markdown/plainText';
import { isRunnableLanguage, runCodeBlock } from './MarkdownCodeRunner';
import { readFileCapped } from '../platform/readFileCapped';
import { beginLoad, endLoad } from './loadProgress';
import { trackDomainLoadBlur } from './domainLoadBlur';
import { EMPTY_MARKDOWN_ANNOTATIONS, markdownAnnotationStore } from './MarkdownAnnotationStore';
import { FileLoadProgress } from './FileLoadProgress';
import { onAnnotationsChanged } from './annotationChanges';
import { MarkdownDocuments } from './MarkdownDocuments';
import { PickedImageStore } from './PickedImageStore';
import {
  MARKDOWN_EXTENSION_PATTERN,
  findBacklinks,
  forgetVaultScans,
  isMarkdownPath,
  listNoteNames,
  fetchRemoteImageDataUrl,
  imageLinkFor,
  PICKABLE_IMAGE_EXTENSIONS,
  readImageDataUrl,
  resolveLinkTarget,
  resolveWikiLinks,
  resolveWikiTarget,
  samePath,
  toNoteFileName,
} from './MarkdownVault';
import type { BookmarkStore } from './BookmarkStore';
import type { BookmarksController } from './BookmarksController';
import type { SecretsController } from './SecretsController';
import { SecretPromptOverlay } from './SecretPromptOverlay';
import type { CommentController } from './CommentController';
import type { TextBoxController } from './TextBoxController';
import type { HistoryController } from './HistoryController';
import type { AdBlocker } from '../adblock/AdBlocker';
import { editableKindOf, hasEditableFocus } from './editableFocus';
import { isTextEditingChord, type TextBoxContext } from './textEditingChords';
import { isToolShortcut, markdownFormatShortcut, pointerModeShortcut, tabJumpIndex } from './toolShortcuts';
import { FindOverlay } from './FindOverlay';
import { DEFAULT_FIND_OPTIONS, type FindOptions } from '@shared/find';
import { ColorPickerOverlay } from './ColorPickerOverlay';
import { ExportMenuOverlay } from './ExportMenuOverlay';
import type { HighlighterController } from './HighlighterController';
import { LaserPointerOverlay } from './LaserPointerOverlay';
import { PageDocumentExporter } from './PageDocumentExporter';
import type { PenController } from './PenController';
import { getCurrentAccent, trackPageSelectionAccent } from './pageSelectionAccent';
import type { SessionContents, SessionStore, SidebarLayout } from './SessionStore';
import type { SharedTabRegistry } from './SharedTabRegistry';
import { SuggestionsOverlay } from './SuggestionsOverlay';
import { ContentSnapshot } from './ContentSnapshot';
import { TooltipOverlay } from './TooltipOverlay';
import type { TerminalManager } from '../terminal/TerminalManager';
import { cursorWarper } from '../platform/CursorWarper';

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What the find bar shows before a search has answered, and after a search of nothing. */
const NO_FIND_RESULT: FindResult = { index: 0, total: 0, capped: false, invalid: false };

/** A closed tab's minimal recreatable state — enough to reopen it, not to replay its full history. */
interface ClosedTab {
  readonly url: string;
  readonly workspaceId: string;
}

/** How long, in ms, a web page takes to fade away before going to the home page (`navigate`). */
const HOME_FADE_MS = 250;

/** The home page's background (`homePage.ts`): what a page fades to on its way there. */
const HOME_BACKGROUND = { light: '#ffffff', dark: '#202124' } as const;

/** How long, in ms, a newly shown tab takes to fade in when switching tabs (`fadeInTab`). */
const TAB_FADE_MS = 400;

/**
 * How long, in ms, the tab being left stays on top of the one being shown, so the new one has painted its cover
 * before it's seen (it would otherwise show its last frame, uncovered, for an instant). The fade waits this long too.
 */
const TAB_FADE_COVER_MS = 50;

/**
 * What's inside an app page's frame, the only part of it that fades in when its tab is shown (`fadeInTab`): the
 * children of a PDF's frame, a note's, the History, Bookmarks and Secrets table's, and a terminal's. A PDF or note
 * with nothing open shows its empty frame instead (`--empty`, `.md-viewer__empty`), which matches none of these.
 */
const APP_PAGE_CONTENT =
  ':is(.pdf-viewer__body:not(.pdf-viewer__body--empty), .md-viewer > .md-viewer__body, .history__table-wrap, ' +
  '.terminal__surface) > *';

/** The colour a newly shown tab fades in from: the chrome's own (`--color-chrome-bg`), by theme. */
const TAB_FADE_COLOR = { light: '#f1f3f4', dark: '#202124' } as const;

/** How long each of the split's two pages takes to fade out, and then back in, as the sides swap (`swapSplitSides`). */
const SPLIT_SWAP_FADE_MS = 160;

/** How far past the window's right edge a view waits out the sidebar's slide (`slideSidebar`): wholly out of sight. */
const PARKED_OFFSET_PX = 1000;

/** How many closed tabs `restoreLastClosedTab` can reach back through. */
const CLOSED_TAB_HISTORY_LIMIT = 20;

/**
 * How long to wait for another Space auto-repeat before treating it as
 * released — see `armSpaceHoldTimeout`. Comfortably longer than even a
 * slow OS key-repeat interval, so it never fires while Space is still
 * actually held.
 */
const SPACE_HOLD_GRACE_MS = 600;

/**
 * Absolute ceiling on a single keyboard-grab, regardless of any repeat or
 * key-up signal — a last-resort net under `armSpaceHoldTimeout` and the
 * Control-release path, in case both somehow miss (e.g. focus lost to
 * something that swallows input entirely). No legitimate reorder needs
 * anywhere near this long.
 */
const GRAB_MAX_DURATION_MS = 15_000;


/** Largest PDF `openPdfFile` will read into memory and push over IPC. */
const MAX_PDF_BYTES = 512 * 1024 * 1024;

/** True while `moveTabToWorkspace` is relocating the rest of a linked group, so those nested calls don't expand the group again. */
let relocatingLinkGroup = false;

/** On-disk path of the file each PDF tab has open, by tab id. Module-level so it survives a tab moving between windows' managers. */
const pdfFilePaths = new Map<string, string>();

/** The annotation key (SHA-256 of the bytes) of the file each PDF tab has open — the only key that tab's page may save marks under. */
const pdfFileKeys = new Map<string, string>();

/**
 * The notes the last backlink search found for each PDF tab, by tab id, as absolute paths: the only notes that tab's
 * page may ask to open (`openPdfBacklink`). Module-level for the same reason as `pdfFilePaths`.
 */
const pdfBacklinkPaths = new Map<string, readonly string[]>();

/** The notes open in Markdown tabs, by tab id. Module-level for the same reason as `pdfFilePaths`: a tab can move between windows' managers. */
const markdownDocuments = new MarkdownDocuments();

/** The pictures the user picked in a note's image dialog (see `PickedImageStore`), made on first use — `app` must be ready. */
let pickedImageStore: PickedImageStore | null = null;
function pickedImages(): PickedImageStore {
  pickedImageStore ??= new PickedImageStore(join(app.getPath('userData'), 'picked-images.json'));
  return pickedImageStore;
}

/** How long the address bar's progress line stays at 100% after a page finishes loading, so it can be read. */
const LOAD_PROGRESS_HOLD_MS = 1000;

/**
 * The views of tabs that have closed. Taking a view off the window doesn't stop its page: a closed YouTube tab went on
 * playing, unseen, and every closed tab's page stayed in memory. A closed tab's page is silenced the moment the tab
 * closes and closed outright once its view is off the window (`releaseView`) — not at once, since the active tab's
 * page stays up a moment over the one fading in to take its place. Module-level, like `pdfFilePaths`: a tab can close
 * in one window while another took its view down.
 */
const retiredViews = new WeakSet<WebContentsView>();

/**
 * Whether each tab's page had the keyboard when it was last the active tab, so coming back to it after a preview gives
 * the page the keyboard again only if it had it then (`giveKeyboardAsLeft`) — selecting a tab never puts the cursor in
 * its page (`showWithoutKeyboard`), and lets this go. Set when a page gets the keyboard; cleared when the keyboard goes
 * to the chrome on purpose (`focusChrome`), or when the page loses it
 * while its tab is still the one showing (`PAGE_FOCUS_SETTLE_MS` later — a click on another tab takes the keyboard
 * first, and must not count). A tab not in here — a new one — starts without it. Module-level, like `pdfFilePaths`.
 */
const pageHadKeyboard = new Map<string, boolean>();

/**
 * How long after a page loses the keyboard its tab must still be the active one for that to count as leaving the page
 * (`pageHadKeyboard`): long enough for a click on another tab to switch to it, and so to leave this one as it was.
 */
const PAGE_FOCUS_SETTLE_MS = 1000;

/**
 * How long after a page gets the keyboard with the comment or text box tool in hand the box the press made has to
 * take the caret, before the keyboard goes back to the chrome (`keepKeyboardOffPage`).
 */
const TOOL_BOX_FOCUS_SETTLE_MS = 200;

/**
 * In split screen, the side margin a page that draws its own frame (a note, PDF, terminal, History…) keeps around it:
 * half the gap between the two frames, so the two pages meet in the middle of it. A web page's frame is the chrome's,
 * so it needs none. See `TabManager.computeSplitPanes`.
 */
const SPLIT_PAGE_MARGIN_PX = CONTENT_FRAME_INSET_X_PX / 2;

/**
 * Each PDF or Markdown tab's file load, for its file bar's progress (see `FileLoadProgress`). Module-level for the same
 * reason as `pdfFilePaths`: a tab can move between windows' managers while a file loads.
 */
const fileLoads = new Map<string, FileLoadProgress>();

/** The whole percent of its file each PDF or Markdown tab last pushed its byte count at (`setFileLoadBytes`). */
const fileLoadByteSteps = new Map<string, number>();

/** How much of a PDF's load is reading it from disk; the rest is its page parsing the document and measuring its pages. */
const PDF_READ_SHARE_PERCENT = 50;

/** How much of a note's load is reading it from disk; the rest is sending it to its page to draw. */
const NOTE_READ_SHARE_PERCENT = 90;

/** Each web page's latest stats, from its own page (`setPageStats`); shared, since a tab can move between windows. */
const pageStatsByTab = new Map<string, PageStats>();

/** What each note's, PDF's or terminal's own stat bar last showed, item by item (`setStatItems`). */
const statItemsByTab = new Map<string, readonly string[]>();

/** Markdown tabs whose page has finished loading — a note sent before then would have nobody listening, so it waits for `did-finish-load`. */
const markdownPagesReady = new Set<string>();

/** Code blocks the user has agreed to run, until the app restarts — hashes of note path, language and code (see `runMarkdownCode`). */
const markdownTrustedBlocks = new Set<string>();

/** The most of a block's code the run prompt shows; a native dialog can't scroll. */
const CODE_PREVIEW_MAX_CHARS = 1500;
const CODE_PREVIEW_MAX_LINES = 30;

/** Markdown tabs with a code block running right now — one at a time per tab. */
const markdownRunning = new Set<string>();

/** Markdown tabs that have already shown a "could not save" box, so a failing disk isn't reported on every keystroke. */
const markdownSaveErrorShown = new Set<string>();

/** Removes a Markdown tab's content-security-policy header hook once the tab is gone. */
const markdownCspRemovers = new Map<string, () => void>();

/**
 * The pointer mode last sent to each web page (by `webContents` id), so a page is only told when it changes. Kept
 * here rather than per window: a page moves between windows, and each would otherwise think it still knew.
 */
const pagePointerModesSent = new Map<number, string>();

/**
 * Whether a kind of tab has the Pan and Select pointer modes.
 * @param kind The tab's kind, if there is a tab.
 */
function isPointerModeKind(kind: TabState['kind'] | undefined): kind is 'pdf' | 'markdown' | 'browser' {
  return kind === 'pdf' || kind === 'markdown' || kind === 'browser';
}

/**
 * Owns every tab's `WebContentsView`, keeps a `TabState` snapshot per tab,
 * groups tabs into workspaces, and positions the on-screen view(s) beneath
 * the chrome (one full-width view normally, or two side by side in split
 * view). This is the only place in the app that touches tab `WebContents`
 * directly — the IPC layer and the menu both go through this class instead
 * of reaching into Electron themselves.
 *
 * Invariant kept throughout: whichever tab is `activeTabId` always has its
 * view mounted (full width normally, the left/primary half during split
 * view) — split view only ever adds a second, "secondary" view alongside
 * it, never replaces the active-tab invariant.
 */
export class TabManager {
  // Aliases onto `SharedTabRegistry`'s own maps (see its class doc comment)
  // rather than each window's own copy — every existing method below that
  // reads/writes `this.views`/`this.states`/`this.workspaces` keeps working
  // completely unchanged, now operating on data every window shares.
  private readonly views: Map<string, WebContentsView>;
  private readonly states: Map<string, TabState>;
  private readonly workspaces: Map<string, WorkspaceState>;
  private readonly lastActiveTabIdByWorkspace = new Map<string, string>();
  private readonly closedTabs: ClosedTab[] = [];
  /** The search text each History tab's table is filtered by — typed in the chrome's toolbar, so kept here to hand to a page that loads after it was typed. */
  private readonly historyQueries = new Map<string, string>();
  /** The time range each History tab's table shows, by tab id (all time until its toolbar says otherwise). */
  private readonly historyRanges = new Map<string, HistoryClearRange>();
  /** The search text each Bookmarks tab's table is filtered by — same reasoning as `historyQueries`. */
  private readonly bookmarksQueries = new Map<string, string>();
  /** The search text each Secrets tab's table is filtered by — same reasoning as `historyQueries`. */
  private readonly secretsQueries = new Map<string, string>();
  private activeTabId: string | null = null;
  private activeWorkspaceId: string;
  private splitView: SplitViewState | null = null;
  /**
   * How far apart the split's two sides are, 0 (one screen, the left tab's) to 1 (side by side): below 1 only while
   * `animateSplit` moves them.
   */
  private splitProgress = 1;
  /** Bumped by each split animation, so one that's superseded (or a split taken down meanwhile) stops. */
  private splitAnimationToken = 0;
  /** Whether the split is coming back together (`exitSplitView`): the chrome already shows one screen. */
  private splitClosing = false;
  /** Whether the split's sides are trading places (`swapSplitSides`), faded out and back in. */
  private splitSwapping = false;
  /**
   * Each workspace's split pair, by workspace id: the two tabs last shown side by side there, left then right. Kept
   * while another tab is shown (in the workspace or another one), so choosing either again shows the split again
   * (`activateTab`); let go only when the split is closed on purpose (`exitSplitView`), or a tab of it leaves the
   * workspace (`prunePairs`). The tab row shows the two side by side, as one tab (`BrowserState.splitPair`).
   */
  private readonly pairByWorkspace = new Map<string, SplitViewState>();
  /** Set while `activateTab` brings a pair's split back, so the activations it makes don't try to bring it back again. */
  private restoringPair = false;
  /**
   * The style hiding the stat bar of a page that draws its own (a note, PDF or terminal) while it's the split's other
   * side, by tab: the bottom row shows one set of stats, the active side's (`syncSplitStatBars`).
   */
  private readonly splitHiddenStatBars = new Map<string, Promise<string>>();
  /** The style each self-framing page in the split was given for its narrower margins (`SPLIT_PAGE_MARGIN_PX`), by tab. */
  private readonly splitMarginStyles = new Map<string, Promise<string>>();
  private focusMode = false;
  private sidebarVisible = true;
  /** Whether the Tools sidebar on the right is shown in full (`toggleToolsSidebar`), rather than as its rail of icons. */
  private toolsSidebarVisible = true;
  /**
   * The right inset the tab views are laid out with now: `targetRightInset` at rest, somewhere between two values
   * while the Tools sidebar slides (`animateBoundsInset` moves it). Kept rather than passed along, since only the
   * slides ever change it and every other layout just reads it.
   */
  private rightInsetNow = TOOLS_SIDEBAR_WIDTH_PX;
  private laserPointerActive = false;
  /** While true, `handleWorkspaceRemoved` doesn't mount a fallback tab — set on a window that's being dragged around as a whole and may be closed on release. */
  private suppressWorkspaceFallback = false;
  /** Tabs multi-selected (Ctrl/Shift+click), active tab included. Read through `currentTabSelection`, which prunes stale entries. */
  private selectedTabIds = new Set<string>();
  /** Workspaces multi-selected (Ctrl/Shift+click), active one included. Read through `currentWorkspaceSelection`. */
  private selectedWorkspaceIds = new Set<string>();
  private dropRegions: readonly { x: number; y: number; width: number; height: number }[] = [];
  private highlighterActive = false;
  private commentToolActive = false;
  private textToolActive = false;
  /** Whether this window's find bar is open, and what it holds — the bar is one view for every kind of tab; the search itself runs in whichever tab is active. */
  private findOpen = false;
  private findQuery = '';
  private findOptions: FindOptions = DEFAULT_FIND_OPTIONS;
  private findResult: FindResult = NO_FIND_RESULT;
  private readonly onFindResult = (event: IpcMainEvent, raw: unknown): void => this.handleFindResult(event.sender, raw);
  private penActive = false;
  private cropActive = false;
  /** The tab grabbed for keyboard reordering (Ctrl+Space held); see `grabTabForReorder`. */
  private grabbedTabId: string | null = null;
  /** Armed while a tab is grabbed; see `armSpaceHoldTimeout`. */
  private spaceHoldTimeout: ReturnType<typeof setTimeout> | null = null;
  /** Set once per grab, never reset by repeats; see `GRAB_MAX_DURATION_MS`. */
  private grabMaxDurationTimeout: ReturnType<typeof setTimeout> | null = null;
  /** Bumped on every `toggleSidebar`/`setFocusMode` call so an in-flight bounds animation can tell it's been superseded and stop early. */
  private boundsAnimationToken = 0;
  /** Set for the duration of an in-flight bounds animation (see `animateBoundsInset`) — lets `updateBounds` defer to the animation's own frames instead of fighting them with a one-off instant jump, e.g. from the native 'resize' event `setFullScreen` fires when Focus Mode toggles. */
  private isAnimatingBounds = false;
  /** Set from a sidebar toggle until its slide is done (`slideSidebar`); a toggle meanwhile is ignored. */
  private sidebarSliding = false;
  /** The picture of the pages the chrome slides with the sidebar, in their place (`slideSidebar`). */
  private readonly contentSnapshot: ContentSnapshot;
  /** The tab whose page is fullscreen (see `setHtmlFullScreen`), if any. */
  private htmlFullScreenTabId: string | null = null;
  /** Whether the window was already OS-fullscreen (Focus Mode) when a page went fullscreen, so leaving doesn't pull it out. */
  private windowWasFullScreen = false;
  private readonly terminals: TerminalManager;
  private readonly suggestionsOverlay: SuggestionsOverlay;
  private readonly tooltipOverlay: TooltipOverlay;
  private readonly colorPickerOverlay: ColorPickerOverlay;
  private readonly exportMenuOverlay: ExportMenuOverlay;
  /** The tab row's "+" menu (`NewTabMenu`): a second menu overlay of its own, so the two menus never close each other. */
  private readonly newTabMenuOverlay: ExportMenuOverlay;
  /** Stops listening for marks changing (`canRevertActiveTab`), when the window closes. */
  private readonly stopWatchingMarks: () => void;
  /** The "save this login?" prompt in the page area's top-right corner — see `offerSecret`. */
  private readonly secretPrompt: SecretPromptOverlay;
  private readonly laserPointerOverlay: LaserPointerOverlay;
  private readonly findOverlay: FindOverlay;
  /** Unregisters this window from `registry` — call once, when the window closes (see `dispose`). */
  private readonly unregisterFromRegistry: () => void;

  /**
   * @param window The window whose `contentView` hosts each tab's view.
   * @param onStateChange Called with the full state after any change, so
   *   the caller can push it to the renderer over IPC.
   * @param bookmarkStore Persisted bookmark list this window's chrome reads and writes.
   * @param sessionStore Persisted tabs/workspaces this window's chrome
   *   restores from on launch (see `restoreSession`) and keeps up to date
   *   on every change (see `emitState`).
   * @param registry The tabs/workspaces/views every open window shares —
   *   see its own class doc comment. Not scoped to this window at all;
   *   `main/index.ts` constructs exactly one and passes the same instance
   *   to every `TabManager`.
   * @param terminals Every open terminal tab's own pty process — like
   *   `registry`, one shared instance passed to every `TabManager` rather
   *   than each owning its own, since a terminal tab (and the shell
   *   process behind it) can now move between windows the same as a
   *   browser tab can.
   * @param highlighter Every browser tab's highlights, undo/redo stack, and
   *   on-disk persistence — shared the same way `registry`/`terminals` are,
   *   for the same reason (a tab's highlights move with it between
   *   windows). This `TabManager` only owns the per-window on/off toggle;
   *   see `HighlighterController`'s own class doc comment.
   * @param commentController Every browser tab's dropped comments and
   *   on-disk persistence, shared the same way `highlighter` is and for the
   *   same reason. This `TabManager` only owns the per-window on/off toggle;
   *   see `CommentController`'s own class doc comment.
   * @param penController Every browser tab's freehand pen strokes,
   *   undo/redo stack, and on-disk persistence, shared the same way
   *   `highlighter` is and for the same reason. This `TabManager` only owns
   *   the per-window on/off toggle; see `PenController`'s own class doc
   *   comment.
   * @param textBoxController Every browser tab's text boxes and on-disk
   *   persistence, shared the same way `commentController` is. This
   *   `TabManager` only owns the per-window on/off toggle; see
   *   `TextBoxController`'s own class doc comment.
   * @param historyController The browsing history — recording, serving and
   *   clearing it — shared the same way, since a History tab can move
   *   between windows. See `HistoryController`'s own class doc comment.
   * @param bookmarksController Serves the bookmarks to every Bookmarks tab, shared
   *   the same way `historyController` is. See its own class doc comment.
   * @param secretsController Serves the secrets to every Secrets tab, offers to
   *   save a login a page sends, and fills pages in — shared the same way. See
   *   its own class doc comment.
   * @param adBlocker The app-wide ad blocker; asked whether a page's popup
   *   should be dropped.
   */
  public constructor(
    private readonly window: BrowserWindow,
    private readonly onStateChange: (state: BrowserState) => void,
    private readonly bookmarkStore: BookmarkStore,
    private readonly sessionStore: SessionStore,
    private readonly registry: SharedTabRegistry,
    terminals: TerminalManager,
    private readonly highlighter: HighlighterController,
    private readonly commentController: CommentController,
    private readonly penController: PenController,
    private readonly textBoxController: TextBoxController,
    private readonly historyController: HistoryController,
    private readonly bookmarksController: BookmarksController,
    private readonly secretsController: SecretsController,
    private readonly adBlocker: AdBlocker,
    private readonly workspaceImages: WorkspaceImageStore,
  ) {
    this.views = registry.views;
    this.states = registry.states;
    this.workspaces = registry.workspaces;
    this.terminals = terminals;

    // Only seed the default workspace the very first time — every
    // `TabManager` after the first constructs against a `registry` that
    // already has one (and possibly already renamed/recolored by the
    // user), which a second unconditional `.set()` here would silently
    // stomp back to its defaults.
    if (this.workspaces.size === 0) {
      this.workspaces.set(DEFAULT_WORKSPACE_ID, {
        id: DEFAULT_WORKSPACE_ID,
        name: DEFAULT_WORKSPACE_NAME,
        color: WORKSPACE_COLORS[0],
        icon: DEFAULT_WORKSPACE_ICON,
      });
    }
    // A transient default — whatever `main/index.ts` passes as this
    // window's `onReady` (`restoreSession`, or `tearOffTab`'s own
    // `activateTab` callback) always immediately sets this to the
    // correct value before the window is ever shown.
    this.activeWorkspaceId = DEFAULT_WORKSPACE_ID;

    // Every window opens with the sidebars as the last one closed left them.
    const sidebars = sessionStore.getSidebars();
    if (sidebars) {
      this.sidebarVisible = sidebars.workspaces;
      this.toolsSidebarVisible = sidebars.tools;
      this.rightInsetNow = this.targetRightInset();
    }

    nativeTheme.on('updated', this.keepPagesSeeThrough);

    this.unregisterFromRegistry = registry.registerWindow(window, () => {
      // A window mid-close is still registered until its `closed` event.
      if (window.isDestroyed()) {
        return;
      }
      this.onStateChange(this.getState());
      // A tool turned on or off, a tab switched, or a mode picked: the pages on show learn whether a press is the hand's.
      this.syncMountedPagePointerModes();
      // A hidden window (the spare, or a torn-off one mid-drag) has no active
      // tab of its own worth recording — its snapshot would clobber the real one.
      if (window.isVisible()) {
        this.sessionStore.scheduleSave(this.buildSessionSnapshot());
      }
    }, (workspaceId) => this.handleWorkspaceRemoved(workspaceId), () => this.currentTabSelection());

    this.suggestionsOverlay = new SuggestionsOverlay(
      this.window,
      // A row clicked in the overlay's own view only makes sense to
      // whichever chrome renderer synced the list it's an index into — the
      // chrome window's own webContents, same target `requestFocusAddressBar`
      // and friends already push to.
      (index) => this.window.webContents.send(IpcChannel.AddressSuggestionsSelect, index),
    );
    this.tooltipOverlay = new TooltipOverlay(this.window);
    this.colorPickerOverlay = new ColorPickerOverlay(
      this.window,
      (payload) => this.window.webContents.send(IpcChannel.ColorPickerColorChanged, payload),
      () => this.window.webContents.send(IpcChannel.ColorPickerCloseRequested),
    );
    this.exportMenuOverlay = new ExportMenuOverlay(
      this.window,
      (action) => this.runExportAction(action),
      () => this.window.webContents.send(IpcChannel.ExportMenuCloseRequested),
    );
    this.newTabMenuOverlay = new ExportMenuOverlay(
      this.window,
      (action) => this.runNewTabMenuAction(action),
      () => this.window.webContents.send(IpcChannel.NewTabMenuCloseRequested),
    );
    // A mark added or removed anywhere may change whether Revert has anything to do (`BrowserState.canRevert`).
    this.stopWatchingMarks = onAnnotationsChanged(() => this.emitState());
    this.secretPrompt = new SecretPromptOverlay(this.window, (answer) => this.secretsController.answer(answer));
    this.contentSnapshot = new ContentSnapshot(this.window);
    this.findOverlay = new FindOverlay(this.window, {
      onInput: (query, options) => {
        this.findQuery = query;
        this.findOptions = options;
        this.runFind();
      },
      onStep: (direction) => this.sendFindCommand({ action: 'step', direction }),
      onGoTo: (index) => this.sendFindCommand({ action: 'goto', index }),
      onClose: () => void this.closeFind(),
    });
    ipcMain.on(IpcChannel.FindResult, this.onFindResult);
    this.laserPointerOverlay = new LaserPointerOverlay(
      this.window,
      () => this.exitPointerTools(),
      (wheel) => {
        if (this.activeTabId === null) {
          return;
        }
        // `sendInputEvent`'s wheel deltas use the opposite sign to the DOM's
        // `deltaY` (positive = content moves down, i.e. scroll up).
        this.views.get(this.activeTabId)?.webContents.sendInputEvent({
          type: 'mouseWheel',
          x: Math.round(wheel.x),
          y: Math.round(wheel.y),
          deltaX: -wheel.deltaX,
          deltaY: -wheel.deltaY,
        });
      },
      (point) => this.relayPointerPosition(point),
    );

    // The Ctrl+Space reorder gesture also needs to work when OS keyboard
    // focus is on the chrome itself rather than a tab's own webContents
    // (e.g. right after a mouse drag-and-drop of a tab, or a click on a
    // workspace pill) — every other per-tab shortcut's fallback for that
    // case is a menu accelerator, which this stateful, held-key gesture
    // can't be expressed as (see `handleReorderGestureInput`).
    //
    // Ctrl+` rides along here too, for the reverse direction of
    // `wireSharedInputHandling`'s own Ctrl+`: that one moves focus *out*
    // of a terminal tab into the chrome; this one moves it back *in*,
    // whenever the chrome has OS focus and the active tab happens to be a
    // terminal. Not a menu accelerator for the same reason the reorder
    // gesture isn't — it needs to check the active tab's kind, which a
    // static accelerator can't express.
    this.window.webContents.on('before-input-event', (event, input) => {
      if (this.handleReorderGestureInput(event, input) || this.handleWindowShortcut(event, input)) {
        return;
      }
      // A text box in the chrome (the address bar, a name field) keeps every key it edits with; Escape leaves it.
      if (
        input.type === 'keyDown' &&
        hasEditableFocus(this.window.webContents.id) &&
        isTextEditingChord(input, { codeEditor: false, richText: false })
      ) {
        return;
      }
      if (this.handleTextSensitiveShortcut(event, input)) {
        return;
      }
      if (
        input.type === 'keyDown' &&
        !input.isAutoRepeat &&
        (input.control || input.meta) &&
        !input.alt &&
        !input.shift &&
        input.key.toLowerCase() === '`'
      ) {
        event.preventDefault();
        this.focusActiveTerminal();
      }
    });
  }

  /**
   * Whether this `TabManager` owns a tab with this id — used to resolve a
   * cross-window tab drag's *source* window (main/index.ts's
   * `registerCrossWindowTabMoveIpc`): the window a drop lands in only
   * knows the dragged tab's id, not which window (itself or another one)
   * currently owns it.
   */
  public hasTab(id: string): boolean {
    return this.states.has(id);
  }

  // ── Session restore ──────────────────────────────────────────────────

  /**
   * Recreates whatever tabs/workspaces were open when the app last closed
   * (see `SessionStore`), or opens a single fresh home tab if there's no
   * saved session yet (first launch) or it was empty. Call this once,
   * right after the chrome page itself finishes loading.
   *
   * Each tab is recreated via `createTab`/`createTerminalTab` rather than
   * restored in place — a terminal's actual shell process is long gone by
   * the next launch regardless, and a browser tab's own navigation history
   * was never persisted either (`SessionSnapshot` only keeps its current
   * URL, same as `ClosedTab` does for "reopen last closed tab") — so this
   * is a fresh tab that happens to load the same page, not a resurrection
   * of the old one. Both creators call `activateTab` internally, which
   * would otherwise leave whichever tab was created last active; the
   * explicit `activateTab`/`switchWorkspace` call at the end corrects that
   * to whichever tab/workspace the snapshot actually says was active.
   * @returns The full browser state after restoring (or starting fresh).
   */
  public restoreSession(): BrowserState {
    const snapshot = this.sessionStore.get();
    if (!snapshot || snapshot.tabs.length === 0) {
      return this.createTab();
    }

    this.workspaces.clear();
    for (const workspace of snapshot.workspaces) {
      this.workspaces.set(workspace.id, workspace);
    }
    if (this.workspaces.size === 0) {
      // Every tab below needs a workspace to land in — falls back to the
      // same single default workspace a first launch gets.
      this.workspaces.set(DEFAULT_WORKSPACE_ID, {
        id: DEFAULT_WORKSPACE_ID,
        name: DEFAULT_WORKSPACE_NAME,
        color: WORKSPACE_COLORS[0]!,
        icon: DEFAULT_WORKSPACE_ICON,
      });
    }

    let activeId: string | null = null;
    for (const tab of snapshot.tabs) {
      const workspaceId = this.workspaces.has(tab.workspaceId)
        ? tab.workspaceId
        : (this.workspaces.keys().next().value as string);
      const state =
        tab.kind === 'terminal'
          ? this.createTerminalTab(workspaceId)
          : tab.kind === 'pdf'
            ? this.createPdfTab(workspaceId)
            : tab.kind === 'markdown'
              ? this.createMarkdownTab(workspaceId, tab.url === '' ? undefined : tab.url)
              : tab.kind === 'history'
                ? this.createHistoryTab(workspaceId)
                : tab.kind === 'bookmarks'
                  ? this.createBookmarksTab(workspaceId)
                  : tab.kind === 'secrets'
                    ? this.createSecretsTab(workspaceId)
                    : this.createTab(isNavigableUrl(tab.url) ? tab.url : undefined, workspaceId);
      if (tab.active) {
        activeId = state.activeTabId;
      }
    }

    if (activeId) {
      this.activateTab(activeId);
    } else {
      this.switchWorkspace(snapshot.activeWorkspaceId);
    }

    return this.getState();
  }

  // ── Tabs ─────────────────────────────────────────────────────────────

  /**
   * Whether a workspace already holds `MAX_TABS_PER_WORKSPACE` tabs. A tab
   * shown from several windows (a link group) counts once.
   * @param workspaceId The workspace to check.
   * @param excludingTabId A tab (and its link group) to leave out of the
   *   count — for a tab that's about to move *into* this workspace, so it
   *   (or a sibling already moved) doesn't count against itself.
   */
  private isWorkspaceFull(workspaceId: string, excludingTabId?: string): boolean {
    const keyOf = (tabId: string): string => this.registry.getLinkGroup(tabId)?.[0] ?? tabId;
    const excludedKey = excludingTabId === undefined ? null : keyOf(excludingTabId);
    const keys = new Set<string>();
    for (const [tabId, state] of this.states) {
      if (state.workspaceId === workspaceId && keyOf(tabId) !== excludedKey) {
        keys.add(keyOf(tabId));
      }
    }
    return keys.size >= MAX_TABS_PER_WORKSPACE;
  }

  /**
   * Creates a browser tab's view/state/wiring and starts it loading, without
   * activating (mounting) it anywhere — the shared half of `createTab`
   * (which activates it in this window right after) and `createLinkedTwin`
   * (which deliberately doesn't, so a twin meant for a *different* window
   * never disrupts this one's currently active tab, even for a moment).
   * @param url Address to load; defaults to `DEFAULT_TAB_URL` when omitted.
   * @param workspaceId Workspace the new tab belongs to.
   * @returns The new tab's id.
   */
  private createBrowserTabState(url: string | undefined, workspaceId: string): string {
    const id = randomUUID();
    const view = new WebContentsView({
      webPreferences: {
        // Exposes nothing to the page itself (no `contextBridge` call in
        // it at all) — its only job is applying a main-process-pushed
        // zoom level to this specific view. See `applyZoom`'s own comment
        // for why that has to go through a preload rather than
        // `contents.zoomLevel` set directly from here.
        preload: join(__dirname, '../preload/tabZoom.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        experimentalFeatures: false,
      },
    });

    this.views.set(id, view);
    this.states.set(id, {
      kind: 'browser',
      id,
      title: 'New Tab',
      url: DEFAULT_TAB_URL,
      isLoading: true,
      loadProgress: null,
      loadBytes: null,
      canGoBack: false,
      canGoForward: false,
      favicon: null,
      pointerMode: 'select',
      workspaceId,
    });

    // Rounded to fit just inside the content frame's border (`.tab-content__frame`), whose corners it sits in.
    view.setBorderRadius(CONTENT_FRAME_RADIUS_PX - CONTENT_FRAME_BORDER_PX);
    this.wireEvents(id, view);

    // Every new tab's first load comes through here, so the scheme allowlist `navigate` applies is applied here too:
    // a main-process `loadURL` fires no `will-navigate`, and `file://host/share` would make Windows hand the user's
    // credentials to that host.
    const normalized = normalizeUrlOrSearch(url ?? DEFAULT_TAB_URL);
    const target = isNavigableUrl(normalized) ? normalized : DEFAULT_TAB_URL;
    void view.webContents.loadURL(target).catch(() => {
      // Load failures surface to the UI via the 'did-fail-load' listener
      // wired in wireEvents; the rejection itself carries nothing new.
    });

    return id;
  }

  /**
   * Creates a new tab, loads it, and makes it the active tab.
   * @param url Address to load; defaults to `DEFAULT_TAB_URL` when omitted.
   * @param workspaceId Workspace to create it in; defaults to the active
   *   workspace. Callers that pass this explicitly always do so with the
   *   value already equal to `activeWorkspaceId` (see `switchWorkspace`),
   *   so the newly created tab is always the one about to become visible.
   * @returns The full browser state after the tab is created.
   */
  public createTab(url?: string, workspaceId?: string): BrowserState {
    if (this.isWorkspaceFull(workspaceId ?? this.activeWorkspaceId)) {
      return this.getState();
    }
    const id = this.createBrowserTabState(url, workspaceId ?? this.activeWorkspaceId);
    this.activateTab(id);
    return this.getState();
  }

  /**
   * Creates a new tab exactly like `createTab`, then focuses the address
   * bar — the "New Tab" action a person explicitly asks for (the + button,
   * Ctrl+N) implies they're about to type somewhere, so it should land
   * ready for that. Deliberately separate from `createTab` itself, which
   * is also used internally for tab restoration and closed-tab/workspace
   * fallbacks — cases where stealing focus into the address bar would be
   * surprising rather than helpful.
   * @param url Address to load; defaults to `DEFAULT_TAB_URL` when omitted.
   * @param workspaceId Workspace to create it in; defaults to the active workspace.
   * @returns The full browser state after the tab is created.
   */
  public createTabAndFocusAddressBar(url?: string, workspaceId?: string): BrowserState {
    if (this.isWorkspaceFull(workspaceId ?? this.activeWorkspaceId)) {
      return this.getState();
    }
    const state = this.createTab(url, workspaceId);
    this.focusAddressBarPastTabLoad(state.activeTabId);
    return state;
  }

  /**
   * Opens a new terminal tab (Ctrl+>, the toolbar button, or File > New
   * Terminal) and makes it active. Like `createTab`, it gets its own
   * `WebContentsView` — loading `terminal.html` (its own small bundle,
   * bridged by its own narrower preload, `src/preload/terminal.ts`)
   * instead of an arbitrary URL — so it gets exactly the same native
   * mount/focus handling `activateTab` already gives a browser tab, rather
   * than needing its own special case for either. Focus lands in the
   * terminal itself rather than the address bar — `Terminal.tsx` focuses
   * its own xterm instance as soon as it mounts, so no
   * `focusAddressBarPastTabLoad`-style handoff is needed here.
   *
   * The shell itself isn't spawned until this view's `did-finish-load`
   * fires, deliberately — spawning it any earlier risks the pty's first
   * output (worst case, the shell's very first prompt) arriving before
   * `terminal.html` has loaded and subscribed to it, which `webContents.send`
   * would then simply drop (Electron doesn't queue IPC for a not-yet-
   * listening page). A real shell taking its own OS-level time to spawn
   * and print that first prompt keeps this comfortably ahead of it.
   * @param workspaceId Workspace to create it in; defaults to the active workspace.
   * @returns The full browser state after the tab is created.
   */
  public createTerminalTab(workspaceId?: string): BrowserState {
    if (this.isWorkspaceFull(workspaceId ?? this.activeWorkspaceId)) {
      return this.getState();
    }
    const id = randomUUID();
    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/terminal.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        experimentalFeatures: false,
      },
    });

    // Trusted, app-owned content (unlike a browser tab's arbitrary page) —
    // it should never navigate away from itself or spawn a bare OS window,
    // same reasoning as the chrome window itself (see MainWindow.ts).
    this.makePageSeeThrough(view);
    view.webContents.on('will-navigate', (event) => event.preventDefault());
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.wireSharedInputHandling(id, view.webContents);
    view.webContents.once('did-finish-load', () => {
      // The tab could already have been closed again by the time this
      // fires (e.g. opened then immediately closed) — `states` no longer
      // having it is that signal, and spawning a shell for a tab that's
      // already gone would leak the process.
      if (this.states.has(id)) {
        this.terminals.create(id);
        // Same reasoning as `wireEvents`' `dom-ready` push for a browser
        // tab: `activateTab` (below) fires before this view has loaded
        // anything, so its own push lands before `terminal.html`'s preload
        // has registered a listener and is silently dropped. This is the
        // first point that page is guaranteed ready to receive it.
        this.pushHighlighterStateTo(id);
        this.pushFocusModeTo(id);
      }
    });

    this.views.set(id, view);
    this.states.set(id, {
      kind: 'terminal',
      id,
      title: 'Terminal',
      exited: false,
      workspaceId: workspaceId ?? this.activeWorkspaceId,
    });
    this.activateTab(id);

    const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
    if (!app.isPackaged && devServerUrl) {
      void view.webContents.loadURL(`${devServerUrl}/terminal.html?id=${id}`);
    } else {
      void view.webContents.loadFile(join(__dirname, '../renderer/terminal.html'), { query: { id } });
    }

    return this.getState();
  }

  /**
   * Opens a new PDF viewer tab (the toolbar's PDF button) and makes it
   * active. Structured like `createTerminalTab`: its own `WebContentsView`
   * loading `pdf.html?id=` through its own narrow preload. No file is open
   * at first — the page offers an "Open PDF" button, which comes back
   * through `openPdfFile`. Input handling is the default (browser-tab)
   * shortcut flow: nothing in a PDF page needs raw keys the way a shell does.
   * @param workspaceId Workspace to create it in; defaults to the active workspace.
   * @returns The full browser state after the tab is created.
   */
  public createPdfTab(workspaceId?: string): BrowserState {
    if (this.isWorkspaceFull(workspaceId ?? this.activeWorkspaceId)) {
      return this.getState();
    }
    const id = randomUUID();
    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/pdf.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        experimentalFeatures: false,
      },
    });

    // Trusted, app-owned content — same reasoning as `createTerminalTab`.
    view.webContents.on('will-navigate', (event) => event.preventDefault());
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.makePageSeeThrough(view);
    this.wireSharedInputHandling(id, view.webContents);
    // A fresh document starts at 100%; re-send whatever zoom this tab holds
    // (a restored/torn-off tab may already have one).
    view.webContents.on('did-finish-load', () => {
      this.applyZoom(id);
      // A fresh document has a fresh preload that's never been told which
      // annotation tool (if any) is on — same reason as a browser tab's `dom-ready` push.
      this.pushPenStateTo(id);
      this.pushCommentToolStateTo(id);
      this.pushTextToolStateTo(id);
      this.pushHighlighterStateTo(id);
      this.pushCropStateTo(id);
      this.pushPointerModeTo(id);
      this.pushFocusModeTo(id);
      if (this.findOpen && id === this.activeTabId) {
        this.runFind();
      }
      // An empty PDF page lists the bookmarked files; any that have since been moved or deleted are dropped first.
      void this.refreshPdfBookmarks();
    });

    this.views.set(id, view);
    this.states.set(id, {
      kind: 'pdf',
      id,
      title: 'PDF',
      fileName: null,
      filePath: null,
      page: 1,
      pageCount: 0,
      loadProgress: null,
      loadBytes: null,
      canGoBack: false,
      canGoForward: false,
      pointerMode: 'pan',
      workspaceId: workspaceId ?? this.activeWorkspaceId,
    });
    this.activateTab(id);

    const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
    if (!app.isPackaged && devServerUrl) {
      void view.webContents.loadURL(`${devServerUrl}/pdf.html?id=${id}`);
    } else {
      void view.webContents.loadFile(join(__dirname, '../renderer/pdf.html'), { query: { id } });
    }

    return this.getState();
  }

  // ── Markdown ─────────────────────────────────────────────────────────

  /**
   * Opens a new Markdown tab (the toolbar's MD button, Ctrl+Shift+M, or File >
   * New Markdown Tab) and makes it active. Structured like `createPdfTab`: its
   * own `WebContentsView` loading `markdown.html?id=` through its own narrow
   * preload. No note is open at first — the toolbar offers New and Open and a
   * search over the bookmarked notes — unless `notePath` is given.
   *
   * The page renders untrusted text, so on top of its own sanitizing the
   * page's responses carry a strict content-security-policy (see
   * `buildMarkdownCsp`) — here for the dev server, and as a `<meta>` in the
   * packaged build's HTML.
   * @param workspaceId Workspace to create it in; defaults to the active workspace.
   * @param notePath A note to open in it (a link opened in a new tab, a restored session, a duplicate).
   * @returns The full browser state after the tab is created.
   */
  public createMarkdownTab(workspaceId?: string, notePath?: string): BrowserState {
    if (this.isWorkspaceFull(workspaceId ?? this.activeWorkspaceId)) {
      return this.getState();
    }
    const id = randomUUID();
    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/markdown.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        experimentalFeatures: false,
      },
    });

    view.webContents.on('will-navigate', (event) => event.preventDefault());
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.makePageSeeThrough(view);
    this.wireSharedInputHandling(id, view.webContents);

    const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
    const isDev = !app.isPackaged && devServerUrl !== undefined;
    const pagePrefix = isDev ? `${devServerUrl}/` : 'file://';
    const csp = buildMarkdownCsp(isDev);
    markdownCspRemovers.set(
      id,
      this.adBlocker.addHeadersInterceptor((details) =>
        details.webContentsId === view.webContents.id && details.url.startsWith(pagePrefix)
          ? { responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } }
          : null,
      ),
    );

    view.webContents.on('did-finish-load', () => {
      markdownPagesReady.add(id);
      this.applyZoom(id);
      // A fresh page has a fresh preload that's never been told which annotation tool (if any) is on.
      this.pushPenStateTo(id);
      this.pushCommentToolStateTo(id);
      this.pushHighlighterStateTo(id);
      this.pushMarkdownModeTo(id);
      this.pushMarkdownDisplayTo(id);
      this.pushMarkdownContentWidthTo(id);
      this.pushPointerModeTo(id);
      this.pushFocusModeTo(id);
      // A note opened before the page was up (a restored tab) is delivered now.
      this.pushMarkdownFile(id, 'open', '');
      if (this.findOpen && id === this.activeTabId) {
        this.runFind();
      }
      // An empty Markdown page lists the bookmarked notes; any that have since been moved or deleted are dropped first.
      void this.refreshMarkdownBookmarks();
    });
    // Another program may have saved the note while this tab wasn't looking.
    view.webContents.on('focus', () => void this.refreshMarkdownIfChanged(id));

    this.views.set(id, view);
    this.states.set(id, {
      kind: 'markdown',
      id,
      title: 'Markdown',
      fileName: null,
      filePath: null,
      mode: 'view',
      display: 'formatted',
      contentWidth: 0,
      contentWidthMin: 0,
      loadProgress: null,
      loadBytes: null,
      canGoBack: false,
      canGoForward: false,
      pointerMode: 'select',
      workspaceId: workspaceId ?? this.activeWorkspaceId,
    });
    this.activateTab(id);

    if (isDev) {
      void view.webContents.loadURL(`${devServerUrl}/markdown.html?id=${id}`);
    } else {
      void view.webContents.loadFile(join(__dirname, '../renderer/markdown.html'), { query: { id } });
    }
    if (notePath) {
      void this.loadMarkdownFromPath(id, notePath, 'reset');
    }

    return this.getState();
  }

  /**
   * Lets the user pick a web page saved on the computer and loads it in a web tab — the only way a tab shows a `file:`
   * address (`localPageUrl`), since nothing typed, linked or restored may load one. The page's own pictures, styles and
   * scripts beside it load with it; a link from it to another file on the computer stays refused (`wireEvents`).
   * @param id The web tab. A no-op if it isn't one.
   */
  public async openLocalPage(id: string): Promise<void> {
    if (this.states.get(id)?.kind !== 'browser') {
      return;
    }
    const window = (this.registry.mountOwners.get(id) ?? this).window;
    const { canceled, filePaths } = await dialog.showOpenDialog(window, {
      title: 'Open web page',
      properties: ['openFile'],
      filters: [{ name: 'Web pages', extensions: [...LOCAL_PAGE_EXTENSIONS] }],
    });
    const [filePath] = filePaths;
    if (canceled || !filePath) {
      return;
    }
    const url = localPageUrl(filePath);
    if (url === null) {
      dialog.showErrorBox('Can’t open this page', 'Only a page saved on this computer can be opened, not one on a network share.');
      return;
    }
    const view = this.views.get(id);
    if (!view || view.webContents.isDestroyed()) {
      return;
    }
    void view.webContents.loadURL(url).catch(() => {
      // A failed load shows through `did-fail-load` (see `wireEvents`); the rejection adds nothing.
    });
  }

  /**
   * Lets the user pick a Markdown note from disk for a Markdown tab.
   * Failures are reported in a native error box — this is also reached from a
   * keyboard shortcut that has nowhere else to show them.
   * @param id The Markdown tab. A no-op if it isn't one.
   */
  public async openMarkdownFile(id: string): Promise<void> {
    if (this.states.get(id)?.kind !== 'markdown') {
      return;
    }
    const window = (this.registry.mountOwners.get(id) ?? this).window;
    const { canceled, filePaths } = await dialog.showOpenDialog(window, {
      title: 'Open note',
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    });
    const [filePath] = filePaths;
    if (canceled || !filePath) {
      return;
    }
    await this.loadMarkdownFromPath(id, filePath, 'reset');
  }

  /**
   * Asks where to create a new note, makes the (empty) file, and opens it in
   * the tab ready to be written in. Picking a file that already exists opens
   * it instead — nothing is overwritten.
   * @param id The Markdown tab. A no-op if it isn't one.
   */
  public async newMarkdownFile(id: string): Promise<void> {
    if (this.states.get(id)?.kind !== 'markdown') {
      return;
    }
    const window = (this.registry.mountOwners.get(id) ?? this).window;
    const openPath = markdownDocuments.pathOf(id);
    const { canceled, filePath } = await dialog.showSaveDialog(window, {
      title: 'New note',
      defaultPath: join(openPath ? dirname(openPath) : app.getPath('documents'), 'Untitled.md'),
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    });
    if (canceled || !filePath) {
      return;
    }
    await this.createMarkdownAt(id, isMarkdownPath(filePath) ? filePath : `${filePath}.md`, 'reset');
  }

  /**
   * Creates a note at `path` (or finds it already there) and opens it in edit mode.
   * @param id The Markdown tab.
   * @param path Where the note goes.
   * @param history Whether the tab's Back/Forward start over or this follows from the note it's on.
   */
  private async createMarkdownAt(id: string, path: string, history: 'reset' | 'push'): Promise<void> {
    try {
      const { note, created } = await markdownDocuments.create(id, path, history);
      this.adoptMarkdownNote(id, path, note.name, created ? 'created' : 'open', created ? 'edit' : null, '');
    } catch (error) {
      dialog.showErrorBox('Could not create note', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Reads a note from disk into a Markdown tab. Failures are reported in a
   * native error box, not thrown — see `openMarkdownFile`.
   * @param id The Markdown tab. A no-op if it isn't one.
   * @param path The note to open.
   * @param history `'push'` when it was reached by a link (the note it came from becomes Back).
   * @param anchor A heading to scroll to once drawn, or `''`.
   * @returns Whether it opened.
   */
  private async loadMarkdownFromPath(
    id: string,
    path: string,
    history: 'reset' | 'push',
    anchor = '',
  ): Promise<boolean> {
    if (this.states.get(id)?.kind !== 'markdown') {
      return false;
    }
    const load = this.fileLoadOf(id);
    load.begin();
    try {
      const note = await markdownDocuments.open(id, path, history, (fraction, bytesRead, totalBytes) => {
        load.update(fraction * NOTE_READ_SHARE_PERCENT);
        this.setFileLoadBytes(id, bytesRead, totalBytes);
      });
      this.adoptMarkdownNote(id, path, note.name, 'open', history === 'push' ? null : 'view', anchor);
      load.finish();
      return true;
    } catch (error) {
      load.cancel();
      dialog.showErrorBox('Could not open note', error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  /**
   * Makes a tab's state and page match the note `markdownDocuments` now holds
   * for it: its title and file name, its history buttons, the mode, and the
   * note itself sent to the page.
   * @param mode The mode to show it in, or `null` to leave the tab's as it is.
   */
  private adoptMarkdownNote(
    id: string,
    path: string,
    name: string,
    reason: MarkdownFileData['reason'],
    mode: 'view' | 'edit' | null,
    anchor: string,
  ): void {
    const current = this.states.get(id);
    if (current?.kind !== 'markdown') {
      return;
    }
    this.historyController.recordMarkdownAccess(path);
    this.states.set(id, {
      ...current,
      title: this.markdownTabTitle(path),
      fileName: name,
      filePath: path,
      mode: mode ?? current.mode,
      canGoBack: markdownDocuments.canGoBack(id),
      canGoForward: markdownDocuments.canGoForward(id),
    });
    this.releaseUnavailableTools();
    this.emitState();
    this.pushMarkdownModeTo(id);
    this.pushMarkdownFile(id, reason, anchor);
  }

  /** Sends a tab's open note to its page — a no-op until the page has loaded (which then calls this itself) or while no note is open. */
  private pushMarkdownFile(id: string, reason: MarkdownFileData['reason'], anchor: string): void {
    const view = this.views.get(id);
    const path = markdownDocuments.pathOf(id);
    const content = markdownDocuments.contentOf(id);
    const generation = markdownDocuments.generationOf(id);
    if (!view || view.webContents.isDestroyed() || !markdownPagesReady.has(id) || !path || content === undefined || generation === undefined) {
      return;
    }
    view.webContents.send(IpcChannel.MarkdownFile, {
      name: basename(path),
      content,
      annotations: markdownAnnotationStore.get(path),
      generation,
      anchor,
      reason,
      lineEnding: markdownDocuments.lineEndingOf(id) ?? '\n',
    } satisfies MarkdownFileData);
  }

  /** Tells a tab's page whether to show the note formatted or as raw text. */
  private pushMarkdownDisplayTo(id: string): void {
    const state = this.states.get(id);
    const view = this.views.get(id);
    if (state?.kind === 'markdown' && view && !view.webContents.isDestroyed()) {
      view.webContents.send(IpcChannel.MarkdownDisplay, state.display);
    }
  }

  /** Tells a tab's page how wide to draw the formatted note (`MarkdownTabState.contentWidth`). */
  private pushMarkdownContentWidthTo(id: string): void {
    const state = this.states.get(id);
    const view = this.views.get(id);
    if (state?.kind === 'markdown' && view && !view.webContents.isDestroyed()) {
      view.webContents.send(IpcChannel.MarkdownContentWidth, state.contentWidth);
    }
  }

  /**
   * Draws a Markdown tab's formatted note this wide — the toolbar's width slider. Kept through opening other notes in
   * the tab, as its zoom is.
   * @param id The Markdown tab. A no-op if it isn't one.
   * @param percent The width, as a percent of the page's width; anything under the note's usual column is that column.
   */
  public setMarkdownContentWidth(id: string, percent: number): void {
    const current = this.states.get(id);
    const contentWidth = Math.round(Math.min(100, Math.max(0, percent)));
    if (current?.kind !== 'markdown' || current.contentWidth === contentWidth) {
      return;
    }
    this.states.set(id, { ...current, contentWidth });
    this.pushMarkdownContentWidthTo(id);
    this.emitState();
  }

  /**
   * Takes a Markdown tab's page's measure of its note's usual column, as a percent of the page's width: the toolbar's
   * width slider starts there.
   * @param id The Markdown tab. A no-op if it isn't one.
   * @param percent The column's width, as a percent of the page's.
   */
  public setMarkdownContentWidthMin(id: string, percent: number): void {
    const current = this.states.get(id);
    const contentWidthMin = Math.round(Math.min(100, Math.max(0, percent)));
    if (current?.kind !== 'markdown' || current.contentWidthMin === contentWidthMin) {
      return;
    }
    this.states.set(id, { ...current, contentWidthMin });
    this.emitState();
  }

  /** Tells a tab's page whether the note is read-only (view) or editable (edit). */
  private pushMarkdownModeTo(id: string): void {
    const state = this.states.get(id);
    const view = this.views.get(id);
    if (state?.kind === 'markdown' && view && !view.webContents.isDestroyed()) {
      view.webContents.send(IpcChannel.MarkdownMode, state.mode);
    }
  }

  /**
   * Closes a Markdown tab's open note: the tab stays but goes back to empty.
   * The file on disk and its saved marks are untouched.
   * @param id The Markdown tab. A no-op if it isn't one or has no note open.
   */
  public closeMarkdownFile(id: string): void {
    const current = this.states.get(id);
    if (current?.kind !== 'markdown' || !markdownDocuments.has(id)) {
      return;
    }
    markdownDocuments.close(id);
    fileLoads.get(id)?.cancel();
    this.states.set(id, {
      ...current,
      title: 'Markdown',
      fileName: null,
      filePath: null,
      mode: 'view',
      display: 'formatted',
      loadProgress: null,
      loadBytes: null,
      canGoBack: false,
      canGoForward: false,
    });
    this.pushMarkdownModeTo(id);
    this.pushMarkdownDisplayTo(id);
    this.releaseUnavailableTools();
    if (this.findOpen && !this.canFind(this.activeTabId)) {
      this.closeFind();
    }
    this.emitState();
    this.views.get(id)?.webContents.send(IpcChannel.MarkdownClosed);
    // Back to the empty page: re-check the bookmarked notes before it lists them.
    void this.refreshMarkdownBookmarks();
  }

  /**
   * Deletes a Markdown tab's open note: the file goes to the Recycle Bin (where it can still be restored from), its
   * saved marks are dropped, and every tab of this window that had it open goes back to empty. The chrome has
   * already had the user confirm it. A failure is reported in a native error box, like opening one.
   * @param id The Markdown tab. A no-op if it isn't one or has no note open.
   */
  public async deleteMarkdownFile(id: string): Promise<void> {
    const path = this.states.get(id)?.kind === 'markdown' ? markdownDocuments.pathOf(id) : undefined;
    if (!path) {
      return;
    }
    try {
      await shell.trashItem(path);
    } catch (error) {
      dialog.showErrorBox('Could not delete note', error instanceof Error ? error.message : String(error));
      return;
    }
    markdownAnnotationStore.set(path, EMPTY_MARKDOWN_ANNOTATIONS);
    // Links to it no longer resolve, and the names offered for links no longer include it.
    forgetVaultScans();
    for (const [tabId, state] of this.states) {
      const openPath = markdownDocuments.pathOf(tabId);
      if (state.kind === 'markdown' && this.views.has(tabId) && openPath !== undefined && samePath(openPath, path)) {
        this.closeMarkdownFile(tabId);
      }
    }
  }

  /**
   * Deletes a PDF tab's open file: it goes to the Recycle Bin (where it can still be restored from), and every tab of
   * this window that had it open goes back to empty. Its marks are kept: they're filed under the file's contents, which
   * a copy elsewhere may share, and come back with it if it's restored. The chrome has already had the user confirm
   * it. A failure is reported in a native error box, like opening one.
   * @param id The PDF tab. A no-op if it isn't one or has no file open.
   */
  public async deletePdfFile(id: string): Promise<void> {
    const path = this.states.get(id)?.kind === 'pdf' ? pdfFilePaths.get(id) : undefined;
    if (!path) {
      return;
    }
    try {
      await shell.trashItem(path);
    } catch (error) {
      dialog.showErrorBox('Could not delete PDF', error instanceof Error ? error.message : String(error));
      return;
    }
    for (const [tabId, state] of this.states) {
      const openPath = pdfFilePaths.get(tabId);
      if (state.kind === 'pdf' && this.views.has(tabId) && openPath !== undefined && samePath(openPath, path)) {
        this.closePdfFile(tabId);
      }
    }
  }

  /**
   * Renames a Markdown tab's note on disk (in its own folder) and retitles the tab.
   * Its marks and bookmark follow it.
   * @param id The Markdown tab.
   * @param name The new file name, already validated to end in `.md` or `.markdown`.
   * @throws If no note is open, the name has path separators, or the target exists.
   */
  public async renameMarkdownTab(id: string, name: string): Promise<void> {
    const current = this.states.get(id);
    if (current?.kind !== 'markdown' || !markdownDocuments.has(id)) {
      throw new Error('Open a note before renaming it.');
    }
    const { oldPath, newPath } = await markdownDocuments.rename(id, name);
    if (newPath !== oldPath) {
      this.bookmarkStore.renameMarkdown(oldPath, newPath);
      markdownAnnotationStore.move(oldPath, newPath);
      this.bookmarksChanged();
    }
    this.states.set(id, { ...current, title: this.markdownTabTitle(newPath), fileName: name, filePath: newPath });
    this.emitState();
  }

  /**
   * Switches a Markdown tab between its rendered view and its source editor.
   * Marking tools only work on the rendered note, so any that's on turns off.
   * @param id The Markdown tab. A no-op if it isn't one or has no note open.
   */
  public setMarkdownMode(id: string, mode: 'view' | 'edit'): void {
    const current = this.states.get(id);
    if (current?.kind !== 'markdown' || current.fileName === null || current.mode === mode) {
      return;
    }
    this.states.set(id, { ...current, mode });
    this.pushMarkdownModeTo(id);
    this.giveKeyboardToMarkdownEditor(id);
    this.releaseUnavailableTools();
    this.emitState();
  }

  /**
   * Switches a Markdown tab between its formatted note and its raw text.
   * Marking tools only work on the formatted, read-only note, so any that's on
   * turns off when leaving it.
   * @param id The Markdown tab. A no-op if it isn't one or has no note open.
   * @param display The new display.
   */
  public setMarkdownDisplay(id: string, display: MarkdownDisplay): void {
    const current = this.states.get(id);
    if (current?.kind !== 'markdown' || current.fileName === null || current.display === display) {
      return;
    }
    this.states.set(id, { ...current, display });
    this.pushMarkdownDisplayTo(id);
    this.giveKeyboardToMarkdownEditor(id);
    this.releaseUnavailableTools();
    this.emitState();
  }

  /**
   * Moves the keyboard into a Markdown tab's page when its editor takes the
   * caret. Switching to Edit (or between Raw and Formatted while editing)
   * focuses the editor inside the page, which then draws a caret, but a click
   * on the toolbar or a shortcut pressed in the chrome leaves the window's
   * keyboard in the chrome. Keys would then reach the chrome's shortcuts, which
   * can't see that caret: Ctrl+Left/Right would switch tabs instead of jumping
   * a word.
   * @param id The Markdown tab. A no-op unless it is being edited and is the tab on screen.
   */
  private giveKeyboardToMarkdownEditor(id: string): void {
    const state = this.states.get(id);
    const view = this.views.get(id);
    if (state?.kind !== 'markdown' || state.mode !== 'edit' || id !== this.activeTabId || !view || view.webContents.isDestroyed()) {
      return;
    }
    view.webContents.focus();
  }

  /**
   * Passes a formatting shortcut on to a Markdown tab's editor. Only while the
   * tab is being edited: otherwise the key keeps the app's own meaning.
   * @returns Whether it was handed on — `false` means the caller should do what the key normally does.
   */
  public formatMarkdown(id: string, action: MarkdownFormatAction): boolean {
    const state = this.states.get(id);
    const view = this.views.get(id);
    if (state?.kind !== 'markdown' || state.mode !== 'edit' || !view || view.webContents.isDestroyed()) {
      return false;
    }
    // Only while the editor has the caret: after Shift+Escape (or a click into the chrome) the key is the app's again.
    if (!view.webContents.isFocused() || !hasEditableFocus(view.webContents.id)) {
      return false;
    }
    view.webContents.send(IpcChannel.MarkdownFormat, action);
    return true;
  }

  /**
   * The note editor's block shortcuts, Google Docs style: Ctrl+Alt+0–6 (normal text, headings 1–6), Ctrl+Shift+7/8/9
   * (numbered, bulleted, checklist), and Ctrl+Alt+C/D/H/I (callout, divider, raw HTML, picture). Matched by physical
   * key, since Ctrl+Alt is AltGr on many layouts and Shift turns the digits into symbols. Only taken while a note is
   * being edited and has the caret (`formatMarkdown`); otherwise the key goes on as usual.
   * @param event The input event, so a handled key can `preventDefault`.
   * @param input Electron's parsed key info.
   * @param id The tab the key was pressed in.
   * @returns Whether the key was taken.
   */
  private handleMarkdownFormatShortcut(event: Electron.Event, input: Electron.Input, id: string): boolean {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || this.states.get(id)?.kind !== 'markdown') {
      return false;
    }
    const action = markdownFormatShortcut(input);
    if (action === null) {
      return false;
    }
    if (input.isAutoRepeat) {
      event.preventDefault();
      return true;
    }
    if (!this.formatMarkdown(id, action)) {
      return false;
    }
    event.preventDefault();
    return true;
  }

  /**
   * Runs a formatting command from the Tools sidebar on a Markdown tab's editor. Unlike `formatMarkdown` (a shortcut
   * pressed in the page), the click left the keyboard in the chrome, so the page is given it first; the editor kept
   * its selection, which the command then acts on.
   * @param id The Markdown tab. A no-op unless its note is open and being edited.
   * @param action What to do.
   */
  public applyMarkdownFormat(id: string, action: MarkdownFormatAction): void {
    const state = this.states.get(id);
    const view = this.views.get(id);
    if (state?.kind !== 'markdown' || state.mode !== 'edit' || state.fileName === null || !view || view.webContents.isDestroyed()) {
      return;
    }
    view.webContents.focus();
    view.webContents.send(IpcChannel.MarkdownFormat, action);
  }

  /** Flips a Markdown tab between its rendered view and its source editor (Ctrl+Shift+G). A no-op on any other kind of tab, or with no note open. */
  public toggleMarkdownMode(id: string): void {
    const current = this.states.get(id);
    if (current?.kind === 'markdown') {
      this.setMarkdownMode(id, current.mode === 'edit' ? 'view' : 'edit');
    }
  }

  /**
   * Steps a Markdown tab back or forward through the notes it followed links through.
   * @param id The Markdown tab.
   * @param direction `-1` for Back, `1` for Forward.
   */
  public async navigateMarkdownHistory(id: string, direction: 1 | -1): Promise<void> {
    if (this.states.get(id)?.kind !== 'markdown') {
      return;
    }
    const note = await markdownDocuments.step(id, direction);
    const path = markdownDocuments.pathOf(id);
    if (note && path) {
      this.adoptMarkdownNote(id, path, note.name, 'open', null, '');
    }
  }

  /**
   * Follows a link clicked in a note. A web address opens as a browser tab; a
   * note opens in this tab (or a new Markdown tab); a `[[wikilink]]` to a
   * note that doesn't exist yet creates it beside the current one, as
   * Obsidian does.
   * @param id The Markdown tab the click was in.
   * @param kind `'wiki'` for the text of a `[[wikilink]]`, `'link'` for an ordinary link's address.
   * @param target What the link says.
   * @param newTab Open a note in a new Markdown tab instead of this one.
   */
  public async openMarkdownLink(id: string, kind: 'wiki' | 'link', target: string, newTab: boolean): Promise<void> {
    const current = markdownDocuments.pathOf(id);
    if (this.states.get(id)?.kind !== 'markdown' || !current) {
      return;
    }
    if (kind === 'link' && /^https?:\/\//i.test(target)) {
      if (isNavigableUrl(target)) {
        this.createTab(target);
      }
      return;
    }
    const workspaceId = this.states.get(id)?.workspaceId;
    const heading = kind === 'wiki' ? splitWikiTarget(target).heading : (target.split('#')[1] ?? '');
    let path = kind === 'wiki' ? await resolveWikiTarget(current, target) : await resolveLinkTarget(current, target);
    if (path === null && kind === 'wiki') {
      // The note doesn't exist yet: following the link makes it, next to this one.
      const fileName = toNoteFileName(splitWikiTarget(target).name);
      if (fileName === null) {
        return;
      }
      path = join(dirname(current), fileName);
      if (newTab) {
        this.createMarkdownTab(workspaceId, undefined);
        const created = this.activeTabId;
        if (created) {
          await this.createMarkdownAt(created, path, 'reset');
        }
      } else {
        await this.createMarkdownAt(id, path, 'push');
      }
      return;
    }
    if (path === null || samePath(path, current)) {
      return;
    }
    if (newTab) {
      this.createMarkdownTab(workspaceId, path);
    } else {
      await this.loadMarkdownFromPath(id, path, 'push', heading);
    }
  }

  /** Which `[[wikilinks]]` of the tab's note name a note that exists — see `resolveWikiLinks`. */
  public async resolveMarkdownLinks(id: string, names: readonly string[]): Promise<Record<string, boolean>> {
    const path = markdownDocuments.pathOf(id);
    return path ? resolveWikiLinks(path, names) : {};
  }

  /** The notes that link to the tab's note — see `findBacklinks`. */
  public async markdownBacklinks(id: string): Promise<MarkdownBacklink[]> {
    const path = markdownDocuments.pathOf(id);
    return path ? findBacklinks(path) : [];
  }

  /** The names of the notes in the tab's note's vault — see `listNoteNames`. */
  public async listMarkdownNotes(id: string): Promise<string[]> {
    const path = markdownDocuments.pathOf(id);
    return path ? listNoteNames(path) : [];
  }

  /** An image beside the tab's note as a data URL — see `readImageDataUrl`. */
  public async readMarkdownImage(id: string, src: string): Promise<string | null> {
    const path = markdownDocuments.pathOf(id);
    return path ? readImageDataUrl(path, src, (candidate) => pickedImages().has(candidate)) : null;
  }

  /**
   * The formatted editor's Image button: the user picks a picture from disk, which is remembered as one this note
   * may show (`PickedImageStore`), and the page is given the link to write for it.
   * @param id The Markdown tab.
   * @returns The link (relative to the note where possible), or `null` if nothing was picked.
   */
  public async pickMarkdownImage(id: string): Promise<string | null> {
    const notePath = markdownDocuments.pathOf(id);
    if (this.states.get(id)?.kind !== 'markdown' || !notePath) {
      return null;
    }
    const window = (this.registry.mountOwners.get(id) ?? this).window;
    const { canceled, filePaths } = await dialog.showOpenDialog(window, {
      title: 'Insert a picture',
      defaultPath: dirname(notePath),
      properties: ['openFile'],
      filters: [{ name: 'Pictures', extensions: [...PICKABLE_IMAGE_EXTENSIONS] }],
    });
    const [imagePath] = filePaths;
    if (canceled || !imagePath || !PICKABLE_IMAGE_EXTENSIONS.includes(extname(imagePath).slice(1).toLowerCase())) {
      return null;
    }
    pickedImages().add(imagePath);
    return imageLinkFor(notePath, imagePath);
  }

  /** A web picture the user clicked to load in the tab's note, as a data URL — see `fetchRemoteImageDataUrl`. */
  public async readMarkdownRemoteImage(id: string, url: string): Promise<string | null> {
    return markdownDocuments.pathOf(id) ? fetchRemoteImageDataUrl(url) : null;
  }

  /**
   * Runs one of the tab's note's code blocks. The page names a block by its
   * number; the code that runs is read from the note main holds, never taken
   * from the page. The first run of each block asks the user (native dialog,
   * showing the code), and that exact code is then trusted until the app
   * restarts — a different block, or this one edited, asks again.
   * @param id The Markdown tab.
   * @param index Which code block, counting from 0 in reading order.
   */
  public async runMarkdownCode(id: string, index: number): Promise<MarkdownRunResult> {
    const path = markdownDocuments.pathOf(id);
    const content = markdownDocuments.contentOf(id);
    const refused = (error: string): MarkdownRunResult => ({
      ran: false,
      error,
      stdout: '',
      stderr: '',
      exitCode: null,
      timedOut: false,
      truncated: false,
      durationMs: 0,
    });
    if (this.states.get(id)?.kind !== 'markdown' || !path || content === undefined) {
      return refused('No note is open.');
    }
    const block = listCodeBlocks(content)[index];
    if (!block) {
      return refused('That code block is no longer in the note.');
    }
    if (!isRunnableLanguage(block.language)) {
      return runCodeBlock(block.language, block.code, dirname(path));
    }
    if (markdownRunning.has(id)) {
      return refused('A block from this note is already running.');
    }
    // Trust is for this exact code in this note: another block, or this one
    // after the file changes on disk, asks again rather than riding on an
    // earlier "Run".
    const notePath = process.platform === 'win32' ? path.toLowerCase() : path;
    const trustKey = createHash('sha256').update(`${notePath}\0${block.language}\0${block.code}`).digest('hex');
    if (!markdownTrustedBlocks.has(trustKey)) {
      const window = (this.registry.mountOwners.get(id) ?? this).window;
      const { response } = await dialog.showMessageBox(window, {
        type: 'warning',
        title: 'Run code',
        message: `Run code from “${basename(path)}”?`,
        detail:
          `Code blocks run on your computer with your permissions: they can read and change your files and use the network. ` +
          `Only run code from notes you trust. This block won't ask again until Portalogia restarts, unless its code changes.` +
          `\n\n${codePreview(block.code)}`,
        buttons: ['Run', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (response !== 0) {
        return refused('Canceled.');
      }
      markdownTrustedBlocks.add(trustKey);
    }
    markdownRunning.add(id);
    try {
      return await runCodeBlock(block.language, block.code, dirname(path));
    } finally {
      markdownRunning.delete(id);
    }
  }

  /**
   * Writes the page's edit of the tab's note to disk.
   * @param id The Markdown tab.
   * @param content The note's source as the editor holds it.
   * @param generation Which opening of a note the edit belongs to — an edit made to a note the tab has since left is dropped.
   */
  public saveMarkdown(id: string, content: string, generation: number): void {
    markdownDocuments.save(id, content, generation).catch((error: unknown) => {
      console.error('[markdown] save failed:', error);
      // Said once per tab, not on every keystroke's failed retry.
      if (!markdownSaveErrorShown.has(id)) {
        markdownSaveErrorShown.add(id);
        dialog.showErrorBox('Could not save note', error instanceof Error ? error.message : String(error));
      }
    });
  }

  /** Persists the marks the page drew on the tab's note. */
  public saveMarkdownAnnotations(id: string, annotations: MarkdownAnnotations, generation: number): void {
    const path = markdownDocuments.pathOf(id);
    // Marks made on a note the tab has since left must not land on the one it's showing now.
    if (path && markdownDocuments.generationOf(id) === generation) {
      markdownAnnotationStore.set(path, annotations);
    }
  }

  /** Whether `contents` is the page of Markdown tab `id` — the check that keeps one tab's page from acting as another. */
  public ownsMarkdownContents(id: string, contents: WebContents): boolean {
    return this.states.get(id)?.kind === 'markdown' && this.views.get(id)?.webContents === contents;
  }

  /** Whether `contents` is the page of terminal tab `id` — the check that keeps any other page from typing into its shell. */
  public ownsTerminalContents(id: string, contents: WebContents): boolean {
    return this.states.get(id)?.kind === 'terminal' && this.views.get(id)?.webContents === contents;
  }

  /** Whether `contents` is the page of PDF tab `id`. */
  public ownsPdfContents(id: string, contents: WebContents): boolean {
    return this.states.get(id)?.kind === 'pdf' && this.views.get(id)?.webContents === contents;
  }

  /** The annotation key of the file PDF tab `id` has open, if any — see `pdfFileKeys`. */
  public pdfKeyOf(id: string): string | undefined {
    return pdfFileKeys.get(id);
  }

  /**
   * Re-reads the tab's note if the file changed on disk since this tab last
   * had it, and shows the new version.
   */
  private async refreshMarkdownIfChanged(id: string): Promise<void> {
    if ((await markdownDocuments.refreshIfChanged(id)) !== null) {
      this.pushMarkdownFile(id, 'reload', '');
    }
  }

  /**
   * Saves a copy of a Markdown tab's note — as a PDF (what the page shows,
   * marks included), the `.md` source, or plain text with the Markdown's
   * markers stripped — to a location the user picks. The note itself is left alone.
   * @param id The Markdown tab. A no-op if it isn't one or has no note open.
   * @param format What to save.
   * @returns The path written, or `null` if canceled or there was nothing to export.
   */
  public async exportMarkdown(id: string, format: 'pdf' | 'md' | 'txt'): Promise<string | null> {
    const state = this.states.get(id);
    const view = this.views.get(id);
    const sourcePath = markdownDocuments.pathOf(id);
    const source = markdownDocuments.exportSourceOf(id);
    if (state?.kind !== 'markdown' || !view || !sourcePath || source === undefined) {
      return null;
    }
    const window = (this.registry.mountOwners.get(id) ?? this).window;
    const stem = sanitizeFileName(basename(sourcePath).replace(MARKDOWN_EXTENSION_PATTERN, ''));
    const extension = format === 'md' ? 'md' : format;
    const { canceled, filePath } = await dialog.showSaveDialog(window, {
      title: format === 'pdf' ? 'Export to PDF' : format === 'md' ? 'Export Markdown' : 'Export text',
      defaultPath: join(dirname(sourcePath), format === 'md' ? `${stem} - copy.md` : `${stem}.${extension}`),
      filters: [
        {
          name: format === 'pdf' ? 'PDF Document' : format === 'md' ? 'Markdown' : 'Text',
          extensions: [extension],
        },
      ],
    });
    if (canceled || !filePath) {
      return null;
    }
    try {
      if (format === 'pdf') {
        await view.webContents.executeJavaScript(`window.${MARKDOWN_PRINT_GLOBAL}?.(true);`);
        try {
          await writeFile(filePath, await view.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true }));
        } finally {
          await view.webContents.executeJavaScript(`window.${MARKDOWN_PRINT_GLOBAL}?.(false);`).catch(() => undefined);
        }
      } else if (format === 'md') {
        await writeFile(filePath, source, 'utf-8');
      } else {
        await writeFile(filePath, markdownToPlainText(source), 'utf-8');
      }
      return filePath;
    } catch (error) {
      dialog.showErrorBox('Could not export note', error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  /**
   * Opens, in a Markdown tab, a note the history has seen — picked from the
   * Markdown search's dropdown. Only paths the history already holds are
   * accepted, so this can't be turned into a way to open an arbitrary file.
   * @param id The Markdown tab.
   * @param path The note's path on disk.
   */
  public async openMarkdownFromHistory(id: string, path: string): Promise<void> {
    if (this.states.get(id)?.kind !== 'markdown' || !this.historyController.hasMarkdownAccess(path)) {
      return;
    }
    await this.loadMarkdownFromPath(id, path, 'reset');
  }

  /**
   * Bookmarks a Markdown tab's open note under a name the user chose (the
   * bookmark popup's Save). The tab then goes by that name too.
   * @param id The Markdown tab. A no-op if it isn't one or has no note open.
   * @param name What to call the bookmark.
   * @returns The full browser state after the change.
   */
  public addMarkdownBookmark(id: string, name: string): BrowserState {
    const path = this.states.get(id)?.kind === 'markdown' ? markdownDocuments.pathOf(id) : undefined;
    if (!path) {
      return this.getState();
    }
    this.bookmarkStore.addMarkdown(name, path);
    this.bookmarksChanged();
    this.syncFileTabTitles();
    this.emitState();
    return this.getState();
  }

  /** What a Markdown tab with this note open is titled: its bookmark's name if it has one, else the file's own name. */
  private markdownTabTitle(path: string): string {
    return this.bookmarkStore.findMarkdown(path)?.title ?? basename(path);
  }

  /** Drops every Markdown bookmark whose file no longer exists — run whenever an empty Markdown page loads or comes back (a new tab, a closed note). */
  private async refreshMarkdownBookmarks(): Promise<void> {
    const paths = this.bookmarkStore.listMarkdown().flatMap((bookmark) => (bookmark.path ? [bookmark.path] : []));
    const missing = (
      await Promise.all(paths.map(async (path) => ((await stat(path).then(() => true, () => false)) ? null : path)))
    ).filter((path): path is string => path !== null);
    if (this.bookmarkStore.removeMarkdownPaths(missing)) {
      this.bookmarksChanged();
      this.syncFileTabTitles();
      this.emitState();
    }
  }

  /**
   * Opens a bookmarked note in a Markdown tab. If the file has gone missing
   * since the list was shown, its bookmark is dropped instead.
   * @param id The Markdown tab to open it in.
   * @param bookmarkId The bookmark picked from the toolbar's search.
   */
  public async openMarkdownBookmark(id: string, bookmarkId: string): Promise<void> {
    const bookmark = this.bookmarkStore.listMarkdown().find((candidate) => candidate.id === bookmarkId);
    if (!bookmark?.path || this.states.get(id)?.kind !== 'markdown') {
      return;
    }
    if (!(await stat(bookmark.path).then(() => true, () => false))) {
      this.bookmarkStore.remove(bookmark.id);
      this.bookmarksChanged();
      this.syncFileTabTitles();
      this.emitState();
      return;
    }
    await this.loadMarkdownFromPath(id, bookmark.path, 'reset');
  }

  /**
   * Opens a new History tab (the toolbar's history button, Ctrl+Shift+H, or
   * File > New History Tab) and makes it active. Structured like
   * `createPdfTab`: its own `WebContentsView` loading `history.html?id=`
   * through its own narrow preload, which only carries the history list in
   * and delete/clear requests out. Input handling is the default
   * (browser-tab) shortcut flow.
   * @param workspaceId Workspace to create it in; defaults to the active workspace.
   * @returns The full browser state after the tab is created.
   */
  public createHistoryTab(workspaceId?: string): BrowserState {
    if (this.isWorkspaceFull(workspaceId ?? this.activeWorkspaceId)) {
      return this.getState();
    }
    const id = randomUUID();
    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/history.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        experimentalFeatures: false,
      },
    });

    // Trusted, app-owned content — same reasoning as `createTerminalTab`.
    view.webContents.on('will-navigate', (event) => event.preventDefault());
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.makePageSeeThrough(view);
    this.wireSharedInputHandling(id, view.webContents);
    // A fresh page has never been sent the history or its search text. (It's never zoomed either: see `isZoomable`.)
    view.webContents.on('did-finish-load', () => {
      this.historyController.pushTo(id);
      view.webContents.send(IpcChannel.HistoryQuery, this.historyQueries.get(id) ?? '');
      view.webContents.send(IpcChannel.HistoryRange, this.historyRanges.get(id) ?? { unit: 'all' });
    });

    this.views.set(id, view);
    this.states.set(id, {
      kind: 'history',
      id,
      title: 'History',
      workspaceId: workspaceId ?? this.activeWorkspaceId,
    });
    this.activateTab(id);

    const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
    if (!app.isPackaged && devServerUrl) {
      void view.webContents.loadURL(`${devServerUrl}/history.html?id=${id}`);
    } else {
      void view.webContents.loadFile(join(__dirname, '../renderer/history.html'), { query: { id } });
    }

    return this.getState();
  }

  /**
   * Sets the search text a History tab's table filters by. The box is in the
   * chrome's toolbar and the table in the tab's own page, so it travels
   * through here.
   * @param id The History tab. A no-op if it isn't one.
   * @param query The text to filter by; empty shows everything.
   * @returns The full browser state (unchanged).
   */
  public setHistoryQuery(id: string, query: string): BrowserState {
    if (this.states.get(id)?.kind === 'history') {
      this.historyQueries.set(id, query);
      const view = this.views.get(id);
      if (view && !view.webContents.isDestroyed()) {
        view.webContents.send(IpcChannel.HistoryQuery, query);
      }
    }
    return this.getState();
  }

  /**
   * Sets the time range a History tab's table shows. The toolbar's number and
   * unit say both this and what "Clear History" deletes, so the table always
   * previews what a clear would remove.
   * @param id The History tab. A no-op if it isn't one.
   * @param range The last N of a unit, or all time.
   */
  public setHistoryRange(id: string, range: HistoryClearRange): void {
    if (this.states.get(id)?.kind === 'history') {
      this.historyRanges.set(id, range);
      const view = this.views.get(id);
      if (view && !view.webContents.isDestroyed()) {
        view.webContents.send(IpcChannel.HistoryRange, range);
      }
    }
  }

  /** The most recent distinct pages or PDFs from the history matching a search — see `HistoryController.search`. */
  public searchHistory(type: HistoryEntry['type'], query: string): Promise<HistorySuggestion[]> {
    return this.historyController.search(type, query);
  }

  /**
   * Opens, in a PDF tab, a PDF the history has seen — picked from the PDF
   * search's dropdown. Only paths the history already holds are accepted, so
   * this can't be turned into a way to open an arbitrary file.
   * @param id The PDF tab.
   * @param path The file's path on disk.
   */
  public async openPdfFromHistory(id: string, path: string): Promise<void> {
    if (this.states.get(id)?.kind !== 'pdf' || !this.historyController.hasPdfAccess(path)) {
      return;
    }
    await this.loadPdfFromPath(id, path);
  }

  /**
   * Opens a visit from the History tab in a new tab of its own kind: a page
   * as a browser tab, a PDF in a PDF tab, a note in a Markdown tab. Does
   * nothing for a page whose address isn't one a tab may load, or when the
   * workspace is full (the new tab is then never made, and the open-from-history
   * calls refuse the History tab that stays active).
   * @param entry The visit, as main's own history records it.
   */
  public openHistoryEntryInNewTab(entry: HistoryEntry): void {
    if (entry.type === 'url') {
      if (isNavigableUrl(entry.url)) {
        this.createTab(entry.url);
      }
      return;
    }
    if (entry.type === 'pdf') {
      const { activeTabId } = this.createPdfTab();
      if (activeTabId) {
        void this.openPdfFromHistory(activeTabId, entry.url);
      }
      return;
    }
    const { activeTabId } = this.createMarkdownTab();
    if (activeTabId) {
      void this.openMarkdownFromHistory(activeTabId, entry.url);
    }
  }

  /**
   * Clears the browsing history within a range — the toolbar's "Clear History".
   * @param range The last N of a unit, or everything (already validated).
   * @returns The full browser state (unchanged; open History tabs are re-sent the list).
   */
  /**
   * How many visits a range of the history covers (what "Clear History" would delete), for its confirmation.
   * @param range The last N of a unit, or everything.
   */
  public countHistory(range: HistoryClearRange): number {
    return this.historyController.count(range);
  }

  public clearHistory(range: HistoryClearRange): BrowserState {
    this.historyController.clear(range);
    return this.getState();
  }

  /**
   * Opens a new Bookmarks tab (the toolbar's bookmarks button, or File > New
   * Bookmarks Tab) and makes it active, in view mode. Built like
   * `createHistoryTab`: its own `WebContentsView` loading `bookmarks.html?id=`
   * through its own narrow preload, which carries the bookmark list in and a
   * row's edit, delete or open out.
   * @param workspaceId Workspace to create it in; defaults to the active workspace.
   * @returns The full browser state after the tab is created.
   */
  public createBookmarksTab(workspaceId?: string): BrowserState {
    if (this.isWorkspaceFull(workspaceId ?? this.activeWorkspaceId)) {
      return this.getState();
    }
    const id = randomUUID();
    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/bookmarks.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        experimentalFeatures: false,
      },
    });

    // Trusted, app-owned content — same reasoning as `createTerminalTab`.
    view.webContents.on('will-navigate', (event) => event.preventDefault());
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.makePageSeeThrough(view);
    this.wireSharedInputHandling(id, view.webContents);
    // A fresh page has never been sent the bookmarks, its search text or its mode. (Never zoomed: see `isZoomable`.)
    view.webContents.on('did-finish-load', () => {
      this.bookmarksController.pushTo(id);
      const state = this.states.get(id);
      view.webContents.send(IpcChannel.BookmarksPageQuery, this.bookmarksQueries.get(id) ?? '');
      view.webContents.send(IpcChannel.BookmarksPageMode, state?.kind === 'bookmarks' ? state.mode : 'view');
    });

    this.views.set(id, view);
    this.states.set(id, {
      kind: 'bookmarks',
      id,
      title: 'Bookmarks',
      mode: 'view',
      workspaceId: workspaceId ?? this.activeWorkspaceId,
    });
    this.activateTab(id);

    const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
    if (!app.isPackaged && devServerUrl) {
      void view.webContents.loadURL(`${devServerUrl}/bookmarks.html?id=${id}`);
    } else {
      void view.webContents.loadFile(join(__dirname, '../renderer/bookmarks.html'), { query: { id } });
    }

    return this.getState();
  }

  /**
   * Sets the search text a Bookmarks tab's table filters by — typed in the
   * chrome's toolbar, so it travels through here, as `setHistoryQuery`'s does.
   * @param id The Bookmarks tab. A no-op if it isn't one.
   * @param query The text to filter by; empty shows everything.
   */
  public setBookmarksQuery(id: string, query: string): void {
    if (this.states.get(id)?.kind === 'bookmarks') {
      this.bookmarksQueries.set(id, query);
      const view = this.views.get(id);
      if (view && !view.webContents.isDestroyed()) {
        view.webContents.send(IpcChannel.BookmarksPageQuery, query);
      }
    }
  }

  /**
   * Switches a Bookmarks tab between viewing and editing its table (the
   * toolbar's View/Edit switch). Kept in the tab's state, so the switch shows
   * it and main can refuse a viewed table's edits (`BookmarksController`).
   * @param id The Bookmarks tab. A no-op if it isn't one.
   * @param mode `'view'` or `'edit'`.
   */
  public setBookmarksMode(id: string, mode: 'view' | 'edit'): void {
    const state = this.states.get(id);
    if (state?.kind !== 'bookmarks' || state.mode === mode) {
      return;
    }
    this.states.set(id, { ...state, mode });
    this.emitState();
    const view = this.views.get(id);
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.send(IpcChannel.BookmarksPageMode, mode);
    }
  }

  /**
   * Renames a bookmark and points it somewhere else — a Bookmarks tab's edit.
   * The reference must be of the bookmark's own kind: an address a tab may
   * load for a page, or an existing file with the right extension for a PDF
   * or note (a missing file's bookmark would only be dropped on the next
   * check, `refreshPdfBookmarks`). The store then refuses a name or reference
   * another bookmark already has.
   * @param id The bookmark.
   * @param title Its new name.
   * @param reference Its new URL or path.
   * @returns Whether it was kept, or the field refused and why.
   */
  public async updateBookmark(id: string, title: string, reference: string): Promise<BookmarkUpdateResult> {
    const bookmark = this.bookmarkStore.find(id);
    if (!bookmark) {
      return { ok: false, field: 'title', message: 'That bookmark no longer exists' };
    }
    const target = reference.trim();
    if (bookmark.kind === 'page') {
      if (!isNavigableUrl(target)) {
        return { ok: false, field: 'reference', message: 'Not a web address a tab can open' };
      }
    } else {
      const extensions = bookmark.kind === 'pdf' ? ['.pdf'] : ['.md', '.markdown'];
      if (!isAbsolute(target) || !extensions.includes(extname(target).toLowerCase())) {
        return {
          ok: false,
          field: 'reference',
          message: `Needs a full path to a ${bookmark.kind === 'pdf' ? 'PDF (.pdf)' : 'note (.md or .markdown)'} file`,
        };
      }
      if (!(await stat(target).then((info) => info.isFile(), () => false))) {
        return { ok: false, field: 'reference', message: 'No file at this path' };
      }
    }
    const result = this.bookmarkStore.update(id, title, target);
    if (result.ok) {
      this.bookmarksChanged();
      this.syncFileTabTitles();
      this.emitState();
    }
    return result;
  }

  /**
   * Opens a bookmark from the Bookmarks tab in a new tab of its own kind: a
   * page as a browser tab, a PDF in a PDF tab, a note in a Markdown tab —
   * where main's own record says it points. Does nothing for a page whose
   * address isn't one a tab may load, or when the workspace is full (the
   * Bookmarks tab then stays active, and the open calls refuse it).
   * @param id The bookmark.
   */
  public openBookmarkInNewTab(id: string): void {
    const bookmark = this.bookmarkStore.find(id);
    if (!bookmark) {
      return;
    }
    if (bookmark.kind === 'page') {
      if (isNavigableUrl(bookmark.url)) {
        this.createTab(bookmark.url);
      }
      return;
    }
    if (bookmark.kind === 'pdf') {
      const { activeTabId } = this.createPdfTab();
      if (activeTabId) {
        void this.openPdfBookmark(activeTabId, id);
      }
      return;
    }
    const { activeTabId } = this.createMarkdownTab();
    if (activeTabId) {
      void this.openMarkdownBookmark(activeTabId, id);
    }
  }

  /** Tells every page that lists bookmarks — the History table's Bookmark column, every Bookmarks tab — that they changed. */
  private bookmarksChanged(): void {
    this.historyController.pushBookmarksToAll();
    this.bookmarksController.pushToAll();
  }

  /**
   * Opens a new Secrets tab (the toolbar's lock button, or File > New Secrets
   * Tab) and makes it active, in view mode. Built like `createBookmarksTab`:
   * its own `WebContentsView` loading `secrets.html?id=` through its own
   * narrow preload, which carries the secrets in and a row's edit, delete or
   * copy out.
   * @param workspaceId Workspace to create it in; defaults to the active workspace.
   * @returns The full browser state after the tab is created.
   */
  public createSecretsTab(workspaceId?: string): BrowserState {
    if (this.isWorkspaceFull(workspaceId ?? this.activeWorkspaceId)) {
      return this.getState();
    }
    const id = randomUUID();
    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/secrets.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        experimentalFeatures: false,
      },
    });

    // Trusted, app-owned content — same reasoning as `createTerminalTab`.
    view.webContents.on('will-navigate', (event) => event.preventDefault());
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.makePageSeeThrough(view);
    this.wireSharedInputHandling(id, view.webContents);
    // A fresh page has never been sent the secrets, its search text or its mode. (Never zoomed: see `isZoomable`.)
    view.webContents.on('did-finish-load', () => {
      this.secretsController.pushTo(id);
      const state = this.states.get(id);
      view.webContents.send(IpcChannel.SecretsPageQuery, this.secretsQueries.get(id) ?? '');
      view.webContents.send(IpcChannel.SecretsPageMode, state?.kind === 'secrets' ? state.mode : 'view');
    });

    this.views.set(id, view);
    this.states.set(id, {
      kind: 'secrets',
      id,
      title: 'Secrets',
      mode: 'view',
      workspaceId: workspaceId ?? this.activeWorkspaceId,
    });
    this.activateTab(id);

    const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
    if (!app.isPackaged && devServerUrl) {
      void view.webContents.loadURL(`${devServerUrl}/secrets.html?id=${id}`);
    } else {
      void view.webContents.loadFile(join(__dirname, '../renderer/secrets.html'), { query: { id } });
    }

    return this.getState();
  }

  /**
   * Sets the search text a Secrets tab's table filters by — typed in the
   * chrome's toolbar, so it travels through here, as `setBookmarksQuery`'s does.
   * @param id The Secrets tab. A no-op if it isn't one.
   * @param query The text to filter by; empty shows everything.
   */
  public setSecretsQuery(id: string, query: string): void {
    if (this.states.get(id)?.kind === 'secrets') {
      this.secretsQueries.set(id, query);
      const view = this.views.get(id);
      if (view && !view.webContents.isDestroyed()) {
        view.webContents.send(IpcChannel.SecretsPageQuery, query);
      }
    }
  }

  /**
   * Switches a Secrets tab between viewing and editing its table (the
   * toolbar's View/Edit switch). Kept in the tab's state, so the switch shows
   * it and main can refuse a viewed table's edits (`SecretsController`).
   * @param id The Secrets tab. A no-op if it isn't one.
   * @param mode `'view'` or `'edit'`.
   */
  public setSecretsMode(id: string, mode: 'view' | 'edit'): void {
    const state = this.states.get(id);
    if (state?.kind !== 'secrets' || state.mode === mode) {
      return;
    }
    this.states.set(id, { ...state, mode });
    this.emitState();
    const view = this.views.get(id);
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.send(IpcChannel.SecretsPageMode, mode);
    }
  }

  /**
   * Starts a new, empty row in a Secrets tab's table for a secret typed in by
   * hand (the toolbar's Add button). Adding is a change, so the tab switches
   * to editing first, which is also what lets main keep the row.
   * @param id The Secrets tab. A no-op if it isn't one.
   */
  public addSecretRow(id: string): void {
    if (this.states.get(id)?.kind !== 'secrets') {
      return;
    }
    this.setSecretsMode(id, 'edit');
    const view = this.views.get(id);
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.send(IpcChannel.SecretsPageAddRow);
    }
  }

  /**
   * Puts up the "save this login?" prompt for a tab whose page just sent a
   * login (`SecretsController`). Only over the tab on show: a login sent from
   * a tab in the background (or the other half of a split) is let go, since
   * a prompt over another page would offer the wrong site's secrets.
   * @param tabId The tab the login was typed into.
   * @param offer What to offer saving.
   */
  public offerSecret(tabId: string, offer: SecretPromptOffer): void {
    if (tabId !== this.activeTabId || this.splitView) {
      this.secretsController.discard(offer.id);
      return;
    }
    this.dismissSecretPrompt();
    this.secretPrompt.show(tabId, offer, this.computeMainBounds(this.targetLeftInset(), this.targetTopInset()));
  }

  /** Takes the save prompt down unanswered, letting its login go. */
  private dismissSecretPrompt(): void {
    const offerId = this.secretPrompt.offerId;
    if (offerId) {
      this.secretPrompt.clear();
      this.secretsController.discard(offerId);
    }
  }

  /**
   * Lets the user pick a PDF from disk for a PDF tab, sends its bytes to the
   * tab's page, and renames the tab to the file's name. Failures to read the
   * file are reported in a native error box rather than thrown, since this
   * is also reached from a keyboard shortcut that has nowhere else to show them.
   * @param id The PDF tab to open the file in. A no-op if it isn't a PDF tab.
   */
  public async openPdfFile(id: string): Promise<void> {
    const state = this.states.get(id);
    const view = this.views.get(id);
    if (!state || state.kind !== 'pdf' || !view) {
      return;
    }
    const window = (this.registry.mountOwners.get(id) ?? this).window;
    const { canceled, filePaths } = await dialog.showOpenDialog(window, {
      title: 'Open PDF',
      properties: ['openFile'],
      filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
    });
    const [filePath] = filePaths;
    if (canceled || !filePath) {
      return;
    }
    await this.loadPdfFromPath(id, filePath);
  }

  /**
   * Reads a PDF from disk into a PDF tab: sends its bytes to the tab's page,
   * and retitles the tab to the file's name. Failures are reported in a
   * native error box, not thrown — see `openPdfFile`.
   * @param id The PDF tab. A no-op if it isn't one.
   * @param filePath The file to open.
   */
  private async loadPdfFromPath(id: string, filePath: string): Promise<void> {
    const view = this.views.get(id);
    if (this.states.get(id)?.kind !== 'pdf' || !view) {
      return;
    }
    const load = this.fileLoadOf(id);
    load.begin();
    let data: Buffer;
    try {
      // Reading is the first part of the load; the page reports the rest (`setPdfLoadProgress`).
      const read = await readFileCapped(filePath, MAX_PDF_BYTES, (bytesRead, totalBytes) => {
        load.update((Math.min(bytesRead, totalBytes) / Math.max(totalBytes, 1)) * PDF_READ_SHARE_PERCENT);
        this.setFileLoadBytes(id, bytesRead, totalBytes);
      });
      if (read.kind === 'too-large') {
        throw new Error('That PDF is too large to open (limit 512 MB).');
      }
      if (read.kind === 'not-file') {
        throw new Error('That is not a file.');
      }
      data = read.data;
    } catch (error) {
      load.cancel();
      dialog.showErrorBox('Could not open PDF', error instanceof Error ? error.message : String(error));
      return;
    }
    const key = createHash('sha256').update(data).digest('hex');
    pdfFilePaths.set(id, filePath);
    pdfFileKeys.set(id, key);
    this.historyController.recordPdfAccess(filePath);

    const current = this.states.get(id);
    if (current?.kind === 'pdf') {
      this.states.set(id, {
        ...current,
        title: this.pdfTabTitle(filePath),
        fileName: basename(filePath),
        filePath,
      });
      this.emitState();
    }
    if (!view.webContents.isDestroyed()) {
      view.webContents.send(IpcChannel.PdfFile, {
        name: basename(filePath),
        data,
        key,
        annotations: pdfAnnotationStore.get(key),
      } satisfies PdfOpenResult);
      // The grab tool's pointer helper takes a moment to start; have it ready before the first pan ends.
      cursorWarper.prepare();
    } else {
      load.cancel();
    }
  }

  /**
   * Moves the real pointer to a point of a PDF, Markdown or browser tab's
   * page: a pan that reaches one edge of the view carries on from the
   * opposite one (see `CursorWarper`).
   * @param id The tab.
   * @param x The point, in the page's viewport CSS pixels (a web page's already scaled by its own zoom).
   * @param y The point, in the page's viewport CSS pixels (a web page's already scaled by its own zoom).
   */
  public warpTabPointer(id: string, x: number, y: number): void {
    const state = this.states.get(id);
    const kind = state?.kind;
    const view = this.views.get(id);
    if (!isPointerModeKind(kind) || !view || view.webContents.isDestroyed() || this.window.isDestroyed()) {
      return;
    }
    // Only a pan moves the pointer, and only in a tab on screen: a page (or a compromised one) can't otherwise take
    // hold of the user's mouse, or move it from a tab in the background.
    const onScreen = id === this.activeTabId || id === this.splitOtherTabId();
    if (!state || !('pointerMode' in state) || state.pointerMode !== 'pan' || !onScreen) {
      return;
    }
    const bounds = view.getBounds();
    const content = this.window.getContentBounds();
    // A web page's zoom is its frame's own (`tabZoom.ts`), which it has already applied to the point.
    const zoom = kind === 'browser' ? 1 : view.webContents.getZoomFactor();
    // Kept inside the view: the page only ever means a point of itself.
    const inside = (value: number, size: number): number => Math.min(Math.max(value * zoom, 0), Math.max(size - 1, 0));
    const point = {
      x: Math.round(content.x + bounds.x + inside(x, bounds.width)),
      y: Math.round(content.y + bounds.y + inside(y, bounds.height)),
    };
    const physical = process.platform === 'win32' ? screen.dipToScreenPoint(point) : point;
    cursorWarper.moveTo(physical.x, physical.y);
  }

  /**
   * Closes a PDF tab's open file: the tab stays but goes back to empty, as
   * if nothing had been opened. The file on disk and its saved marks are untouched.
   * @param id The PDF tab. A no-op if it isn't one or has no file open.
   */
  public closePdfFile(id: string): void {
    const current = this.states.get(id);
    if (current?.kind !== 'pdf' || !pdfFilePaths.has(id)) {
      return;
    }
    pdfFilePaths.delete(id);
    pdfFileKeys.delete(id);
    pdfBacklinkPaths.delete(id);
    fileLoads.get(id)?.cancel();
    this.states.set(id, {
      ...current,
      title: 'PDF',
      fileName: null,
      filePath: null,
      page: 1,
      pageCount: 0,
      loadProgress: null,
      loadBytes: null,
      canGoBack: false,
      canGoForward: false,
    });
    this.releaseUnavailableTools();
    if (this.findOpen && !this.canFind(this.activeTabId)) {
      this.closeFind();
    }
    this.emitState();
    this.views.get(id)?.webContents.send(IpcChannel.PdfClosed);
    // Back to the empty page: re-check the bookmarked files before it lists them.
    void this.refreshPdfBookmarks();
  }

  /**
   * Saves a copy of a PDF tab's file with its crops, pen strokes and highlights applied, to a
   * location the user picks. The original file is left alone. Failures are
   * shown in a native error box (this is also reached from a toolbar button
   * with nowhere else to show them).
   * @param id The PDF tab. A no-op if it isn't one or has no file open.
   */
  public async exportPdfFile(id: string): Promise<void> {
    const state = this.states.get(id);
    const sourcePath = pdfFilePaths.get(id);
    if (state?.kind !== 'pdf' || !sourcePath) {
      return;
    }
    const window = (this.registry.mountOwners.get(id) ?? this).window;
    const stem = basename(sourcePath).replace(/\.pdf$/i, '');
    const { canceled, filePath } = await dialog.showSaveDialog(window, {
      title: 'Export PDF',
      defaultPath: join(dirname(sourcePath), `${sanitizeFileName(stem)} - exported.pdf`),
      filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) {
      return;
    }
    try {
      const data = await readFile(sourcePath);
      // The key is the hash of the file's bytes, same as `openPdfFile`, so this reads the marks saved for exactly this document.
      const key = createHash('sha256').update(data).digest('hex');
      const exported = await new PdfCropExporter().export(data, pdfAnnotationStore.get(key), getCurrentAccent());
      await writeFile(filePath, exported);
    } catch (error) {
      dialog.showErrorBox('Could not export PDF', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Records which page a PDF tab's viewer reports in view, for the toolbar.
   * @param id The PDF tab. A no-op if it isn't one or nothing changed.
   */
  public setPdfPageInfo(id: string, page: number, pageCount: number): void {
    const current = this.states.get(id);
    if (current?.kind !== 'pdf' || (current.page === page && current.pageCount === pageCount)) {
      return;
    }
    this.states.set(id, { ...current, page, pageCount });
    this.emitState();
  }

  /**
   * Takes a PDF tab's page's word on how far it has got with the file it was sent: the part of the load after reading
   * it from disk. At 100% the load is done.
   * @param id The PDF tab. A no-op if it isn't one.
   * @param percent How far the page has got, 0-100.
   */
  public setPdfLoadProgress(id: string, percent: number): void {
    if (this.states.get(id)?.kind !== 'pdf') {
      return;
    }
    const load = this.fileLoadOf(id);
    load.update(PDF_READ_SHARE_PERCENT + (percent / 100) * (100 - PDF_READ_SHARE_PERCENT));
    if (percent >= 100) {
      load.finish();
    }
  }

  /**
   * A tab's file load, made on first use: it reports into the tab's `loadProgress`.
   * @param id The PDF or Markdown tab.
   */
  private fileLoadOf(id: string): FileLoadProgress {
    let load = fileLoads.get(id);
    if (!load) {
      load = new FileLoadProgress((percent) => this.setFileLoadProgress(id, percent), LOAD_PROGRESS_HOLD_MS);
      fileLoads.set(id, load);
    }
    return load;
  }

  /** Sets a PDF or Markdown tab's `loadProgress`, for its file bar. Its byte count goes when the progress does. */
  private setFileLoadProgress(id: string, loadProgress: number | null): void {
    const current = this.states.get(id);
    if ((current?.kind !== 'pdf' && current?.kind !== 'markdown') || current.loadProgress === loadProgress) {
      return;
    }
    this.states.set(id, { ...current, loadProgress, ...(loadProgress === null ? { loadBytes: null } : {}) });
    if (loadProgress === null) {
      fileLoadByteSteps.delete(id);
    }
    this.emitState();
  }

  /**
   * Sets how much of the file a PDF or Markdown tab is reading has been read, for beside its file bar's percentage.
   * Pushed at most once per whole percent of the file (and at its end), so reading a large one doesn't flood the
   * chrome with a state push per chunk.
   * @param id The tab.
   * @param bytesRead The bytes read so far.
   * @param totalBytes The file's size.
   */
  private setFileLoadBytes(id: string, bytesRead: number, totalBytes: number): void {
    const current = this.states.get(id);
    if (current?.kind !== 'pdf' && current?.kind !== 'markdown') {
      return;
    }
    const loaded = Math.min(bytesRead, totalBytes);
    const step = totalBytes > 0 ? Math.floor((loaded / totalBytes) * 100) : 100;
    if (fileLoadByteSteps.get(id) === step) {
      return;
    }
    fileLoadByteSteps.set(id, step);
    this.states.set(id, { ...current, loadBytes: { loaded, total: totalBytes } });
    this.emitState();
  }

  /**
   * Records whether a PDF tab's jump history can step back and forward (its page keeps the history itself; this is
   * only what the toolbar's arrows show).
   * @param id The PDF tab. A no-op if it isn't one.
   * @param canGoBack Whether there's an earlier place.
   * @param canGoForward Whether there's a later place.
   */
  public setPdfHistory(id: string, canGoBack: boolean, canGoForward: boolean): void {
    const current = this.states.get(id);
    if (current?.kind !== 'pdf' || (current.canGoBack === canGoBack && current.canGoForward === canGoForward)) {
      return;
    }
    this.states.set(id, { ...current, canGoBack, canGoForward });
    this.emitState();
  }

  /**
   * Asks a PDF tab's page to step through its jump history.
   * @param id The PDF tab.
   * @param direction Back (-1) or forward (1).
   */
  private stepPdfHistory(id: string, direction: 1 | -1): void {
    const view = this.views.get(id);
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.send(IpcChannel.PdfHistoryGo, direction);
    }
  }

  /**
   * Asks a PDF tab's viewer to scroll to a page.
   * @param id The PDF tab. A no-op if it isn't one.
   * @param page 1-based; the viewer clamps it to the document.
   */
  public goToPdfPage(id: string, page: number): void {
    if (this.states.get(id)?.kind === 'pdf') {
      this.views.get(id)?.webContents.send(IpcChannel.PdfScrollToPage, page);
    }
  }

  /**
   * Switches what a drag on a PDF, Markdown or browser tab's document does:
   * pan it, or select its text (which is also when its links take clicks).
   * The modes are the pointer's resting state, so picking one turns off
   * whichever tool is on, the same way turning one tool on turns the others off.
   * @param id The tab. A no-op on any other kind, or a PDF or note with no file open.
   * @param mode The new pointer mode.
   */
  public setPointerMode(id: string, mode: PointerMode): void {
    const current = this.states.get(id);
    if (current?.kind !== 'pdf' && current?.kind !== 'markdown' && current?.kind !== 'browser') {
      return;
    }
    if ((current.kind === 'pdf' || current.kind === 'markdown') && current.fileName === null) {
      return;
    }
    this.turnOffPointerTools();
    if (current.pointerMode !== mode) {
      this.states.set(id, { ...current, pointerMode: mode });
      this.pushPointerModeTo(id);
      this.pushFocusModeTo(id);
    }
    if (mode === 'pan') {
      // The grab tool's pointer helper takes a moment to start; have it ready before the first pan reaches an edge.
      cursorWarper.prepare();
    }
    this.emitState();
  }

  /** `setPointerMode` for the active tab — the View menu's entries. */
  public setActivePointerMode(mode: PointerMode): void {
    if (this.activeTabId) {
      this.setPointerMode(this.activeTabId, mode);
    }
  }

  /** Turns off every tool that takes the pointer over: the laser pointer, pen, highlighter, comments, text boxes and crop. */
  private turnOffPointerTools(): void {
    if (this.laserPointerActive) {
      this.setLaserPointer(false);
    }
    if (this.penActive) {
      this.setPen(false);
    }
    if (this.highlighterActive) {
      this.setHighlighter(false);
    }
    if (this.commentToolActive) {
      this.setCommentTool(false);
    }
    if (this.textToolActive) {
      this.setTextTool(false);
    }
    if (this.cropActive) {
      this.setCrop(false);
    }
  }

  /**
   * Records a web page's latest stats (from its own page), and hands them to the chrome if it's this window's
   * active tab — the one the stat bar describes.
   * @param id The browser tab.
   * @param stats What its page counted.
   */
  public setPageStats(id: string, stats: PageStats): void {
    if (this.states.get(id)?.kind !== 'browser') {
      return;
    }
    pageStatsByTab.set(id, stats);
    const owner = this.registry.mountOwners.get(id) ?? this;
    if (owner.activeTabId === id) {
      owner.pushPageStats();
    }
  }

  /**
   * Records what a note's, PDF's or terminal's own stat bar shows (from its page), and hands it to the chrome if it's
   * this window's active tab: in split screen the chrome's bar shows it, the page's own being hidden.
   * @param id The tab.
   * @param items Its bar's items, as text.
   */
  public setStatItems(id: string, items: readonly string[]): void {
    const kind = this.states.get(id)?.kind;
    if (kind !== 'markdown' && kind !== 'pdf' && kind !== 'terminal') {
      return;
    }
    statItemsByTab.set(id, items);
    const owner = this.registry.mountOwners.get(id) ?? this;
    if (owner.activeTabId === id) {
      owner.pushPageStats();
    }
  }

  /**
   * Sends the chrome the active tab's stats: a web page's counts, or a note's, PDF's or terminal's bar items (each
   * `null` before its page has said, or for the other kind of tab).
   */
  private pushPageStats(): void {
    const id = this.activeTabId;
    if (!id || this.window.isDestroyed()) {
      return;
    }
    this.window.webContents.send(IpcChannel.PageStatsChanged, {
      tabId: id,
      stats: pageStatsByTab.get(id) ?? null,
      items: statItemsByTab.get(id) ?? null,
    });
  }

  /**
   * Tells a note, PDF or terminal tab's page whether this window is in Focus Mode, so it hides its stat bar along
   * with the chrome. A web page's stat bar is the chrome's own, which hides by itself.
   * @param id The tab.
   */
  private pushFocusModeTo(id: string): void {
    const kind = this.states.get(id)?.kind;
    const view = this.views.get(id);
    if ((kind === 'pdf' || kind === 'markdown' || kind === 'terminal') && view && !view.webContents.isDestroyed()) {
      view.webContents.send(IpcChannel.TabFocusMode, this.focusMode);
    }
  }

  /** Tells a PDF, Markdown or browser tab's page its pointer mode. */
  private pushPointerModeTo(id: string): void {
    const state = this.states.get(id);
    const view = this.views.get(id);
    if (!view || view.webContents.isDestroyed()) {
      return;
    }
    if (state?.kind === 'pdf') {
      view.webContents.send(IpcChannel.PdfPointerMode, state.pointerMode);
    } else if (state?.kind === 'markdown') {
      view.webContents.send(IpcChannel.MarkdownPointerMode, state.pointerMode);
    } else if (state?.kind === 'browser') {
      this.syncPagePointerMode(id);
    }
  }

  /**
   * Tells a browser tab's page its pointer mode, and whether one of this
   * window's tools has the pointer instead (a press is then the tool's, not
   * the hand's) — only when that has changed since the page was last told.
   * A note and a PDF know their tool from their own pushes; a web page's
   * tools each live in a preload module of their own, so it's told here.
   * @param id The tab, mounted in this window.
   */
  private syncPagePointerMode(id: string): void {
    const state = this.states.get(id);
    const contents = this.views.get(id)?.webContents;
    if (state?.kind !== 'browser' || !contents || contents.isDestroyed()) {
      return;
    }
    const toolActive =
      this.laserPointerActive ||
      this.penActive ||
      this.highlighterActive ||
      this.commentToolActive ||
      this.textToolActive ||
      this.cropActive;
    const message = { mode: state.pointerMode, toolActive };
    const key = JSON.stringify(message);
    if (pagePointerModesSent.get(contents.id) !== key) {
      pagePointerModesSent.set(contents.id, key);
      contents.send(IpcChannel.TabPointerMode, message);
    }
  }

  /** `syncPagePointerMode` for every tab this window shows: the active one and a split view's other half. */
  private syncMountedPagePointerModes(): void {
    for (const id of [this.activeTabId, this.splitOtherTabId()]) {
      if (id) {
        this.syncPagePointerMode(id);
      }
    }
  }

  /**
   * Opens a web link clicked in a PDF tab's document in a new tab. Only
   * http(s) addresses are followed: a document is untrusted, and its other
   * link kinds (`file:`, `javascript:`) aren't for a click to reach.
   * @param id The PDF tab the click came from.
   * @param url The link's address, as the document gives it.
   */
  public openPdfLink(id: string, url: string): void {
    if (this.states.get(id)?.kind === 'pdf' && /^https?:\/\//i.test(url) && isNavigableUrl(url)) {
      this.createTab(url);
    }
  }

  /**
   * The notes that link to a PDF tab's file — see `findBacklinks`. Remembered, so the page can then open one.
   * @param id The PDF tab.
   * @returns The notes, or none if the tab has no file open.
   */
  public async pdfBacklinks(id: string): Promise<MarkdownBacklink[]> {
    const path = pdfFilePaths.get(id);
    if (this.states.get(id)?.kind !== 'pdf' || !path) {
      return [];
    }
    const found = await findBacklinks(path);
    pdfBacklinkPaths.set(
      id,
      found.map((link) => resolve(dirname(path), link.target)),
    );
    return found;
  }

  /**
   * Opens, in a new Markdown tab, a note the PDF tab's last backlink search found. The page names it by the
   * `target` it was given; anything that search didn't return is refused, so the page can't open other files.
   * @param id The PDF tab.
   * @param target The note's path from the PDF's folder.
   */
  public openPdfBacklink(id: string, target: string): void {
    const path = pdfFilePaths.get(id);
    const state = this.states.get(id);
    if (state?.kind !== 'pdf' || !path) {
      return;
    }
    const wanted = resolve(dirname(path), target);
    if ((pdfBacklinkPaths.get(id) ?? []).some((found) => samePath(found, wanted))) {
      this.createMarkdownTab(state.workspaceId, wanted);
    }
  }

  /**
   * Renames a PDF tab's file on disk (in its own folder) and retitles the tab.
   * @param id The PDF tab.
   * @param name The new file name, already validated to end in `.pdf`.
   * @throws If no file is open, the name has path separators, or the target exists.
   */
  public async renamePdfTab(id: string, name: string): Promise<void> {
    const current = this.states.get(id);
    const oldPath = pdfFilePaths.get(id);
    if (current?.kind !== 'pdf' || !oldPath) {
      throw new Error('Open a PDF before renaming it.');
    }
    // A bare file name only: anything else could move the file elsewhere.
    if (basename(name) !== name || name.includes('/') || name.includes('\\')) {
      throw new Error('File name cannot contain a folder path.');
    }
    const newPath = join(dirname(oldPath), name);
    if (newPath !== oldPath) {
      // Windows paths are case-insensitive, so a case-only rename is allowed
      // through; anything else that already exists is never overwritten.
      const caseOnly = newPath.toLowerCase() === oldPath.toLowerCase();
      if (!caseOnly && (await stat(newPath).then(() => true, () => false))) {
        throw new Error('A file with that name already exists.');
      }
      await rename(oldPath, newPath);
      pdfFilePaths.set(id, newPath);
      this.bookmarkStore.renamePdf(oldPath, newPath);
      this.bookmarksChanged();
    }
    this.states.set(id, { ...current, title: this.pdfTabTitle(newPath), fileName: name, filePath: newPath });
    this.emitState();
  }

  /** Forwards a terminal tab's keystroke/paste bytes to its pty. A no-op if `id` isn't a live terminal tab. */
  public sendTerminalInput(id: string, data: string): void {
    this.terminals.write(id, data);
  }

  /** Resizes a terminal tab's pty to match its xterm instance's current grid. A no-op if `id` isn't a live terminal tab. */
  public resizeTerminal(id: string, cols: number, rows: number): void {
    this.terminals.resize(id, cols, rows);
  }

  /** Applies the address bar's latest suggestions-dropdown sync — see `SuggestionsOverlay.sync`. */
  public syncAddressSuggestions(payload: AddressSuggestionsSyncPayload): void {
    this.suggestionsOverlay.sync(payload);
  }

  /** Applies a collapsed-sidebar tooltip's latest hover sync — see `TooltipOverlay.sync`. */
  public syncTooltip(payload: TooltipSyncPayload): void {
    this.tooltipOverlay.sync(payload);
  }

  /** Applies `ColorPicker`'s latest sync — see `ColorPickerOverlay.sync`. */
  public syncColorPicker(payload: ColorPickerSyncPayload): void {
    const activeTabView = this.activeTabId ? (this.views.get(this.activeTabId) ?? null) : null;
    this.colorPickerOverlay.sync(payload, activeTabView);
  }

  /** Applies `ExportMenu`'s latest sync — see `ExportMenuOverlay.sync`. */
  public syncExportMenu(payload: ExportMenuSyncPayload): void {
    const activeTabView = this.activeTabId ? (this.views.get(this.activeTabId) ?? null) : null;
    this.exportMenuOverlay.sync(payload, activeTabView);
  }

  /** Applies the tab row's "+" menu's latest sync (`NewTabMenu`) — the same overlay as the export menu's, its own copy. */
  public syncNewTabMenu(payload: ExportMenuSyncPayload): void {
    const activeTabView = this.activeTabId ? (this.views.get(this.activeTabId) ?? null) : null;
    this.newTabMenuOverlay.sync(payload, activeTabView);
  }

  /**
   * Opens the kind of tab a row of the "+" menu names, in the active workspace (`createTab` and its kin, each held to
   * the workspace's tab limit), then has the chrome close the menu.
   * @param action The row picked; any other menu's row is ignored.
   */
  private runNewTabMenuAction(action: MenuOverlayAction): void {
    if (!isNewTabMenuAction(action)) {
      return;
    }
    this.window.webContents.send(IpcChannel.NewTabMenuCloseRequested);
    switch (action) {
      case 'new-tab':
        this.createTab();
        break;
      case 'new-pdf':
        this.createPdfTab();
        break;
      case 'new-markdown':
        this.createMarkdownTab();
        break;
      case 'new-terminal':
        this.createTerminalTab();
        break;
      case 'new-bookmarks':
        this.createBookmarksTab();
        break;
      case 'new-secrets':
        this.createSecretsTab();
        break;
      case 'new-history':
        this.createHistoryTab();
        break;
    }
  }

  /** Runs a row chosen in the export dropdown against the active tab, then has the chrome close the menu. Failures are logged — the menu is already gone, so there's no UI left to report to. */
  private runExportAction(choice: MenuOverlayAction): void {
    // The "+" menu's rows are its own overlay's to run (`runNewTabMenuAction`).
    if (isNewTabMenuAction(choice)) {
      return;
    }
    const action: ExportMenuAction = choice;
    this.window.webContents.send(IpcChannel.ExportMenuCloseRequested);
    const id = this.activeTabId;
    if (!id) {
      return;
    }
    const run =
      action === 'pdf'
        ? this.exportToPdf(id)
        : action === 'markdown'
          ? this.exportMarkdown(id, 'md')
          : action === 'text'
            ? this.exportMarkdown(id, 'txt')
            : this.exportDocuments(id);
    run.catch((error: unknown) => console.error(`[export] ${action} failed:`, error));
  }

  /**
   * Releases this window's own resources — call this when the window
   * itself closes. Deliberately does *not* touch shared tabs/workspaces or
   * kill any terminal's shell process: those are shared with every other
   * open window now (see `SharedTabRegistry`, and `terminals`'s own class
   * doc comment) and survive this window closing, same as a tab surviving
   * `moveTabToWorkspace` taking it elsewhere. Terminal processes are only
   * ever killed by `closeTab` (that specific tab closing) or
   * `TerminalManager.disposeAll` (the whole app quitting — see
   * `main/index.ts`'s `window-all-closed` handler).
   */
  public dispose(): void {
    this.suggestionsOverlay.dispose();
    this.tooltipOverlay.dispose();
    this.colorPickerOverlay.dispose();
    this.exportMenuOverlay.dispose();
    this.newTabMenuOverlay.dispose();
    this.stopWatchingMarks();
    this.dismissSecretPrompt();
    this.secretPrompt.dispose();
    this.laserPointerOverlay.dispose();
    nativeTheme.removeListener('updated', this.keepPagesSeeThrough);
    this.findOverlay.dispose();
    ipcMain.removeListener(IpcChannel.FindResult, this.onFindResult);
    this.unregisterFromRegistry();
  }

  /**
   * Makes an app-owned page's view see-through (a note, PDF, History or
   * terminal page): its page leaves the margin around its frame unpainted,
   * so the chrome's flowing metal (`MetalBackground`) shows there, as it
   * does around a web page's view. Before the page first paints, the chrome
   * shows through too, never a white frame.
   * @param view The tab's view.
   */
  private makePageSeeThrough(view: WebContentsView): void {
    view.setBackgroundColor('#00000000');
  }

  /**
   * Makes every app-owned page's view see-through again after a light/dark switch: Chromium gives a view the new
   * scheme's own opaque background as the scheme changes, which would flash solid over the metal in the margins
   * while the switch fades. Set again at once and once more as the pages repaint, in case it lands after them.
   */
  private readonly keepPagesSeeThrough = (): void => {
    const apply = (): void => {
      for (const [id, view] of this.views) {
        const kind = this.states.get(id)?.kind;
        if (kind !== 'browser' && !view.webContents.isDestroyed()) {
          this.makePageSeeThrough(view);
        }
      }
    };
    apply();
    setTimeout(apply, 0);
    setTimeout(apply, 100);
  };

  /**
   * Reorders a tab (the tab bar's drag-and-drop) by moving it to just
   * before `beforeId` in tab order. A no-op if `id` doesn't exist, if
   * `beforeId` doesn't exist or belongs to a different workspace than `id`
   * (dragging never moves a tab between workspaces, only reorders within
   * one), or if the two ids are the same. `states` is a `Map`, whose
   * insertion order is what `getState().tabs` iterates in and the tab bar
   * renders — reordering means rebuilding it in the new order rather than
   * mutating any one entry, since a `Map` has no "move to position"
   * primitive of its own.
   * @param id The tab being dragged.
   * @param beforeId The tab it should land before, or `null` to move it to the end of its workspace's tabs.
   * @returns The full browser state after the reorder.
   */
  public moveTab(requestedId: string, requestedBeforeId: string | null): BrowserState {
    // A linked group sits at its canonical member's position (`listedTabIds`),
    // so reordering any member reorders that one.
    const id = this.registry.getLinkGroup(requestedId)?.[0] ?? requestedId;
    const beforeId =
      requestedBeforeId === null ? null : (this.registry.getLinkGroup(requestedBeforeId)?.[0] ?? requestedBeforeId);
    const moving = this.states.get(id);
    if (!moving || id === beforeId) {
      return this.getState();
    }
    if (beforeId !== null) {
      const target = this.states.get(beforeId);
      if (!target || target.workspaceId !== moving.workspaceId) {
        return this.getState();
      }
    }

    // A split pair moves as one, left then right; and a tab dropped between the two lands before the pair instead.
    const movingPair = this.pairContaining(id);
    const moved = movingPair ? [movingPair.primaryTabId, movingPair.secondaryTabId] : [id];
    const targetPair = beforeId === null ? null : this.pairContaining(beforeId);
    const before = targetPair && targetPair !== movingPair ? targetPair.primaryTabId : beforeId;
    if (before !== null && moved.includes(before)) {
      return this.getState();
    }
    const entries = Array.from(this.states.entries()).filter(([tabId]) => !moved.includes(tabId));
    const insertAt = before === null ? entries.length : entries.findIndex(([tabId]) => tabId === before);
    const movedEntries = moved.flatMap((tabId): [string, TabState][] => {
      const state = this.states.get(tabId);
      return state ? [[tabId, state]] : [];
    });
    entries.splice(insertAt === -1 ? entries.length : insertAt, 0, ...movedEntries);

    this.states.clear();
    for (const [tabId, state] of entries) {
      this.states.set(tabId, state);
    }

    this.emitState();
    return this.getState();
  }

  /**
   * Moves a tab into a different workspace (dragging it onto one of
   * `WorkspaceBar`'s pills) — the tab, its view, and its history all
   * survive; only which workspace's row it belongs to changes. A no-op if
   * the tab or workspace doesn't exist, or it's already there.
   *
   * If the moved tab was mounted (the active tab, or either half of split
   * view), it's unmounted first: leaving it on screen would make the tab
   * strip (always filtered to `activeWorkspaceId`) and the visible page
   * disagree about what's actually in the current workspace. Whatever
   * `closeTab` would activate next in its place — the same
   * neighbor-in-this-workspace-else-fresh-tab fallback — becomes active
   * instead, exactly as if the tab had been closed rather than relocated;
   * dragging a tab to another workspace shouldn't also switch you into it.
   * Delegates entirely to the tab's actual owner (`SharedTabRegistry.mountOwners`)
   * if that isn't `this` — a workspace pill can be clicked from *any*
   * window now that workspaces are shared, but only the window actually
   * showing the dragged tab can correctly answer "was this my active tab"
   * and unmount it from the right place.
   * @param id The tab to move.
   * @param workspaceId The workspace to move it into.
   * @returns The full browser state after the move.
   */
  public moveTabToWorkspace(id: string, workspaceId: string, discardEmptyWorkspace = true): BrowserState {
    const state = this.states.get(id);
    if (!state || !this.workspaces.has(workspaceId) || state.workspaceId === workspaceId) {
      return this.getState();
    }
    // A full workspace takes no more tabs: the dragged tab stays where it is.
    if (this.isWorkspaceFull(workspaceId, id)) {
      return this.getState();
    }

    // Every window's view of a linked tab belongs to the same workspace, so
    // relocate the whole group (the guard stops the recursion re-expanding it).
    const group = this.registry.getLinkGroup(id);
    if (group && !relocatingLinkGroup) {
      relocatingLinkGroup = true;
      try {
        for (const memberId of group.filter((memberId) => memberId !== id)) {
          this.moveTabToWorkspace(memberId, workspaceId, discardEmptyWorkspace);
        }
      } finally {
        relocatingLinkGroup = false;
      }
    }

    const owner = this.registry.mountOwners.get(id);
    if (owner && owner !== this) {
      return owner.moveTabToWorkspace(id, workspaceId, discardEmptyWorkspace);
    }

    const oldWorkspaceId = state.workspaceId;
    const view = this.views.get(id);
    this.registry.mountOwners.delete(id);

    // Delete-then-set rather than a plain `set` on the existing key: a
    // `Map` keeps an updated key at its *original* insertion position,
    // which would leave the tab wherever it happened to fall among every
    // workspace's tabs (interleaved by creation order across all of them)
    // instead of at the end of its new row — re-inserting moves it to the
    // end of `states`' own iteration order, which is the end of *every*
    // workspace's filtered tab list, the target one included, since
    // nothing belonging to it was inserted after this point.
    const relocate = (): void => {
      this.states.delete(id);
      this.states.set(id, { ...state, workspaceId });
    };

    if (this.grabbedTabId === id) {
      this.grabbedTabId = null;
    }

    if (this.splitView && this.splitOtherTabId() === id) {
      if (view) {
        this.window.contentView.removeChildView(view);
      }
      this.restoreSplitMargins();
      this.showAllStatBars();
      this.splitView = null;
      relocate();
      this.updateBounds();
      this.emitState();
      return this.getState();
    }

    if (this.splitView && this.activeTabId === id) {
      const secondaryId = this.splitOtherTabId() ?? this.splitView.secondaryTabId;
      this.restoreSplitMargins();
      this.showAllStatBars();
      this.splitView = null;
      if (view) {
        this.window.contentView.removeChildView(view);
      }
      relocate();
      this.activeTabId = null;
      if (this.states.has(secondaryId)) {
        this.activateTab(secondaryId);
      } else {
        this.createTab(undefined, oldWorkspaceId);
      }
      return this.getState();
    }

    const wasActive = this.activeTabId === id;
    relocate();

    if (!wasActive) {
      if (discardEmptyWorkspace) {
        this.discardWorkspaceIfEmpty(oldWorkspaceId);
      }
      this.emitState();
      return this.getState();
    }

    if (view) {
      this.window.contentView.removeChildView(view);
    }
    this.activeTabId = null;

    const remainingInOldWorkspace = Array.from(this.states.entries())
      .filter(([tabId, tabState]) => tabId !== id && tabState.workspaceId === oldWorkspaceId)
      .map(([tabId]) => tabId);
    const next = remainingInOldWorkspace[remainingInOldWorkspace.length - 1];
    if (next) {
      this.activateTab(next);
    } else if (!(discardEmptyWorkspace && this.discardWorkspaceIfEmpty(oldWorkspaceId))) {
      this.createTab(undefined, oldWorkspaceId);
    }
    // Every window's tab list and workspace list may have changed (the moved
    // tab, a deleted workspace) — not just the one that owned the tab.
    this.emitState();

    return this.getState();
  }

  /**
   * Deletes a workspace whose last tab was just *moved out* (not closed —
   * closing a workspace's last tab leaves the workspace with a fresh home
   * tab). Every window showing it falls back to another workspace. Never
   * deletes the only remaining workspace.
   * @returns Whether the workspace was deleted.
   */
  private discardWorkspaceIfEmpty(workspaceId: string): boolean {
    if (this.workspaces.size <= 1 || !this.workspaces.has(workspaceId)) {
      return false;
    }
    if (Array.from(this.states.values()).some((state) => state.workspaceId === workspaceId)) {
      return false;
    }
    this.workspaces.delete(workspaceId);
    this.registry.notifyWorkspaceRemoved(workspaceId);
    return true;
  }

  /** A workspace was deleted by some window: forget it, and if this window was showing it, switch to the first remaining one. */
  private handleWorkspaceRemoved(workspaceId: string): void {
    this.lastActiveTabIdByWorkspace.delete(workspaceId);
    if (this.window.isDestroyed()) {
      return;
    }
    if (this.activeWorkspaceId !== workspaceId) {
      return;
    }
    const fallbackId = this.workspaces.keys().next().value as string | undefined;
    if (!fallbackId) {
      return;
    }
    this.activeWorkspaceId = fallbackId;
    this.activeTabId = null;
    // A hidden window is a torn-off one about to be discarded (see
    // `followCursor`) — don't mount anything in it just to throw it away.
    if (this.window.isVisible() && !this.suppressWorkspaceFallback) {
      this.focusWorkspaceDefaultTab(fallbackId);
    }
  }

  /**
   * Closes a tab. If it was the active tab, activates a neighbor in the
   * same workspace; if none remain there, opens a fresh home tab in that
   * workspace instead of jumping to an unrelated one. If the tab was part
   * of an active split view, the other pane simply takes over full width.
   * @param id The tab to close.
   * @param options.recordClosed Whether a closed browser tab goes into
   *   `closedTabs` for `restoreLastClosedTab` (Ctrl+Shift+T) to find.
   *   Defaults to `true`; `tearOffTab` (main/index.ts) passes `false` — a
   *   torn-off tab isn't gone, just relocated to a new window, so it
   *   shouldn't be resurrectable as a duplicate back in this one.
   * @returns The full browser state after the tab is closed.
   */
  public closeTab(id: string, options: { recordClosed?: boolean } = {}): BrowserState {
    if (!this.states.has(id)) {
      return this.getState();
    }
    // A tab shown from several windows is one tab (see `SharedTabRegistry`'s
    // link groups): closing it closes every window's view of it. Left alone,
    // the surviving views would simply be listed in its place and the tab
    // would reappear the moment it was closed. The other windows pick a
    // fallback only after this close is done, so none lands back on `id`.
    const affected = this.discardOtherLinkedMembers(id);
    const result = this.closeSingleTab(id, options);
    for (const { manager, workspaceId } of affected) {
      manager.recoverActiveTab(workspaceId);
    }
    return affected.length > 0 ? this.getState() : result;
  }

  /**
   * Silently removes every other member of `id`'s link group — state, view,
   * ownership, and per-tab controllers — without activating a fallback.
   * @returns The windows that were showing one of them, to be given a
   *   fallback tab (`recoverActiveTab`) once the caller's own close is done.
   */
  private discardOtherLinkedMembers(id: string): { manager: TabManager; workspaceId: string }[] {
    const affected: { manager: TabManager; workspaceId: string }[] = [];
    for (const memberId of [...(this.registry.getLinkGroup(id) ?? [])]) {
      if (memberId === id) {
        continue;
      }
      const memberState = this.states.get(memberId);
      const showingWindow = this.registry.mountOwners.get(memberId);
      const view = this.views.get(memberId);
      if (view) {
        retireView(view);
        releaseView(view, (showingWindow ?? this).window);
        this.views.delete(memberId);
      }
      this.states.delete(memberId);
      this.registry.mountOwners.delete(memberId);
      this.registry.zoomPercentByTabId.delete(memberId);
      this.highlighter.disposeTab(memberId);
      this.historyQueries.delete(memberId);
      this.historyRanges.delete(memberId);
      this.bookmarksQueries.delete(memberId);
      this.secretsQueries.delete(memberId);
      this.commentController.disposeTab(memberId);
      this.textBoxController.disposeTab(memberId);
      this.penController.disposeTab(memberId);
      this.registry.removeFromLinkGroup(memberId);
      if (showingWindow && memberState && showingWindow !== this && showingWindow.activeTabId === memberId) {
        showingWindow.activeTabId = null;
        affected.push({ manager: showingWindow, workspaceId: memberState.workspaceId });
      }
    }
    return affected;
  }

  /** Gives a window that lost its active tab (see `discardOtherLinkedMembers`) a neighbor in its workspace, or a fresh home tab. */
  private recoverActiveTab(workspaceId: string): void {
    if (this.activeTabId !== null) {
      return;
    }
    const remaining = Array.from(this.states.entries())
      .filter(([, state]) => state.workspaceId === workspaceId)
      .map(([tabId]) => tabId);
    const next = remaining[remaining.length - 1];
    if (next) {
      this.activateTab(next);
    } else {
      this.createTab(undefined, workspaceId);
    }
  }

  /** `closeTab` for exactly one tab id — the original single-tab close, without the link-group handling above. */
  private closeSingleTab(id: string, options: { recordClosed?: boolean } = {}): BrowserState {
    const closedState = this.states.get(id);
    if (!closedState) {
      return this.getState();
    }

    // Delegates to the tab's actual owner first — same reasoning as
    // `moveTabToWorkspace`'s identical check: a tab's own close button
    // renders in every window showing its (now-shared) workspace, not
    // just whichever window happens to have it mounted right now.
    const owner = this.registry.mountOwners.get(id);
    if (owner && owner !== this) {
      return owner.closeTab(id, options);
    }
    this.registry.mountOwners.delete(id);
    this.registry.zoomPercentByTabId.delete(id);
    this.highlighter.disposeTab(id);
    this.historyQueries.delete(id);
    this.historyRanges.delete(id);
    this.bookmarksQueries.delete(id);
    this.secretsQueries.delete(id);
    if (this.secretPrompt.tabId === id) {
      this.dismissSecretPrompt();
    }
    this.commentController.disposeTab(id);
    this.textBoxController.disposeTab(id);
    this.penController.disposeTab(id);
    markdownDocuments.close(id);
    markdownPagesReady.delete(id);
    markdownRunning.delete(id);
    markdownSaveErrorShown.delete(id);
    pageHadKeyboard.delete(id);
    fileLoads.get(id)?.cancel();
    fileLoads.delete(id);
    markdownCspRemovers.get(id)?.();
    markdownCspRemovers.delete(id);
    this.unlinkTab(id);

    if (this.grabbedTabId === id) {
      this.grabbedTabId = null;
    }

    if (closedState.kind === 'terminal') {
      this.terminals.dispose(id);
    } else if (closedState.kind === 'browser' && (options.recordClosed ?? true)) {
      this.closedTabs.push({ url: closedState.url, workspaceId: closedState.workspaceId });
      if (this.closedTabs.length > CLOSED_TAB_HISTORY_LIMIT) {
        this.closedTabs.shift();
      }
    }

    const view = this.views.get(id);
    const closedWorkspaceId = closedState.workspaceId;
    if (view) {
      retireView(view);
    }

    if (this.splitView && this.splitOtherTabId() === id) {
      if (view) {
        releaseView(view, this.window);
      }
      this.views.delete(id);
      this.states.delete(id);
      this.restoreSplitMargins();
      this.showAllStatBars();
      this.splitView = null;
      this.updateBounds();
      this.emitState();
      return this.getState();
    }

    if (this.splitView && this.activeTabId === id) {
      const secondaryId = this.splitOtherTabId() ?? this.splitView.secondaryTabId;
      this.restoreSplitMargins();
      this.showAllStatBars();
      this.splitView = null;
      if (view) {
        releaseView(view, this.window);
      }
      this.views.delete(id);
      this.states.delete(id);
      this.activeTabId = null;
      if (this.states.has(secondaryId)) {
        this.activateTab(secondaryId);
      } else if (closedWorkspaceId) {
        this.createTab(undefined, closedWorkspaceId);
      } else {
        this.createTab();
      }
      return this.getState();
    }

    const remainingIds = Array.from(this.states.keys()).filter((tabId) => tabId !== id);
    const wasActive = this.activeTabId === id;

    if (view) {
      // The active tab's page stays up over the tab shown in its place while that fades in (`closingTab`).
      if (!wasActive) {
        releaseView(view, this.window);
      }
      this.views.delete(id);
    }
    this.states.delete(id);

    if (wasActive) {
      this.activeTabId = null;
      this.closingTab = view ? { id, view } : null;
      const sameWorkspaceRemaining = remainingIds.filter(
        (tabId) => this.states.get(tabId)?.workspaceId === closedWorkspaceId,
      );
      const next = sameWorkspaceRemaining[sameWorkspaceRemaining.length - 1];
      if (next) {
        this.activateTab(next);
      } else if (closedWorkspaceId) {
        this.createTab(undefined, closedWorkspaceId);
      } else {
        this.createTab();
      }
      // Nothing took it over (no tab came up in its place): it goes now.
      if (this.closingTab) {
        releaseView(this.closingTab.view, this.window);
        this.closingTab = null;
      }
    } else {
      this.emitState();
    }

    return this.getState();
  }

  /**
   * Closes every tab in the active workspace (Ctrl+Shift+W), routing each
   * one through `closeTab` so it inherits that method's own closed-tab
   * history and split-view handling. Closing the last of them trips
   * `closeTab`'s own last-tab reset, so this always ends with exactly one
   * fresh home tab in the workspace — the same place you'd land pressing
   * plain Ctrl+W repeatedly. Only closes tabs this window's own tab bar
   * actually lists (see `shouldListTabForThisWindow`) — a linked twin (see
   * `createLinkedTwin`) that this window doesn't own is a different
   * window's tab as far as "close all *my* tabs" is concerned, even though
   * it shares this workspace.
   * @returns The full browser state after the reset.
   */
  public closeAllTabs(): BrowserState {
    const workspaceId = this.activeWorkspaceId;
    const idsToClose = this.listedTabIds(workspaceId);

    for (const id of idsToClose) {
      this.closeTab(id);
    }

    return this.getState();
  }

  /**
   * Picks which actual view this window should show for a requested tab.
   * A `WebContentsView` can only be attached to one window, so when a tab
   * is already live in another window this window gets its own *twin*: a
   * separate view loaded to the same URL (see `SharedTabRegistry`'s link
   * groups) — any number of windows can show the same tab at once, each
   * with its own scroll position, and navigation is kept in sync. Order of
   * preference: a member this window already shows, then one nobody is
   * showing (reusing a twin left behind when a window switched away), then
   * a brand-new twin. A tab nobody else shows, and a terminal (whose
   * process can't be duplicated), is used directly — the latter is
   * relocated here, as before.
   * @param id The tab the user asked for.
   * @returns The tab id whose view to mount in this window.
   */
  private resolveViewForThisWindow(id: string): string {
    const owners = this.registry.mountOwners;
    const group = this.registry.getLinkGroup(id);
    if (group) {
      if (owners.get(id) === this) {
        return id;
      }
      const mine = group.find((memberId) => owners.get(memberId) === this);
      if (mine) {
        return mine;
      }
      if (!owners.has(id)) {
        return id;
      }
      return group.find((memberId) => !owners.has(memberId)) ?? this.createLinkedTwin(id) ?? id;
    }
    const owner = owners.get(id);
    if (owner && owner !== this && this.states.get(id)?.kind === 'browser') {
      return this.createLinkedTwin(id) ?? id;
    }
    return id;
  }

  /**
   * Makes a tab the visible one, swapping it into the window's content
   * view in place of whichever tab was previously active. Also switches
   * the active workspace to whichever one this tab belongs to — so
   * activating a tab found via cross-workspace tab search lands the chrome
   * on a consistent workspace instead of showing a tab no visible pill
   * claims — and always exits split view first: a tab-bar click is treated
   * as "show exactly this tab," never as "keep the other split pane too."
   * Also steals `id` away from whichever *other* window currently has it
   * mounted, if any (`SharedTabRegistry.mountOwners`) — a `WebContentsView`
   * can only ever be attached to one window's `contentView` at a time, so
   * with tabs shared across every open window now, clicking a tab that's
   * currently live in a different window has to relocate it here rather
   * than mount a second copy. That other window falls back to a neighbor
   * exactly as if the tab had been closed on it (`releaseTab`), without
   * actually removing the tab anywhere.
   * @param id The tab to bring to the front.
   * @returns The full browser state after the switch.
   */
  public activateTab(requestedId: string): BrowserState {
    if (!this.states.has(requestedId)) {
      return this.getState();
    }
    const id = this.resolveViewForThisWindow(requestedId);

    // The save prompt belongs to the page it offers a login from: going to another tab lets it go.
    if (this.secretPrompt.tabId !== null && this.secretPrompt.tabId !== id) {
      this.dismissSecretPrompt();
    }

    const owner = this.registry.mountOwners.get(id);
    if (owner && owner !== this) {
      owner.releaseTab(id);
    }

    if (this.splitView && !this.splitClosing && (id === this.splitView.primaryTabId || id === this.splitView.secondaryTabId)) {
      // Either side of a split: it stays split, with this side the active one, shown without the keyboard like any
      // tab just selected.
      this.showWithoutKeyboard(id);
      return this.focusSplitSide(id);
    }
    // A tab of the workspace's split pair, put away while another tab was shown: the split comes back, with this side
    // the active one.
    const pair = this.restoringPair ? null : this.pairContaining(id);
    if (pair && !this.splitView) {
      this.restoringPair = true;
      try {
        this.activateTab(pair.primaryTabId);
        this.enterSplitView(pair.secondaryTabId);
      } finally {
        this.restoringPair = false;
      }
      if (this.activeTabId !== id) {
        this.showWithoutKeyboard(id);
        this.focusSplitSide(id);
      }
      return this.getState();
    }
    if (this.splitView) {
      this.teardownSplitView();
    }

    // The tab being left stays on top for a moment while the new one fades in under it (see `fadeInTab`).
    let leaving: { id: string; view: WebContentsView } | null = null;
    if (this.activeTabId && this.activeTabId !== id) {
      const previous = this.views.get(this.activeTabId);
      if (previous) {
        leaving = { id: this.activeTabId, view: previous };
      }
      this.registry.mountOwners.delete(this.activeTabId);
    }
    if (leaving === null && this.closingTab) {
      // The tab just closed, fading out the same way.
      leaving = this.closingTab;
      this.closingTab = null;
    }

    // Every tab, browser or terminal, has its own `WebContentsView` (see
    // `createTab`/`createTerminalTab`) — mounting it and explicitly asking
    // for native OS keyboard focus is what makes it actually receive
    // keystrokes rather than them going nowhere (or to whatever view last
    // held focus, even after it's been removed above). Explicit rather
    // than relying on mounting alone to grab focus: true the first time a
    // fresh view loads content, but not reliably true for a view that's
    // simply being reattached after being hidden, which is what every tab
    // switch after the first is.
    //
    // Always inserted at index 0 (the bottom of the child-view stack)
    // rather than appended (the default, which would make it the topmost)
    // — `SuggestionsOverlay`'s own view relies on tab views never
    // outranking it so its dropdown can sit above the live page without
    // that page ever needing to be hidden; see its class doc comment.
    const view = this.views.get(id);
    if (view) {
      if (this.leavingTab?.view === view) {
        // Coming straight back to the tab still on its way out: it stays.
        clearTimeout(this.leavingTab.timer);
        this.leavingTab = null;
      }
      this.registry.detachViewFromAllWindows(view);
      this.window.contentView.addChildView(view, 0);
      this.pushFocusModeTo(id);
      view.setBounds(this.computeMainBounds(this.targetLeftInset(), this.targetTopInset()));
      this.showWithoutKeyboard(id);
      this.registry.mountOwners.set(id, this);
    }
    const previousTabId = this.activeTabId;
    this.activeTabId = id;
    if (leaving && view) {
      // An app page's view is see-through around its frame (`makePageSeeThrough`), showing the metal there.
      this.fadeInTab(view, leaving, this.states.get(id)?.kind !== 'browser');
    } else if (leaving) {
      releaseView(leaving.view, this.window);
    }
    // Sized again now it's the active tab: whether the bottom is kept for the web stat bar depends on its kind.
    view?.setBounds(this.computeMainBounds(this.targetLeftInset(), this.targetTopInset()));
    this.pushPageStats();
    // Showing a different tab (a plain click, a shortcut, a fallback after a
    // close) ends a multi-selection; Ctrl/Shift+click never reach here.
    this.selectedTabIds.clear();
    this.releaseUnavailableTools();
    const shown = this.states.get(id);
    if (shown?.kind === 'pdf' && shown.fileName === null) {
      void this.refreshPdfBookmarks();
    }
    if (shown?.kind === 'markdown') {
      if (shown.fileName === null) {
        void this.refreshMarkdownBookmarks();
      } else {
        void this.refreshMarkdownIfChanged(id);
      }
    }
    this.pushHighlighterState();
    this.pushCommentToolState();
    this.pushTextToolState();
    this.pushPenState();
    this.pushCropState();
    this.refreshFindAfterTabChange(previousTabId);

    const workspaceId = this.states.get(id)?.workspaceId;
    if (workspaceId) {
      this.activeWorkspaceId = workspaceId;
      this.lastActiveTabIdByWorkspace.set(workspaceId, id);
    }

    this.emitState();
    return this.getState();
  }

  /**
   * Unmounts a tab from this window if it's currently the one showing it
   * (the active tab, or either half of split view), activating a
   * fallback in its place exactly as `closeTab` would — without removing
   * the tab itself from the shared registry, since it isn't gone, just
   * being taken over by a different window. Called on whichever window's
   * `TabManager` actually owns a tab (`SharedTabRegistry.mountOwners`)
   * right before a *different* window claims it via `activateTab`. A
   * no-op if this window isn't currently displaying `id` anywhere.
   * @param id The tab being taken over by a different window.
   */
  public releaseTab(id: string): void {
    if (this.splitView && this.splitOtherTabId() === id) {
      const view = this.views.get(id);
      if (view) {
        this.window.contentView.removeChildView(view);
      }
      this.registry.mountOwners.delete(id);
      this.restoreSplitMargins();
      this.showAllStatBars();
      this.splitView = null;
      this.updateBounds();
      this.emitState();
      return;
    }

    if (this.splitView && this.activeTabId === id) {
      const secondaryId = this.splitOtherTabId() ?? this.splitView.secondaryTabId;
      const view = this.views.get(id);
      if (view) {
        this.window.contentView.removeChildView(view);
      }
      this.registry.mountOwners.delete(id);
      this.restoreSplitMargins();
      this.showAllStatBars();
      this.splitView = null;
      this.activeTabId = null;
      if (this.states.has(secondaryId)) {
        this.activateTab(secondaryId);
      } else {
        this.createTab(undefined, this.states.get(id)?.workspaceId);
      }
      return;
    }

    if (this.activeTabId !== id) {
      return;
    }

    const view = this.views.get(id);
    if (view) {
      this.window.contentView.removeChildView(view);
    }
    this.registry.mountOwners.delete(id);
    this.activeTabId = null;

    const workspaceId = this.states.get(id)?.workspaceId;
    const remaining = Array.from(this.states.entries())
      .filter(([tabId, tabState]) => tabId !== id && tabState.workspaceId === workspaceId)
      .map(([tabId]) => tabId);
    const next = remaining[remaining.length - 1];
    if (next) {
      this.activateTab(next);
    } else if (workspaceId) {
      this.createTab(undefined, workspaceId);
    } else {
      this.emitState();
    }
  }

  /**
   * Navigates a tab. Re-validates and re-normalizes the URL on this side
   * of the IPC boundary rather than trusting the renderer's normalization.
   * A no-op for a terminal tab — it has a real `WebContentsView` like a
   * browser tab now (see `createTerminalTab`), but navigating it would
   * blow away its `terminal.html` page (and the live xterm instance on
   * it) rather than doing anything meaningful.
   * @param id The tab to navigate.
   * @param url Raw address bar text or a URL.
   * @returns The full browser state (loading flags update asynchronously).
   */
  public navigate(id: string, url: string): BrowserState {
    const view = this.views.get(id);
    if (!view || this.states.get(id)?.kind !== 'browser') {
      return this.getState();
    }

    const target = normalizeUrlOrSearch(url);
    if (!isNavigableUrl(target)) {
      throw new Error(`Refusing to navigate to disallowed URL: ${target}`);
    }

    // Going home from a page: the page fades away (into the home page's colour) first.
    const state = this.states.get(id);
    if (target === HOME_URL && state?.kind === 'browser' && state.url !== HOME_URL) {
      this.fadeToHome(id, view);
      return this.getState();
    }
    void view.webContents.loadURL(target).catch(() => {});
    return this.getState();
  }

  /** The active tab just closed (`closeSingleTab`), still mounted, for the tab shown in its place to fade in under. */
  private closingTab: { id: string; view: WebContentsView } | null = null;

  /** The tab just left, still mounted over the one fading in, and the timer that takes it down (`fadeInTab`). */
  private leavingTab: { id: string; view: WebContentsView; timer: ReturnType<typeof setTimeout> } | null = null;

  /**
   * Fades a newly shown tab in, rather than switching at once; the tab being left stays mounted on top of it until
   * the new one has painted the fade's first frame, then comes down. A view's own opacity can't be animated, so the
   * page itself carries the fade (like `fadeToHome`'s).
   *
   * A web page fades in from the chrome's colour, under a cover that starts opaque and fades away: its view sits
   * inside the chrome's frame, so the cover never reaches past it. An app page's view is see-through around its own
   * frame, where the flowing metal shows: there only what's inside the frame fades in (`APP_PAGE_CONTENT`), from
   * clear, so the metal, the frame and its panel stay as they are, and a page with nothing open doesn't fade at all.
   * @param view The tab being shown, already mounted under the one being left.
   * @param leaving The tab being left.
   * @param seeThrough Whether the tab's view is see-through (an app page), not a web page.
   */
  private fadeInTab(view: WebContentsView, leaving: { id: string; view: WebContentsView }, seeThrough: boolean): void {
    // One left before it, still on its way out, goes now.
    if (this.leavingTab) {
      clearTimeout(this.leavingTab.timer);
      this.unmountLeavingTab(this.leavingTab);
    }
    const unmount = (): void => {
      if (this.leavingTab?.view === leaving.view) {
        this.unmountLeavingTab(this.leavingTab);
        this.leavingTab = null;
      }
    };
    this.leavingTab = { ...leaving, timer: setTimeout(unmount, TAB_FADE_COVER_MS) };
    const wc = view.webContents;
    if (wc.isDestroyed()) {
      return;
    }
    const color = nativeTheme.shouldUseDarkColors ? TAB_FADE_COLOR.dark : TAB_FADE_COLOR.light;
    // Held at its start while the tab being left is still over it, then faded, and taken off the page once done.
    const timing = `${TAB_FADE_MS}ms ease-out ${TAB_FADE_COVER_MS}ms both`;
    const css = seeThrough
      ? `@keyframes portalogia-tab-fade-in { from { opacity: 0; } to { opacity: 1; } } ` +
        `${APP_PAGE_CONTENT} { animation: portalogia-tab-fade-in ${timing}; }`
      : `@keyframes portalogia-tab-fade { from { opacity: 1; } to { opacity: 0; } } ` +
        `html::before { content: ''; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; ` +
        `background: ${color}; animation: portalogia-tab-fade ${timing}; }`;
    wc.insertCSS(css)
      .then((key) => {
        setTimeout(() => {
          if (!wc.isDestroyed()) {
            void wc.removeInsertedCSS(key).catch(() => {});
          }
        }, TAB_FADE_COVER_MS + TAB_FADE_MS + 20);
      })
      // A page that can't take it (it's mid-navigation) is simply shown, once the tab being left comes down.
      .catch(() => {});
  }

  /**
   * Takes down the tab left by a switch, unless it's being shown again by now (the active tab, a half of split view,
   * or claimed by another window).
   * @param leaving The tab left.
   */
  private unmountLeavingTab(leaving: { id: string; view: WebContentsView }): void {
    const showing =
      this.activeTabId === leaving.id ||
      this.splitView?.primaryTabId === leaving.id ||
      this.splitView?.secondaryTabId === leaving.id ||
      this.registry.mountOwners.has(leaving.id);
    if (!showing && !this.window.isDestroyed() && !leaving.view.webContents.isDestroyed()) {
      releaseView(leaving.view, this.window);
    }
  }

  /** Tabs whose page is fading away on the way home (`fadeToHome`), so pressing Home again doesn't restart it. */
  private readonly fadingHome = new Set<string>();

  /**
   * Fades a tab's page away, then loads the home page in its place. A cover over the page fades in to the home page's
   * background, so the home page then appears with no jump.
   * @param id The tab.
   * @param view Its view.
   */
  private fadeToHome(id: string, view: WebContentsView): void {
    if (this.fadingHome.has(id)) {
      return;
    }
    this.fadingHome.add(id);
    const wc = view.webContents;
    const color = nativeTheme.shouldUseDarkColors ? HOME_BACKGROUND.dark : HOME_BACKGROUND.light;
    const go = (): void => {
      this.fadingHome.delete(id);
      if (!wc.isDestroyed()) {
        void wc.loadURL(HOME_URL).catch(() => {});
      }
    };
    wc.insertCSS(
      `@keyframes portalogia-fade-home { from { opacity: 0; } to { opacity: 1; } } ` +
        `html::after { content: ''; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; ` +
        `background: ${color}; animation: portalogia-fade-home ${HOME_FADE_MS}ms ease-in forwards; }`,
    )
      .then(() => setTimeout(go, HOME_FADE_MS))
      // A page that can't take it (it's mid-navigation) just goes home at once.
      .catch(go);
  }

  /** Navigates a tab to the home page — the same destination the toolbar's Home button uses. A no-op for a terminal tab; see `navigate`. */
  public goHome(id: string): BrowserState {
    return this.navigate(id, HOME_URL);
  }

  /** Navigates a tab back one entry in its history, if possible. A no-op for a terminal tab; see `navigate`. */
  public goBack(id: string): BrowserState {
    if (this.states.get(id)?.kind === 'markdown') {
      void this.navigateMarkdownHistory(id, -1);
      return this.getState();
    }
    if (this.states.get(id)?.kind === 'pdf') {
      this.stepPdfHistory(id, -1);
      return this.getState();
    }
    const history = this.states.get(id)?.kind === 'browser' ? this.views.get(id)?.webContents.navigationHistory : undefined;
    if (history?.canGoBack()) {
      history.goBack();
    }
    return this.getState();
  }

  /** Navigates a tab forward one entry in its history, if possible. A no-op for a terminal tab; see `navigate`. */
  public goForward(id: string): BrowserState {
    if (this.states.get(id)?.kind === 'markdown') {
      void this.navigateMarkdownHistory(id, 1);
      return this.getState();
    }
    if (this.states.get(id)?.kind === 'pdf') {
      this.stepPdfHistory(id, 1);
      return this.getState();
    }
    const history = this.states.get(id)?.kind === 'browser' ? this.views.get(id)?.webContents.navigationHistory : undefined;
    if (history?.canGoForward()) {
      history.goForward();
    }
    return this.getState();
  }

  /** Reloads a tab's current page. A no-op for a terminal tab — reloading its `terminal.html` page would kill the live xterm instance on it (its pty survives; a fresh page would just never reattach to it). */
  public reload(id: string): BrowserState {
    if (this.states.get(id)?.kind === 'browser') {
      this.views.get(id)?.webContents.reload();
    }
    return this.getState();
  }

  /** Stops a tab's in-flight navigation. A no-op for a terminal tab; see `navigate`. */
  public stop(id: string): BrowserState {
    if (this.states.get(id)?.kind === 'browser') {
      this.views.get(id)?.webContents.stop();
    }
    return this.getState();
  }

  /**
   * Reopens the most recently closed tab at its last URL — its own
   * navigation history isn't preserved, only where it was. A no-op if
   * nothing has been closed yet (or everything closed has since been
   * pushed out of `CLOSED_TAB_HISTORY_LIMIT`). Recreated in its original
   * workspace, unless that workspace was itself removed since, in which
   * case it falls back to the current one rather than resurrecting a
   * tab nothing can show.
   * @returns The full browser state after the tab is reopened.
   */
  public restoreLastClosedTab(): BrowserState {
    const closed = this.closedTabs[this.closedTabs.length - 1];
    if (!closed) {
      return this.getState();
    }
    const workspaceId = this.workspaces.has(closed.workspaceId)
      ? closed.workspaceId
      : this.activeWorkspaceId;
    // Checked before popping, so a full workspace doesn't swallow the entry.
    if (this.isWorkspaceFull(workspaceId)) {
      return this.getState();
    }
    this.closedTabs.pop();
    return this.createTab(closed.url, workspaceId);
  }

  /**
   * Duplicates a tab (Ctrl+Shift+D) and places the copy immediately to its
   * right within the same workspace, activating it — matching the
   * conventional browser "Duplicate Tab" behavior. A browser tab's copy
   * loads the same URL (not its navigation history — same limitation
   * `restoreLastClosedTab`/`SessionSnapshot` already accept for recreating a
   * tab); a terminal tab's "copy" is a fresh shell session, since a live pty
   * can't itself be duplicated. A no-op if `id` doesn't exist.
   * @param id The tab to duplicate.
   * @returns The full browser state after the duplicate is created.
   */
  public duplicateTab(id: string): BrowserState {
    const state = this.states.get(id);
    if (!state || this.isWorkspaceFull(state.workspaceId)) {
      return this.getState();
    }

    // Captured before creating the new tab, so "the tab right after this
    // one" reflects the workspace's order as it was, not as it becomes once
    // the new tab is appended at the end of it.
    const workspaceTabIds = Array.from(this.states.entries())
      .filter(([, tabState]) => tabState.workspaceId === state.workspaceId)
      .map(([tabId]) => tabId);
    const beforeId = workspaceTabIds[workspaceTabIds.indexOf(id) + 1] ?? null;

    const newState =
      state.kind === 'terminal'
        ? this.createTerminalTab(state.workspaceId)
        : state.kind === 'pdf'
          ? this.createPdfTab(state.workspaceId)
          : state.kind === 'markdown'
            ? this.createMarkdownTab(state.workspaceId, state.filePath ?? undefined)
            : state.kind === 'history'
              ? this.createHistoryTab(state.workspaceId)
              : state.kind === 'bookmarks'
                ? this.createBookmarksTab(state.workspaceId)
                : state.kind === 'secrets'
                  ? this.createSecretsTab(state.workspaceId)
                  : this.createTab(state.url, state.workspaceId);
    if (newState.activeTabId) {
      // `createTab`/`createTerminalTab` both append at the end of the
      // workspace's own tabs and activate it; this repositions it next to
      // the original without touching which tab is active.
      this.moveTab(newState.activeTabId, beforeId);
    }
    return this.getState();
  }

  /**
   * Renders a tab's current page to a PDF, prompting the user for a save
   * location via a native dialog parented to this window. Works for a
   * terminal tab too — `terminal.html` is a real page in its own
   * `WebContentsView` (see `createTerminalTab`) — but not by directly
   * `printToPDF`-ing the live xterm canvas the way a browser tab's own page
   * is: that canvas only ever paints one viewport's worth of rows, so it'd
   * capture whatever single page of scrollback happened to be scrolled to
   * rather than the whole thing. `executeJavaScript` here instead fills
   * `Terminal.tsx`'s hidden `.terminal__print-view` with every row currently
   * in the buffer (see its own `PREPARE_PRINT_GLOBAL` effect) — terminal.css
   * swaps that in for the canvas, and lets the page grow past one viewport's
   * height, only under `printToPDF`'s own `print` media pass, so the result
   * paginates across as many pages as the scrollback actually needs.
   * @param id The tab to export.
   * @returns The path it was saved to, or `null` if the tab is gone or the
   *   user canceled the save dialog.
   */
  public async exportToPdf(id: string): Promise<string | null> {
    const view = this.views.get(id);
    const state = this.states.get(id);
    if (state?.kind === 'markdown') {
      return this.exportMarkdown(id, 'pdf');
    }
    // Mirrors the toolbar's export menu: not offered on a PDF tab (see `exportPdfFile`) or the blank home page.
    if (
      !view ||
      !state ||
      state.kind === 'pdf' ||
      state.kind === 'history' ||
      state.kind === 'bookmarks' ||
      state.kind === 'secrets' ||
      (state.kind === 'browser' && state.url === HOME_URL)
    ) {
      return null;
    }

    const { canceled, filePath } = await dialog.showSaveDialog(this.window, {
      title: 'Export to PDF',
      defaultPath: `${sanitizeFileName(state.title)}.pdf`,
      filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) {
      return null;
    }

    if (state.kind === 'terminal') {
      await view.webContents.executeJavaScript(`window.${TERMINAL_PREPARE_PRINT_GLOBAL}?.();`);
    }

    const pdfData = await view.webContents.printToPDF({});
    await writeFile(filePath, pdfData);
    return filePath;
  }

  /**
   * Saves a browser tab's HTML plus its external CSS and JS into a new
   * folder (named after the page title) inside one the user picks.
   * @returns The folder written, or `null` if the tab is gone, is a
   *   terminal, or the user canceled.
   */
  public async exportDocuments(id: string): Promise<string | null> {
    const view = this.views.get(id);
    const state = this.states.get(id);
    if (!view || !state || state.kind !== 'browser' || state.url === HOME_URL) {
      return null;
    }

    const { canceled, filePaths } = await dialog.showOpenDialog(this.window, {
      title: 'Choose where to save the web documents',
      properties: ['openDirectory', 'createDirectory'],
    });
    const [parentDirectory] = filePaths;
    if (canceled || !parentDirectory) {
      return null;
    }

    const target = join(parentDirectory, sanitizeFileName(state.title));
    await new PageDocumentExporter().export(view.webContents, target);
    return target;
  }

  /**
   * Whether a screen point is over this window's tab strip or workspace
   * sidebar — the two places a dragged-out tab can be dropped back in. Used
   * by the torn-off window (`main/index.ts`'s `followCursor`) to get out of
   * the way, so the OS drag reaches this window's own drop handlers.
   */
  public isOverTabDropRegion(screenX: number, screenY: number): boolean {
    if (this.window.isDestroyed() || !this.window.isVisible() || this.window.isMinimized()) {
      return false;
    }
    const content = this.window.getContentBounds();
    const x = screenX - content.x;
    const y = screenY - content.y;
    if (x < 0 || y < 0 || x >= content.width || y >= content.height) {
      return false;
    }
    return (
      y < TAB_STRIP_HEIGHT_PX ||
      this.dropRegions.some((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height)
    );
  }

  /**
   * Takes a tab's view off this window without activating anything in its
   * place (unlike `releaseTab`, which falls back to a neighbor or a fresh
   * home tab). For a window that's about to be closed while its tab lives
   * on elsewhere — see `main/index.ts`'s `closeTearOffWindow`.
   */
  public unmountTabWithoutFallback(tabId: string): void {
    const view = this.views.get(tabId);
    if (view) {
      this.window.contentView.removeChildView(view);
    }
    if (this.registry.mountOwners.get(tabId) === this) {
      this.registry.mountOwners.delete(tabId);
    }
    if (this.activeTabId === tabId) {
      this.activeTabId = null;
    }
  }

  /** Marks this window as one being dragged around whole (see `suppressWorkspaceFallback`). */
  public setSuppressWorkspaceFallback(suppress: boolean): void {
    this.suppressWorkspaceFallback = suppress;
  }

  /** Whether `tabId` is the only tab this window lists in its workspace — dragging it out then moves the whole window instead of spawning another. */
  public isOnlyTabInItsWorkspace(tabId: string): boolean {
    const workspaceId = this.states.get(tabId)?.workspaceId;
    if (workspaceId === undefined) {
      return false;
    }
    const dragged = this.registry.selectionContainingTab(tabId) ?? [tabId];
    const listed = this.listedTabIds(workspaceId);
    return listed.length === dragged.length && listed.every((listedId) => dragged.includes(listedId));
  }

  /** Records where this window's tab drop targets are (client coordinates) — see `isOverTabDropRegion`. */
  public setDropRegions(rects: readonly { x: number; y: number; width: number; height: number }[]): void {
    this.dropRegions = rects;
  }

  /** @returns The workspace a tab currently belongs to, or `undefined` if it no longer exists. */
  public getTabWorkspaceId(tabId: string): string | undefined {
    return this.states.get(tabId)?.workspaceId;
  }

  // ── Multi-selection ──────────────────────────────────────────────────

  /**
   * The multi-selected tabs, in tab-strip order, active tab included — empty
   * unless two or more of this window's currently listed tabs are selected
   * (entries for tabs that were closed, moved to another workspace, or are
   * no longer listed here are dropped, so the selection can never go stale).
   */
  private currentTabSelection(): string[] {
    if (this.selectedTabIds.size === 0) {
      return [];
    }
    const selected = this.listedTabIds(this.activeWorkspaceId).filter((tabId) => this.selectedTabIds.has(tabId));
    return selected.length >= 2 ? selected : [];
  }

  /**
   * The multi-selected tabs in the order they were selected (`BrowserState.tabSelectionOrder`) — empty unless two or
   * more still are, in this workspace.
   */
  private tabSelectionInOrder(): string[] {
    if (this.selectedTabIds.size < 2) {
      return [];
    }
    const listed = this.listedTabIds(this.activeWorkspaceId);
    const ordered = [...this.selectedTabIds].filter((tabId) => listed.includes(tabId));
    return ordered.length >= 2 ? ordered : [];
  }

  /** The multi-selected workspaces, in sidebar order, active one included — empty unless two or more still exist. */
  private currentWorkspaceSelection(): string[] {
    if (this.selectedWorkspaceIds.size === 0) {
      return [];
    }
    const selected = Array.from(this.workspaces.keys()).filter((id) => this.selectedWorkspaceIds.has(id));
    return selected.length >= 2 ? selected : [];
  }

  /**
   * Ctrl+click on a tab: adds it to (or removes it from) the selection,
   * together with the active tab, and does *not* switch to it. Ctrl+clicking
   * the active tab itself does nothing — it stays selected as long as any
   * selection exists.
   */
  public toggleTabSelection(id: string): BrowserState {
    const listed = this.listedTabIds(this.activeWorkspaceId);
    const active = this.activeTabId;
    if (!active || id === active || !listed.includes(id) || !listed.includes(active)) {
      return this.getState();
    }
    // Kept in the order they were selected: split screen puts the first on the left.
    const selection = new Set(this.tabSelectionInOrder());
    if (selection.size === 0) {
      selection.add(active);
      selection.add(id);
    } else if (selection.has(id)) {
      selection.delete(id);
    } else {
      selection.add(id);
    }
    this.selectedTabIds = selection.size >= 2 ? selection : new Set();
    this.emitState();
    return this.getState();
  }

  /** Shift+click on a tab: selects every tab from the active one to this one, inclusive. */
  public selectTabRange(id: string): BrowserState {
    const listed = this.listedTabIds(this.activeWorkspaceId);
    const from = this.activeTabId ? listed.indexOf(this.activeTabId) : -1;
    const to = listed.indexOf(id);
    if (from === -1 || to === -1) {
      return this.getState();
    }
    // From the active tab outward, so it comes first in the selection's order (split screen's left).
    const range = from <= to ? listed.slice(from, to + 1) : listed.slice(to, from + 1).reverse();
    this.selectedTabIds = range.length >= 2 ? new Set(range) : new Set();
    this.emitState();
    return this.getState();
  }

  /** Ctrl+click on a workspace: adds it to (or removes it from) the selection, with the active one, without switching to it. */
  public toggleWorkspaceSelection(id: string): BrowserState {
    if (!this.workspaces.has(id) || id === this.activeWorkspaceId) {
      return this.getState();
    }
    const selection = new Set(this.currentWorkspaceSelection());
    if (selection.size === 0) {
      selection.add(this.activeWorkspaceId);
      selection.add(id);
    } else if (selection.has(id)) {
      selection.delete(id);
    } else {
      selection.add(id);
    }
    this.selectedWorkspaceIds = selection.size >= 2 ? selection : new Set();
    this.emitState();
    return this.getState();
  }

  /** Shift+click on a workspace: selects every workspace from the active one to this one, inclusive. */
  public selectWorkspaceRange(id: string): BrowserState {
    const order = Array.from(this.workspaces.keys());
    const from = order.indexOf(this.activeWorkspaceId);
    const to = order.indexOf(id);
    if (from === -1 || to === -1) {
      return this.getState();
    }
    const range = order.slice(Math.min(from, to), Math.max(from, to) + 1);
    this.selectedWorkspaceIds = range.length >= 2 ? new Set(range) : new Set();
    this.emitState();
    return this.getState();
  }

  /**
   * Ctrl+W: closes every selected tab if `id` is one of a multi-selection,
   * otherwise just `id`. The active tab goes last, so the fallback it
   * triggers can't land on a tab that's about to close anyway.
   */
  public closeSelectionOrTab(id: string): BrowserState {
    const selection = this.currentTabSelection();
    if (selection.length < 2 || !selection.includes(id)) {
      return this.closeTab(id);
    }
    const active = this.activeTabId;
    const ordered = [...selection.filter((tabId) => tabId !== active), ...selection.filter((tabId) => tabId === active)];
    for (const tabId of ordered) {
      this.closeTab(tabId);
    }
    this.selectedTabIds.clear();
    return this.getState();
  }

  /**
   * Ctrl+Alt+W: removes every selected workspace if there's a multi-selection,
   * otherwise just the active one. The active workspace is removed last (one
   * fallback switch, not several), and `removeWorkspace` itself refuses to
   * remove the last workspace left, so this can never remove them all.
   */
  public removeSelectionOrActiveWorkspace(): BrowserState {
    const selection = this.currentWorkspaceSelection();
    if (selection.length < 2) {
      return this.removeWorkspace(this.activeWorkspaceId);
    }
    for (const id of selection.filter((workspaceId) => workspaceId !== this.activeWorkspaceId)) {
      this.removeWorkspace(id);
    }
    this.removeWorkspace(this.activeWorkspaceId);
    this.selectedWorkspaceIds.clear();
    return this.getState();
  }

  /** Whether moving `tabIds` into `workspaceId` would push it past `MAX_TABS_PER_WORKSPACE` (link groups count once). */
  private wouldExceedTabLimit(workspaceId: string, tabIds: readonly string[]): boolean {
    const keyOf = (tabId: string): string => this.registry.getLinkGroup(tabId)?.[0] ?? tabId;
    const keys = new Set<string>();
    for (const [tabId, state] of this.states) {
      if (state.workspaceId === workspaceId) {
        keys.add(keyOf(tabId));
      }
    }
    for (const tabId of tabIds) {
      keys.add(keyOf(tabId));
    }
    return keys.size > MAX_TABS_PER_WORKSPACE;
  }

  /**
   * Drops a tab (and its whole multi-selection, if it's part of one — in
   * whichever window it was selected) onto a workspace. All of them move or
   * none do: a workspace without room for the lot takes nothing.
   */
  public moveTabsToWorkspace(id: string, workspaceId: string): BrowserState {
    const selection = this.registry.selectionContainingTab(id);
    if (!selection) {
      return this.moveTabToWorkspace(id, workspaceId);
    }
    const toMove = selection.filter((tabId) => this.states.get(tabId)?.workspaceId !== workspaceId);
    if (toMove.length === 0 || this.wouldExceedTabLimit(workspaceId, toMove)) {
      return this.getState();
    }
    for (const tabId of toMove) {
      this.moveTabToWorkspace(tabId, workspaceId);
    }
    return this.getState();
  }

  /**
   * Drops a tab (and its whole multi-selection) into this window's active
   * workspace, just before `beforeId` (`null` = the end), keeping the tabs'
   * relative order — the tab strip's drag-and-drop, also across windows.
   */
  public moveTabsBefore(id: string, beforeId: string | null): BrowserState {
    const destinationWorkspaceId = this.activeWorkspaceId;
    const dragged = this.registry.selectionContainingTab(id) ?? [id];
    const foreign = dragged.filter((tabId) => {
      const workspaceId = this.states.get(tabId)?.workspaceId;
      return workspaceId !== undefined && workspaceId !== destinationWorkspaceId;
    });
    if (foreign.length > 0 && this.wouldExceedTabLimit(destinationWorkspaceId, foreign)) {
      return this.getState();
    }
    for (const tabId of foreign) {
      this.moveTabToWorkspace(tabId, destinationWorkspaceId);
    }

    // Dropping onto one of the dragged tabs themselves: land before the next tab that isn't.
    let anchor = beforeId;
    if (anchor !== null && dragged.includes(anchor)) {
      const order = this.listedTabIds(destinationWorkspaceId);
      anchor = order.slice(order.indexOf(anchor) + 1).find((tabId) => !dragged.includes(tabId)) ?? null;
    }
    for (const tabId of dragged) {
      this.moveTab(tabId, anchor);
    }
    return this.getState();
  }

  // ── Workspaces ───────────────────────────────────────────────────────

  /**
   * Creates a new workspace, switches to it, and (since it starts with no
   * tabs) opens a home tab in it — then focuses the address bar, same as
   * `createTabAndFocusAddressBar`: a brand new workspace's fresh home tab
   * implies the person is about to type somewhere, just like a brand new
   * tab does. Plain `switchWorkspace` (an existing workspace) deliberately
   * leaves focus alone, since that's just navigating back to work already
   * in progress there.
   * @param name Display name; defaults to "Workspace N".
   * @returns The full browser state after the workspace is created.
   */
  public createWorkspace(name?: string): BrowserState {
    if (this.workspaces.size >= MAX_WORKSPACES) {
      // A brand-new, tabless window (File > New Window) has nothing else to
      // show, so it lands on the first existing workspace instead.
      if (this.activeTabId === null) {
        const firstId = this.workspaces.keys().next().value as string;
        this.activeWorkspaceId = firstId;
        this.focusWorkspaceDefaultTab(firstId);
      }
      return this.getState();
    }
    const id = randomUUID();
    const color = WORKSPACE_COLORS[this.workspaces.size % WORKSPACE_COLORS.length]!;
    this.workspaces.set(id, {
      id,
      name: name?.trim() || `Workspace ${this.workspaces.size + 1}`,
      color,
      icon: DEFAULT_WORKSPACE_ICON,
    });
    const state = this.switchWorkspace(id);
    this.focusAddressBarPastTabLoad(state.activeTabId);
    return state;
  }

  /**
   * A workspace's tabs as a workspace image keeps them, in tab-strip order: a
   * page's address, a PDF's or note's file (or nothing, if none is open), or
   * just the kind for a terminal or History tab.
   * @param workspaceId The workspace.
   * @returns The tabs, and the ids of the tabs they came from.
   */
  private imageTabsOf(workspaceId: string): { readonly tabs: ImageTab[]; readonly ids: string[] } {
    const tabs: ImageTab[] = [];
    const ids: string[] = [];
    for (const id of this.listedTabIds(workspaceId)) {
      const state = this.states.get(id);
      if (!state) {
        continue;
      }
      ids.push(id);
      tabs.push(
        state.kind === 'browser'
          ? { kind: 'browser', value: state.url }
          : state.kind === 'pdf' || state.kind === 'markdown'
            ? { kind: state.kind, value: state.filePath ?? '' }
            : { kind: state.kind, value: '' },
      );
    }
    return { tabs, ids };
  }

  /** Which saved image (by id) each workspace currently matches exactly — see `BrowserState.savedWorkspaceImages`. */
  private savedWorkspaceImages(): Record<string, string> {
    const keyOf = (tabs: readonly ImageTab[]): string => JSON.stringify(tabs.map((tab) => [tab.kind, tab.value]));
    const imageIdByKey = new Map<string, string>();
    for (const image of this.workspaceImages.list()) {
      const key = keyOf(image.tabs);
      if (!imageIdByKey.has(key)) {
        imageIdByKey.set(key, image.id);
      }
    }
    const saved: Record<string, string> = {};
    if (imageIdByKey.size === 0) {
      return saved;
    }
    for (const workspaceId of this.workspaces.keys()) {
      const imageId = imageIdByKey.get(keyOf(this.imageTabsOf(workspaceId).tabs));
      if (imageId !== undefined) {
        saved[workspaceId] = imageId;
      }
    }
    return saved;
  }

  /**
   * Saves a workspace as an image: its name, color, icon and its tabs in
   * order (a page's address, a PDF's or note's file, or just the kind for a
   * terminal or History tab) plus which was in front. A workspace whose tabs
   * already match a saved image isn't saved again; one whose tabs have
   * changed since is saved as a new, different image.
   * @param workspaceId The workspace to save. A no-op if it doesn't exist.
   * @returns The full browser state after the change.
   */
  public saveWorkspaceImage(workspaceId: string): BrowserState {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      return this.getState();
    }
    const { tabs, ids: savedIds } = this.imageTabsOf(workspaceId);
    if (tabs.length === 0 || this.savedWorkspaceImages()[workspaceId] !== undefined) {
      return this.getState();
    }
    this.workspaceImages.save({
      name: workspace.name,
      color: workspace.color,
      icon: workspace.icon,
      tabs,
      activeIndex: Math.max(0, savedIds.indexOf(this.activeTabId ?? '')),
    });
    this.emitState();
    return this.getState();
  }

  /**
   * Opens a saved workspace image as a brand-new workspace with its name,
   * color and icon, and re-creates its tabs in their saved order: pages
   * reload from their address, PDFs and notes reopen their files (if still
   * there), terminals start a fresh shell. The tab that was in front when
   * the image was saved is the one shown.
   * @param imageId The image to open. A no-op if it doesn't exist or the workspace limit is reached.
   * @returns The full browser state after the change.
   */
  public openWorkspaceImage(imageId: string): BrowserState {
    const image = this.workspaceImages.get(imageId);
    if (!image || this.workspaces.size >= MAX_WORKSPACES) {
      return this.getState();
    }
    const id = randomUUID();
    this.workspaces.set(id, { id, name: image.name, color: image.color, icon: image.icon });
    // Switched to by hand: `switchWorkspace` would open a home tab in the empty workspace first.
    this.activeWorkspaceId = id;
    this.selectedWorkspaceIds.clear();

    const created: string[] = [];
    for (const tab of image.tabs) {
      if (tab.kind === 'browser') {
        this.createTab(isNavigableUrl(tab.value) || tab.value === HOME_URL ? tab.value : undefined, id);
      } else if (tab.kind === 'terminal') {
        this.createTerminalTab(id);
      } else if (tab.kind === 'history') {
        this.createHistoryTab(id);
      } else if (tab.kind === 'bookmarks') {
        this.createBookmarksTab(id);
      } else if (tab.kind === 'secrets') {
        this.createSecretsTab(id);
      } else if (tab.kind === 'markdown') {
        this.createMarkdownTab(id, tab.value !== '' && existsSync(tab.value) ? tab.value : undefined);
      } else {
        this.createPdfTab(id);
        const pdfId = this.activeTabId;
        if (tab.value !== '' && pdfId && existsSync(tab.value)) {
          void this.loadPdfFromPath(pdfId, tab.value);
        }
      }
      // Each creator makes its new tab the active one; a refused one (the workspace is full) leaves it unchanged.
      const newest = this.activeTabId;
      if (newest && this.states.get(newest)?.workspaceId === id && !created.includes(newest)) {
        created.push(newest);
      }
    }

    const shown = created[Math.min(image.activeIndex, created.length - 1)];
    if (shown) {
      this.activateTab(shown);
    } else {
      this.focusWorkspaceDefaultTab(id);
    }
    this.emitState();
    return this.getState();
  }

  /**
   * Deletes a saved workspace image. Workspaces already opened from it are unaffected.
   * @param imageId The image to delete.
   * @returns The full browser state after the change.
   */
  public removeWorkspaceImage(imageId: string): BrowserState {
    this.workspaceImages.remove(imageId);
    this.emitState();
    return this.getState();
  }

  /**
   * Renames a saved workspace image.
   * @param imageId The image to rename.
   * @param name The new name; a blank one is ignored.
   * @returns The full browser state after the change.
   */
  public renameWorkspaceImage(imageId: string, name: string): BrowserState {
    this.workspaceImages.rename(imageId, name);
    this.emitState();
    return this.getState();
  }

  /**
   * Creates a new workspace containing exactly one tab — moved there as
   * its first (and only) tab — and switches to it: `WorkspaceBar`'s
   * drag-onto-"+ New workspace" gesture. Builds the workspace directly
   * rather than via `createWorkspace` followed by `moveTabToWorkspace`:
   * `createWorkspace`'s own `switchWorkspace` call would open a fresh home
   * tab in it first (its usual empty-workspace fallback), leaving the
   * dragged tab second rather than first. Doesn't steal address-bar focus
   * the way `createWorkspace` does either — that tab already has real
   * content, unlike a brand-new empty one. A no-op if `tabId` doesn't exist.
   * @param tabId The tab to move into the new workspace.
   * @returns The full browser state after the change.
   */
  public createWorkspaceWithTab(tabId: string): BrowserState {
    if (!this.states.has(tabId) || this.workspaces.size >= MAX_WORKSPACES) {
      return this.getState();
    }
    const id = randomUUID();
    const color = WORKSPACE_COLORS[this.workspaces.size % WORKSPACE_COLORS.length]!;
    this.workspaces.set(id, {
      id,
      name: `Workspace ${this.workspaces.size + 1}`,
      color,
      icon: DEFAULT_WORKSPACE_ICON,
    });
    for (const memberId of this.registry.selectionContainingTab(tabId) ?? [tabId]) {
      this.moveTabToWorkspace(memberId, id);
    }
    return this.switchWorkspace(id);
  }

  /**
   * Creates a new workspace and reassigns one tab into it, like
   * `createWorkspaceWithTab`, but doesn't switch *this* window to it or
   * activate anything here — `tearOffTab`'s (main/index.ts) own
   * workspace half. The tab is about to be shown in a brand-new window
   * that doesn't exist yet, not this one, so this only needs to (a) give
   * it a fresh, standalone workspace of its own rather than colliding
   * with the real, now-shared "Home" (see `SharedTabRegistry`'s own doc
   * comment for why tearing off used to create a second, unrelated "Home"
   * before workspaces were shared), and (b) release it from wherever it's
   * currently mounted (`moveTabToWorkspace` already does this) — the new
   * window's own `activateTab` call handles actually mounting it once it
   * exists.
   * @param tabId The tab to give its own new workspace.
   * @returns The new workspace's id, or `null` if `tabId` doesn't exist.
   */
  public createStandaloneWorkspaceFor(tabId: string): string | null {
    if (!this.states.has(tabId) || this.workspaces.size >= MAX_WORKSPACES) {
      return null;
    }
    // A multi-selection is torn off together. Each one's view is detached
    // from its linked group first: the torn-off tabs become independent, and
    // the other windows' views of them stay where they are.
    const tornIds = this.registry.selectionContainingTab(tabId) ?? [tabId];
    for (const memberId of tornIds) {
      this.unlinkTab(memberId);
    }
    const id = randomUUID();
    const color = WORKSPACE_COLORS[this.workspaces.size % WORKSPACE_COLORS.length]!;
    this.workspaces.set(id, {
      id,
      name: `Workspace ${this.workspaces.size + 1}`,
      color,
      icon: DEFAULT_WORKSPACE_ICON,
    });
    // The source workspace keeps a fresh home tab if this was its last, rather
    // than being deleted: the tab is still mid-drag and has no window yet.
    this.moveTabToWorkspace(tabId, id, false);
    for (const memberId of tornIds.filter((memberId) => memberId !== tabId)) {
      this.moveTabToWorkspace(memberId, id, false);
    }
    return id;
  }

  /**
   * Switches which workspace's tabs are visible, restoring whichever tab
   * was last active there (or its first tab, or a fresh home tab if it has
   * none).
   * @param id The workspace to switch to.
   * @returns The full browser state after the switch.
   */
  public switchWorkspace(id: string): BrowserState {
    if (!this.workspaces.has(id) || id === this.activeWorkspaceId) {
      return this.getState();
    }
    // A split stays with its workspace (`pairByWorkspace`): put away on leaving, and shown again on coming back when
    // the tab shown there last is one of its two (`activateTab`).
    this.activeWorkspaceId = id;
    this.selectedWorkspaceIds.clear();
    this.focusWorkspaceDefaultTab(id);
    return this.getState();
  }

  /**
   * Creates an independent "linked twin" of a browser tab — a brand-new
   * `WebContentsView` loaded to the same URL, in the same (shared, not
   * duplicated) workspace, but with its own separate scroll position, DOM
   * state, and navigation history from this point forward. This is what
   * "Open Workspace in New Window" (Ctrl+Shift+O) actually creates for
   * whichever tab is active: rather than relocating that tab's own view
   * (impossible for *every* tab in a workspace at once without leaving this
   * window's workspace empty — a `WebContentsView` can only ever be mounted
   * in one window at a time) or duplicating the whole workspace into a
   * separate one, this lets the very same page be viewed from two windows
   * simultaneously, each independently scrollable/interactive.
   *
   * The two stay *linked* on one axis only: navigating either one (typing a
   * new address, following a link) also navigates the other to match — see
   * `propagateLinkedNavigation`, wired into `wireEvents`'s own
   * `did-navigate`/`did-navigate-in-page` handlers — so they always agree on
   * *which page* even though each can be scrolled to a different part of
   * it. Highlights and comments need no extra wiring at all for this: both
   * already synchronize between any two tabs open to the same URL regardless
   * of any link (`HighlighterController`/`CommentController` key their sync
   * by URL string, not tab id).
   *
   * Deliberately does not activate the new tab in this window — it's meant
   * to be picked up by a *different* one via the ordinary cross-window
   * `activateTab` steal, so leaving it unmounted here means this window's
   * own currently active tab is never disrupted, not even for a moment.
   * @param tabId The browser tab to create a linked twin of.
   * @returns The new tab's id, or `null` if `tabId` isn't a live browser tab.
   */
  public createLinkedTwin(tabId: string): string | null {
    const state = this.states.get(tabId);
    if (!state || state.kind !== 'browser') {
      return null;
    }
    const twinId = this.createBrowserTabState(state.url, state.workspaceId);
    this.registry.addToLinkGroup(tabId, twinId);
    this.emitState();
    return twinId;
  }

  /**
   * Navigates a tab's linked twin (see `createLinkedTwin`) to match, if it
   * has one and isn't already there — called from every place a browser
   * tab's own URL actually changes (`wireEvents`'s `did-navigate`/
   * `did-navigate-in-page`). The "isn't already there" check is what stops
   * this from ping-ponging forever: navigating the twin triggers its own
   * `did-navigate`, which calls back in here for the *original* tab, but by
   * then the original's own state was already patched to the same URL
   * (synchronously, before this runs), so that second call is a no-op.
   * `navigate()` itself needs no window-ownership resolution to call
   * here — it only touches the shared `views`/`states` maps, so it works
   * identically regardless of which window currently has the twin mounted,
   * same as calling it on `this` always would for any tab id.
   * @param tabId The tab whose URL just changed.
   * @param url Its new URL.
   */
  private propagateLinkedNavigation(tabId: string, url: string): void {
    for (const memberId of this.registry.getLinkGroup(tabId) ?? []) {
      const memberState = this.states.get(memberId);
      if (memberId === tabId || !memberState || memberState.kind !== 'browser' || memberState.url === url) {
        continue;
      }
      this.navigate(memberId, url);
    }
  }

  /** Removes a tab's link to its twin (see `createLinkedTwin`), if it has one — call when either tab closes, so the survivor goes back to being an ordinary, unlinked tab rather than pointing at a partner that no longer exists. */
  private unlinkTab(tabId: string): void {
    this.registry.removeFromLinkGroup(tabId);
  }

  /**
   * Whether a tab belongs in *this* window's own tab bar — `getState`'s own
   * per-window filter. An ordinary (unlinked) tab always does; a linked pair
   * (see `createLinkedTwin`) is meant to read as a single tab, so only one
   * half of it is ever listed for a given window: whichever half this
   * window actually owns (`registry.mountOwners`), so each window's tab bar
   * reflects its own live view rather than always showing the original.
   * Neither half owned by this window at all (both currently backgrounded
   * elsewhere) falls back to always listing the original — the one
   * `createLinkedTwin` was called *on*, not the one it created — so the pair
   * never both vanish from a window's tab bar and never show two rows for
   * what only ever reads as one tab. This only ever hides at most one entry
   * per window; every other window still lists whichever half it owns.
   */
  private shouldListTabForThisWindow(tabId: string): boolean {
    const group = this.registry.getLinkGroup(tabId);
    if (!group) {
      return true;
    }
    if (this.registry.mountOwners.get(tabId) === this) {
      return true;
    }
    if (group.some((memberId) => memberId !== tabId && this.registry.mountOwners.get(memberId) === this)) {
      return false;
    }
    return group[0] === tabId;
  }

  /**
   * Ids of the tabs this window's tab bar lists, in tab-strip order. A
   * linked group sits where its canonical (original) member is, no matter
   * which member this window actually shows, so switching between windows
   * never makes a tab jump to the end of the strip.
   * @param workspaceId Restrict to one workspace, or omit for every workspace.
   */
  private listedTabIds(workspaceId?: string): string[] {
    const order = new Map<string, number>();
    Array.from(this.states.keys()).forEach((tabId, index) => order.set(tabId, index));
    const position = (tabId: string): number => order.get(this.registry.getLinkGroup(tabId)?.[0] ?? tabId) ?? 0;
    return Array.from(this.states.entries())
      .filter(([tabId, state]) => (workspaceId === undefined || state.workspaceId === workspaceId) && this.shouldListTabForThisWindow(tabId))
      .map(([tabId]) => tabId)
      .sort((a, b) => position(a) - position(b));
  }

  /**
   * Renames a workspace. A no-op if it doesn't exist or the name is blank.
   * @param id The workspace to rename.
   * @param name The new display name.
   * @returns The full browser state after the change.
   */
  public renameWorkspace(id: string, name: string): BrowserState {
    const workspace = this.workspaces.get(id);
    const trimmed = name.trim();
    if (!workspace || !trimmed) {
      return this.getState();
    }
    this.workspaces.set(id, { ...workspace, name: trimmed });
    this.emitState();
    return this.getState();
  }

  /**
   * Moves a workspace to a new place in the sidebar (a drag in the sidebar).
   * The order is also the order Ctrl+Up/Down steps through. A no-op if either
   * workspace doesn't exist.
   * @param id The workspace to move.
   * @param beforeId The workspace it goes just above, or `null` for the end.
   * @returns The full browser state after the change.
   */
  public moveWorkspace(id: string, beforeId: string | null): BrowserState {
    const workspace = this.workspaces.get(id);
    if (!workspace || id === beforeId || (beforeId !== null && !this.workspaces.has(beforeId))) {
      return this.getState();
    }
    const others = Array.from(this.workspaces.entries()).filter(([otherId]) => otherId !== id);
    const at = beforeId === null ? others.length : others.findIndex(([otherId]) => otherId === beforeId);
    const ordered = [...others.slice(0, at), [id, workspace] as const, ...others.slice(at)];
    // Rebuilt in place, not replaced: every window shares this one map (`SharedTabRegistry`), and its insertion order
    // is the sidebar's order.
    this.workspaces.clear();
    for (const [workspaceId, state] of ordered) {
      this.workspaces.set(workspaceId, state);
    }
    this.emitState();
    return this.getState();
  }

  /**
   * Changes a workspace's name, icon color and icon in one step — the
   * workspace editor's Save. A no-op if it doesn't exist or the name is blank.
   * @param id The workspace to change.
   * @param update The new name, `#rrggbb` color and icon id.
   * @returns The full browser state after the change.
   */
  public updateWorkspace(id: string, update: { name: string; color: string; icon: string }): BrowserState {
    const workspace = this.workspaces.get(id);
    const name = update.name.trim();
    if (!workspace || !name || !isWorkspaceIconId(update.icon)) {
      return this.getState();
    }
    this.workspaces.set(id, { ...workspace, name, color: update.color, icon: update.icon });
    this.emitState();
    return this.getState();
  }

  /**
   * Asks this window's chrome to open the editor for its active workspace
   * (menu/accelerator-driven, Ctrl+Shift+E). See `requestTabSearch` for why
   * `webContents.focus()` has to happen here too.
   */
  public requestEditWorkspace(): void {
    this.window.webContents.focus();
    this.window.webContents.send(IpcChannel.UiEditWorkspace);
  }

  /**
   * Removes a workspace and closes every tab in it. Refuses to remove the
   * last remaining workspace — there must always be at least one.
   * @param id The workspace to remove.
   * @returns The full browser state after the change.
   */
  public removeWorkspace(id: string): BrowserState {
    if (this.workspaces.size <= 1 || !this.workspaces.has(id)) {
      return this.getState();
    }

    for (const [tabId, state] of Array.from(this.states.entries())) {
      if (state.workspaceId !== id) {
        continue;
      }
      if (state.kind === 'terminal') {
        this.terminals.dispose(tabId);
      }
      const view = this.views.get(tabId);
      if (view) {
        retireView(view);
        releaseView(view, this.window);
      }
      this.views.delete(tabId);
      this.states.delete(tabId);
      this.registry.zoomPercentByTabId.delete(tabId);
      this.highlighter.disposeTab(tabId);
      this.commentController.disposeTab(tabId);
      this.textBoxController.disposeTab(tabId);
      this.penController.disposeTab(tabId);
      this.unlinkTab(tabId);
      if (this.grabbedTabId === tabId) {
        this.grabbedTabId = null;
      }
    }
    this.workspaces.delete(id);
    this.lastActiveTabIdByWorkspace.delete(id);

    if (this.activeWorkspaceId === id) {
      const fallbackId = this.workspaces.keys().next().value as string;
      this.activeWorkspaceId = fallbackId;
      this.activeTabId = null;
      this.focusWorkspaceDefaultTab(fallbackId);
    } else {
      this.emitState();
    }
    return this.getState();
  }

  /**
   * Closes every workspace except the active one (Ctrl+Shift+Alt+W), then
   * resets that survivor's own tabs via `closeAllTabs` — the workspace
   * equivalent of `closeAllTabs` itself, and routed through the same two
   * methods so it inherits their tab/workspace teardown instead of
   * duplicating it. Always ends with exactly one workspace containing
   * exactly one fresh home tab, same as pressing Ctrl+Alt+W repeatedly
   * until only one workspace is left, then Ctrl+Shift+W.
   * @returns The full browser state after the reset.
   */
  public closeAllWorkspaces(): BrowserState {
    const idsToRemove = Array.from(this.workspaces.keys()).filter(
      (id) => id !== this.activeWorkspaceId,
    );
    for (const id of idsToRemove) {
      this.removeWorkspace(id);
    }
    return this.closeAllTabs();
  }

  // ── Bookmarks ────────────────────────────────────────────────────────

  /** Saves a bookmark (a no-op if the URL is already saved). */
  public addBookmark(title: string, url: string): BrowserState {
    // The blank default page has no address worth saving.
    if (url === HOME_URL) {
      return this.getState();
    }
    this.bookmarkStore.add(title, url);
    this.bookmarksChanged();
    this.emitState();
    return this.getState();
  }

  /** Removes a bookmark by id. */
  public removeBookmark(id: string): BrowserState {
    this.bookmarkStore.remove(id);
    this.bookmarksChanged();
    this.syncFileTabTitles();
    this.emitState();
    return this.getState();
  }

  /**
   * Bookmarks the given tab's current page, or un-bookmarks it if it's
   * already saved. A no-op if the tab doesn't exist (e.g. a stale
   * accelerator firing after the tab closed), or if it's showing the blank
   * default page (`HOME_URL`), which can't be bookmarked.
   * @param id The tab whose page to bookmark or un-bookmark.
   * @returns The full browser state after the change.
   */
  public toggleBookmark(id: string): BrowserState {
    // While a note is being edited Ctrl+B is Bold, as in any editor.
    if (this.formatMarkdown(id, 'bold')) {
      return this.getState();
    }
    const state = this.states.get(id);
    if (state?.kind === 'pdf') {
      // A PDF is bookmarked by its path on disk, and only once a file is open.
      const path = pdfFilePaths.get(id);
      if (!path) {
        return this.getState();
      }
      this.bookmarkStore.togglePdf(path);
      this.bookmarksChanged();
      this.syncFileTabTitles();
      this.emitState();
      return this.getState();
    }
    if (state?.kind === 'markdown') {
      // A note is bookmarked by its path on disk, and only once one is open.
      const path = markdownDocuments.pathOf(id);
      if (!path) {
        return this.getState();
      }
      this.bookmarkStore.toggleMarkdown(path);
      this.bookmarksChanged();
      this.syncFileTabTitles();
      this.emitState();
      return this.getState();
    }
    if (!state || state.kind !== 'browser' || state.url === HOME_URL) {
      return this.getState();
    }
    this.bookmarkStore.toggle(state.title, state.url);
    this.bookmarksChanged();
    this.emitState();
    return this.getState();
  }

  /**
   * Bookmarks a PDF tab's open file under a name the user chose (the
   * bookmark popup's Save). The tab then goes by that name too.
   * @param id The PDF tab. A no-op if it isn't one or has no file open.
   * @param name What to call the bookmark.
   * @returns The full browser state after the change.
   */
  public addPdfBookmark(id: string, name: string): BrowserState {
    const path = this.states.get(id)?.kind === 'pdf' ? pdfFilePaths.get(id) : undefined;
    if (!path) {
      return this.getState();
    }
    this.bookmarkStore.addPdf(name, path);
    this.bookmarksChanged();
    this.syncFileTabTitles();
    this.emitState();
    return this.getState();
  }

  /** What a PDF tab with this file open is titled: its bookmark's name if it has one, else the file's own name. */
  private pdfTabTitle(path: string): string {
    return this.bookmarkStore.findPdf(path)?.title ?? basename(path);
  }

  /** Re-titles every PDF and Markdown tab from its file's bookmark (or lack of one) — call after bookmarks change. Doesn't emit; the caller does. */
  private syncFileTabTitles(): void {
    for (const [id, state] of this.states) {
      if ((state.kind !== 'pdf' && state.kind !== 'markdown') || !state.filePath) {
        continue;
      }
      const title = state.kind === 'pdf' ? this.pdfTabTitle(state.filePath) : this.markdownTabTitle(state.filePath);
      if (title !== state.title) {
        this.states.set(id, { ...state, title });
      }
    }
  }

  /**
   * Drops every PDF bookmark whose file no longer exists (moved, renamed
   * outside the app, or deleted) — the bookmark is disconnected from
   * anything — Run whenever an
   * empty PDF page loads or comes back (a new PDF tab, a closed file).
   */
  private async refreshPdfBookmarks(): Promise<void> {
    const paths = this.bookmarkStore.listPdfs().flatMap((bookmark) => (bookmark.path ? [bookmark.path] : []));
    const missing = (
      await Promise.all(paths.map(async (path) => ((await stat(path).then(() => true, () => false)) ? null : path)))
    ).filter((path): path is string => path !== null);
    if (this.bookmarkStore.removePdfPaths(missing)) {
      this.bookmarksChanged();
      this.syncFileTabTitles();
      this.emitState();
    }
  }

  /**
   * Opens a bookmarked PDF in a PDF tab. If the file has gone missing since
   * the list was shown, its bookmark is dropped instead.
   * @param id The PDF tab to open it in.
   * @param bookmarkId The bookmark picked from the empty page's list.
   */
  public async openPdfBookmark(id: string, bookmarkId: string): Promise<void> {
    const bookmark = this.bookmarkStore.listPdfs().find((candidate) => candidate.id === bookmarkId);
    if (!bookmark?.path || this.states.get(id)?.kind !== 'pdf') {
      return;
    }
    if (!(await stat(bookmark.path).then(() => true, () => false))) {
      this.bookmarkStore.remove(bookmark.id);
      this.bookmarksChanged();
      this.syncFileTabTitles();
      this.emitState();
      return;
    }
    await this.loadPdfFromPath(id, bookmark.path);
  }

  /**
   * Captures the active tab's current frame (any kind — browser, terminal,
   * PDF or History) and hides its native `WebContentsView` — what
   * `BookmarkPopup` and `TabSearchPopup` show blurred behind themselves
   * instead of the live page, since they're true modals. The view has to
   * actually come off the window, not just be covered by chrome-drawn UI,
   * since it's a separate native surface layered above the chrome (same
   * reason `activateTab` needs `webContents.focus()` — see there) that
   * would otherwise render on top of the popup and swallow every click
   * meant for it. A no-op (returns `null`, nothing hidden) for anything
   * but the active tab.
   *
   * Not used by the address bar's suggestions dropdown or `ColorPicker` —
   * both have their own dedicated overlay `WebContentsView`s instead
   * (`SuggestionsOverlay`, `ColorPickerOverlay`), specifically so the page
   * never has to stop being live just because their dropdown is open.
   * @param id The tab to preview and hide.
   * @returns A data URL of the tab's last-painted frame, or `null` if it
   *   couldn't be captured — the view is hidden either way, and the popup
   *   falls back to a plain scrim.
   */
  public async beginTabPreview(id: string): Promise<string | null> {
    const view = this.views.get(id);
    const state = this.states.get(id);
    if (!view || !state || id !== this.activeTabId) {
      return null;
    }
    // A popup is coming up over the page: the save prompt, a view of its own, would sit on top of it.
    this.dismissSecretPrompt();

    // Split: both sides go behind the popup, as one still of the whole area.
    const otherId = this.splitOtherTabId();
    const otherView = otherId ? this.views.get(otherId) : undefined;
    if (otherId && otherView) {
      const still = await this.captureSplitStill([view, otherView]);
      this.window.contentView.removeChildView(view);
      this.window.contentView.removeChildView(otherView);
      return still;
    }

    let dataUrl: string | null = null;
    try {
      const image = await view.webContents.capturePage();
      dataUrl = image.toDataURL();
    } catch {
      // Falls back to a plain scrim behind the popup — still fully
      // functional, just without the blurred page behind it.
    }

    this.window.contentView.removeChildView(view);
    return dataUrl;
  }

  /**
   * Re-shows the view `beginTabPreview` hid — called once whatever overlay
   * was using it closes, however it closed. A no-op if the tab closed or
   * stopped being active while the overlay was open.
   * @param id The tab to re-show.
   * @returns The full browser state after re-mounting it.
   */
  public restoreTabPreview(id: string): BrowserState {
    const view = this.views.get(id);
    if (view && id === this.activeTabId) {
      // Index 0 — see `activateTab`'s own `addChildView` call for why.
      this.window.contentView.addChildView(view, 0);
      // Split: the other side comes back too, and both go back to their halves.
      const otherView = this.splitOtherTabId() ? this.views.get(this.splitOtherTabId() ?? '') : undefined;
      if (otherView) {
        this.window.contentView.addChildView(otherView, 0);
        this.updateBounds();
      } else {
        view.setBounds(this.computeMainBounds(this.targetLeftInset(), this.targetTopInset()));
      }
      this.giveKeyboardAsLeft(id, view);
    }
    return this.getState();
  }

  /**
   * One still of the split's two pages where they sit, for a popup's blurred backdrop: an SVG the size of the tab area
   * with each page's capture at its own place in it (the gaps between them left clear, the background showing).
   * @param views The two sides' views.
   * @returns The still as a data URL, or `null` if neither could be captured.
   */
  private async captureSplitStill(views: readonly WebContentsView[]): Promise<string | null> {
    const left = this.targetLeftInset();
    const top = this.targetTopInset();
    const [width = 0, height = 0] = this.window.getContentSize();
    const areaWidth = Math.max(1, Math.round(width - left - this.rightInsetNow));
    const areaHeight = Math.max(1, Math.round(height - top));
    const images = await Promise.all(
      views.map(async (view) => {
        const bounds = view.getBounds();
        try {
          const image = await view.webContents.capturePage();
          return (
            `<image x="${bounds.x - left}" y="${bounds.y - top}" width="${bounds.width}" height="${bounds.height}" ` +
            `preserveAspectRatio="none" href="${image.toDataURL()}"/>`
          );
        } catch {
          return '';
        }
      }),
    );
    if (images.every((image) => image === '')) {
      return null;
    }
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${areaWidth}" height="${areaHeight}" ` +
      `viewBox="0 0 ${areaWidth} ${areaHeight}">${images.join('')}</svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  }

  // ── Split view ───────────────────────────────────────────────────────

  /**
   * Split screen (the toolbar's button, Ctrl+Alt+S): the two selected tabs side by side, the first selected on the
   * left (`tabSelectionInOrder`); or, while split, back to one screen showing the side the keyboard was in last (the
   * active tab). A no-op unless exactly two
   * tabs are selected or it's already split.
   * @returns The full browser state after the change.
   */
  public toggleSplitScreen(): BrowserState {
    if (this.splitView) {
      return this.exitSplitView();
    }
    const [left, right, ...more] = this.tabSelectionInOrder();
    if (!left || !right || more.length > 0) {
      return this.getState();
    }
    // Showing the left tab ends the selection; the split keeps which side each is on.
    if (this.activeTabId !== left) {
      this.activateTab(left);
    }
    return this.enterSplitView(right);
  }

  /**
   * Asks the chrome to confirm Revert annotations (the menu's entry, its shortcut): it opens the popup that asks for
   * "REVERT" to be typed, then reverts.
   */
  public requestRevert(): void {
    if (this.activeTabId && !this.window.isDestroyed()) {
      this.window.webContents.send(IpcChannel.TabsRevertRequested);
    }
  }

  /** In split screen, the side that isn't the active tab (the side the keyboard was in less lately), or `null`. */
  private splitOtherTabId(): string | null {
    const split = this.splitView;
    if (!split) {
      return null;
    }
    return split.primaryTabId === this.activeTabId ? split.secondaryTabId : split.primaryTabId;
  }

  /**
   * In split screen, makes one side the active tab without leaving the split: the side the keyboard last went to (its
   * page clicked, or its tab in the row). The Tools sidebar, Find, the zoom shortcuts and the rest act on it, its
   * tools are the ones shown, and it's the side kept on going back to one screen. A no-op for any other tab.
   * @param id The side's tab.
   * @returns The full browser state after the change.
   */
  public focusSplitSide(id: string): BrowserState {
    const split = this.splitView;
    if (!split || this.splitClosing || id === this.activeTabId || (id !== split.primaryTabId && id !== split.secondaryTabId)) {
      return this.getState();
    }
    const previousTabId = this.activeTabId;
    this.activeTabId = id;
    // The side left keeps none of the tools on: they're the active side's.
    if (previousTabId) {
      this.highlighter.syncState(previousTabId, false);
      this.commentController.syncState(previousTabId, false);
      this.textBoxController.syncState(previousTabId, false);
      this.penController.syncState(previousTabId, false);
      const previousView = this.views.get(previousTabId);
      if (previousView && !previousView.webContents.isDestroyed() && this.states.get(previousTabId)?.kind === 'pdf') {
        previousView.webContents.send(IpcChannel.PdfCropState, { active: false });
      }
    }
    this.pushPageStats();
    this.selectedTabIds.clear();
    this.releaseUnavailableTools();
    this.pushHighlighterState();
    this.pushCommentToolState();
    this.pushTextToolState();
    this.pushPenState();
    this.pushCropState();
    this.refreshFindAfterTabChange(previousTabId);
    const workspaceId = this.states.get(id)?.workspaceId;
    if (workspaceId) {
      this.lastActiveTabIdByWorkspace.set(workspaceId, id);
    }
    // The laser pointer and the find bar sit over the active side's area.
    this.updateBounds();
    this.syncSplitStatBars();
    this.emitState();
    return this.getState();
  }

  /**
   * Split screen's swap button: the two sides trade places. Both pages fade out to the tab background, change sides
   * out of sight, and fade back in. The active side stays the active one, wherever it now is.
   * @returns The full browser state after the change.
   */
  public swapSplitSides(): BrowserState {
    const split = this.splitView;
    if (!split || this.splitClosing || this.splitSwapping) {
      return this.getState();
    }
    this.splitSwapping = true;
    const color = nativeTheme.shouldUseDarkColors ? TAB_FADE_COLOR.dark : TAB_FADE_COLOR.light;
    const cover = (from: number, to: number, easing: string): string =>
      `@keyframes portalogia-split-swap-${from} { from { opacity: ${from}; } to { opacity: ${to}; } } ` +
      `html::after { content: ''; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; ` +
      `background: ${color}; animation: portalogia-split-swap-${from} ${SPLIT_SWAP_FADE_MS}ms ${easing} forwards; }`;
    const contents = [split.primaryTabId, split.secondaryTabId]
      .map((tabId) => this.views.get(tabId)?.webContents)
      .filter((wc): wc is WebContents => wc !== undefined && !wc.isDestroyed());
    const removeLater = (wc: WebContents, key: Promise<string | null>, delay: number): void => {
      void key.then((resolved) => {
        setTimeout(() => {
          if (resolved !== null && !wc.isDestroyed()) {
            void wc.removeInsertedCSS(resolved).catch(() => {});
          }
        }, delay);
      });
    };
    // Faded out: a cover over each page, from clear to the tab background.
    const outKeys = contents.map((wc) => ({ wc, key: wc.insertCSS(cover(0, 1, 'ease-in')).catch(() => null) }));
    setTimeout(() => {
      this.splitSwapping = false;
      const current = this.splitView;
      if (current !== split || this.window.isDestroyed()) {
        // Taken down (or another split shown) meanwhile: just take the covers off.
        for (const { wc, key } of outKeys) {
          removeLater(wc, key, 0);
        }
        return;
      }
      this.splitView = { primaryTabId: split.secondaryTabId, secondaryTabId: split.primaryTabId };
      const workspaceId = this.states.get(split.primaryTabId)?.workspaceId;
      if (workspaceId) {
        this.pairByWorkspace.set(workspaceId, this.splitView);
      }
      // The row's two tabs trade places with the sides they show.
      this.placeTabAfter(split.primaryTabId, split.secondaryTabId);
      this.updateBounds();
      this.emitState();
      // In again: an opaque cover fading to clear goes on first, then the one that faded out comes off under it.
      for (const { wc, key } of outKeys) {
        const inKey = wc.insertCSS(cover(1, 0, 'ease-out')).catch(() => null);
        void inKey.then(() => removeLater(wc, key, 0));
        removeLater(wc, inKey, SPLIT_SWAP_FADE_MS + 20);
      }
    }, SPLIT_SWAP_FADE_MS);
    return this.getState();
  }

  /** The tab whose page has the keyboard: the active one, or the split's other side — `BrowserState.focusedTabId`. */
  private focusedPageTabId(): string | null {
    for (const tabId of [this.activeTabId, this.splitOtherTabId()]) {
      const view = tabId ? this.views.get(tabId) : undefined;
      if (tabId && view && !view.webContents.isDestroyed() && view.webContents.isFocused()) {
        return tabId;
      }
    }
    return null;
  }

  /**
   * Gives each self-framing page in the split (a note, PDF, terminal…) narrower side margins, so the two pages meet in
   * the middle of the gap between the frames (`computeSplitPanes`). Its own frame then sits exactly where the
   * layout puts it. A web page needs none: the chrome draws its frame.
   */
  private narrowSplitMargins(): void {
    if (!this.splitView) {
      return;
    }
    for (const tabId of [this.splitView.primaryTabId, this.splitView.secondaryTabId]) {
      const view = this.views.get(tabId);
      if (this.states.get(tabId)?.kind === 'browser' || !view || view.webContents.isDestroyed() || this.splitMarginStyles.has(tabId)) {
        continue;
      }
      this.splitMarginStyles.set(
        tabId,
        view.webContents.insertCSS(`:root:root { --size-content-frame-x: ${SPLIT_PAGE_MARGIN_PX}px; }`),
      );
    }
  }

  /**
   * In split screen the chrome draws the one bar along the window's bottom, the whole way across, with the stats of
   * the side used last (`setStatItems`, `pushPageStats`): each side that draws its own stat bar (a note, PDF or
   * terminal) has it hidden, and ends above the chrome's (`computeSplitPanes`). Out of split, every page's is shown.
   */
  private syncSplitStatBars(): void {
    const split = this.splitClosing ? null : this.splitView;
    const hidden = new Set(
      (split ? [split.primaryTabId, split.secondaryTabId] : []).filter((tabId) => this.states.get(tabId)?.kind !== 'browser'),
    );
    for (const [tabId, styleKey] of this.splitHiddenStatBars) {
      if (hidden.has(tabId)) {
        continue;
      }
      this.splitHiddenStatBars.delete(tabId);
      const view = this.views.get(tabId);
      void styleKey.then((key) => {
        if (view && !view.webContents.isDestroyed()) {
          void view.webContents.removeInsertedCSS(key).catch(() => {});
        }
      });
    }
    for (const tabId of hidden) {
      const view = this.views.get(tabId);
      if (view && !view.webContents.isDestroyed() && !this.splitHiddenStatBars.has(tabId)) {
        // Taken out of the page's layout: its frame reaches down to the chrome's bar, as a web page's does.
        const key = view.webContents.insertCSS('.md-status, .pdf-status, .terminal-status { display: none !important; }');
        key.catch(() => {});
        this.splitHiddenStatBars.set(tabId, key);
      }
    }
  }

  /** Shows every stat bar `syncSplitStatBars` hid: the split has ended. */
  private showAllStatBars(): void {
    for (const [tabId, styleKey] of this.splitHiddenStatBars) {
      const view = this.views.get(tabId);
      void styleKey.then((key) => {
        if (view && !view.webContents.isDestroyed()) {
          void view.webContents.removeInsertedCSS(key).catch(() => {});
        }
      });
    }
    this.splitHiddenStatBars.clear();
  }

  /** Gives every page `narrowSplitMargins` narrowed its own margins back. */
  private restoreSplitMargins(): void {
    for (const [tabId, styleKey] of this.splitMarginStyles) {
      const view = this.views.get(tabId);
      void styleKey.then((key) => {
        if (view && !view.webContents.isDestroyed()) {
          void view.webContents.removeInsertedCSS(key);
        }
      });
    }
    this.splitMarginStyles.clear();
  }

  /**
   * Puts the active tab (the left) and one other tab (the right) side by side, each in a frame of its own
   * (`computeSplitPanes`). Any kind of tab may go on either side. A no-op if either id is invalid or they're the
   * same tab.
   * @param secondaryId The tab to show alongside the current active tab —
   *   stolen from whichever other window currently has it mounted, if
   *   any, same as `activateTab`.
   * @returns The full browser state after the change.
   */
  public enterSplitView(secondaryId: string): BrowserState {
    const primaryId = this.activeTabId;
    if (!primaryId || primaryId === secondaryId) {
      return this.getState();
    }
    const secondaryView = this.views.get(secondaryId);
    if (!secondaryView || !this.views.has(primaryId)) {
      return this.getState();
    }
    const owner = this.registry.mountOwners.get(secondaryId);
    if (owner && owner !== this) {
      owner.releaseTab(secondaryId);
    }

    this.teardownSplitView();
    this.splitClosing = false;
    this.splitSwapping = false;
    this.splitView = { primaryTabId: primaryId, secondaryTabId: secondaryId };
    const workspaceId = this.states.get(primaryId)?.workspaceId;
    if (workspaceId) {
      this.pairByWorkspace.set(workspaceId, this.splitView);
    }
    // Side by side in the row too, the right one just after the left, so the two read as one tab.
    this.placeTabAfter(secondaryId, primaryId);
    this.registry.detachViewFromAllWindows(secondaryView);
    // Index 0 — see `activateTab`'s own `addChildView` call for why.
    this.window.contentView.addChildView(secondaryView, 0);
    this.registry.mountOwners.set(secondaryId, this);
    this.narrowSplitMargins();
    this.syncSplitStatBars();
    this.animateSplit(0, 1);
    this.emitState();
    return this.getState();
  }

  /** Exits split view: the two sides come back together, leaving the active side (the one focused last) at full width. */
  public exitSplitView(): BrowserState {
    if (!this.splitView || this.splitClosing) {
      return this.getState();
    }
    // Closed on purpose: the two are no longer a pair, and the row shows them apart again.
    const workspaceId = this.states.get(this.splitView.primaryTabId)?.workspaceId;
    if (workspaceId) {
      this.pairByWorkspace.delete(workspaceId);
    }
    // The chrome shows one screen at once (`getState`), its frame widening in step as the views move.
    this.splitClosing = true;
    this.syncSplitStatBars();
    this.animateSplit(this.splitProgress, 0, () => {
      this.teardownSplitView();
      this.updateBounds();
      this.emitState();
    });
    this.emitState();
    return this.getState();
  }

  /**
   * Moves the split's two sides apart or together (`splitProgress`), frame by frame over `SPLIT_ANIMATION_MS`
   * with an ease-out cubic — the same curve as the chrome's frames (app.css). Stops if superseded or the split is
   * taken down meanwhile (`teardownSplitView`).
   * @param from Where it starts, 0 (one screen) to 1 (side by side).
   * @param to Where it settles.
   * @param onDone Called once it settles, unless it was stopped.
   */
  private animateSplit(from: number, to: number, onDone?: () => void): void {
    const token = ++this.splitAnimationToken;
    const start = Date.now();
    const step = (): void => {
      if (token !== this.splitAnimationToken || this.window.isDestroyed()) {
        return;
      }
      const t = Math.min(1, (Date.now() - start) / SPLIT_ANIMATION_MS);
      this.splitProgress = from + (to - from) * (1 - (1 - t) ** 3);
      this.updateBounds();
      if (t < 1) {
        setTimeout(step, 16);
      } else {
        this.splitProgress = 1;
        onDone?.();
      }
    };
    step();
  }

  // ── Focus mode ───────────────────────────────────────────────────────

  /**
   * Toggles Focus Mode: slides away every bit of chrome — titlebar, tab
   * strip, toolbar, sidebar — so only the page fills the window, animating
   * the native content's bounds in step with the chrome's own CSS
   * transition the same way `toggleSidebar` already does (see
   * `animateBoundsInset`). The window itself keeps its size and place: not
   * OS fullscreen, so the taskbar stays, and a window snapped to half the
   * screen stays there with just its page showing.
   * @param enabled Whether Focus Mode should be on.
   * @returns The full browser state after the change.
   */
  public setFocusMode(enabled: boolean): BrowserState {
    const fromLeft = this.targetLeftInset();
    const fromTop = this.targetTopInset();
    this.focusMode = enabled;
    for (const id of this.views.keys()) {
      this.pushFocusModeTo(id);
    }
    this.emitState();
    this.animateBoundsInset(fromLeft, this.targetLeftInset(), fromTop, this.targetTopInset());
    return this.getState();
  }

  /**
   * Gives a tab's own fullscreen request (a video's fullscreen button) the
   * whole window, or takes it back. The window goes OS-fullscreen unless it
   * already was, and is only taken out again if this put it in.
   * @param tabId The tab whose page entered or left fullscreen.
   * @param entering Whether it entered.
   */
  private setHtmlFullScreen(tabId: string, entering: boolean): void {
    if (entering) {
      if (this.htmlFullScreenTabId !== null || this.activeTabId !== tabId || this.window.isDestroyed()) {
        return;
      }
      this.htmlFullScreenTabId = tabId;
      this.windowWasFullScreen = this.window.isFullScreen();
      if (!this.windowWasFullScreen) {
        this.window.setFullScreen(true);
      }
    } else {
      if (this.htmlFullScreenTabId !== tabId) {
        return;
      }
      this.htmlFullScreenTabId = null;
      if (!this.windowWasFullScreen && !this.window.isDestroyed()) {
        this.window.setFullScreen(false);
      }
    }
    if (!this.window.isDestroyed()) {
      this.applyBounds(this.targetLeftInset(), this.targetTopInset());
    }
  }

  /** Toggles Focus Mode to whichever state it isn't currently in. */
  /**
   * Shows or hides the active note's or PDF's side panel (Ctrl+Alt+B). The page keeps whether it's open; a tab of
   * any other kind has no panel, and the key does nothing there.
   */
  public toggleSidePanel(): void {
    const id = this.activeTabId;
    const kind = id ? this.states.get(id)?.kind : undefined;
    const view = id ? this.views.get(id) : undefined;
    if ((kind === 'markdown' || kind === 'pdf') && view && !view.webContents.isDestroyed()) {
      view.webContents.send(IpcChannel.TabToggleSidePanel);
    }
  }

  /** Switches editing the active PDF's sections in its side panel (Ctrl+Alt+E); a PDF tab with no file open, or any other tab, does nothing. */
  public toggleSectionEditing(): void {
    const id = this.activeTabId;
    const state = id ? this.states.get(id) : undefined;
    const view = id ? this.views.get(id) : undefined;
    if (state?.kind === 'pdf' && state.fileName !== null && view && !view.webContents.isDestroyed()) {
      view.webContents.send(IpcChannel.PdfToggleSectionEditing);
    }
  }

  public toggleFocusMode(): BrowserState {
    return this.setFocusMode(!this.focusMode);
  }

  // ── Annotation tool availability ─────────────────────────────────────

  /**
   * Whether a pointer tool may be switched on right now: the single rule
   * behind each toolbar button's `disabled` state (`PageActions`), enforced
   * here so no other path to the same toggle — the menu accelerators, the
   * tab views' own key handling, a direct IPC call — can turn on a tool its
   * button shows as disabled.
   *
   * Every tool needs an active tab with something on it, and none works on a
   * History, Bookmarks or Secrets tab. The laser pointer needs content to point
   * at: not the blank home page, nor a PDF or note with no file open — a
   * terminal always has its shell. The others can't mark a terminal either; the
   * crop tool only exists for a PDF, the
   * text box tool doesn't exist for a note, and a note's marks go on its
   * rendered view, so none works while it's being edited.
   * @param tool Which tool is being switched on.
   * @returns Whether it may be.
   */
  private canEnableTool(tool: 'laser' | 'highlighter' | 'pen' | 'comment' | 'text' | 'crop'): boolean {
    const active = this.activeTabId ? this.states.get(this.activeTabId) : undefined;
    if (!active) {
      return false;
    }
    if (tool === 'laser') {
      switch (active.kind) {
        case 'terminal':
          return true;
        case 'browser':
          return active.url !== HOME_URL;
        case 'pdf':
        case 'markdown':
          return active.fileName !== null;
        default:
          return false;
      }
    }
    if (
      active.kind === 'terminal' ||
      active.kind === 'history' ||
      active.kind === 'bookmarks' ||
      active.kind === 'secrets' ||
      (active.kind === 'pdf' && active.fileName === null) ||
      // A note takes marks only as the formatted, read-only reader: not while editable, and not as raw text.
      (active.kind === 'markdown' &&
        (active.fileName === null || active.mode === 'edit' || active.display === 'raw' || tool === 'text')) ||
      (active.kind === 'browser' && active.url === HOME_URL)
    ) {
      return false;
    }
    return tool !== 'crop' || active.kind === 'pdf';
  }

  /** Turns off any tool that's on but unavailable on the now-active tab (`canEnableTool`) — call when a tab is activated or a PDF is closed, since a tool left on would mark nothing and its button would sit pressed and disabled. */
  private releaseUnavailableTools(): void {
    if (this.laserPointerActive && !this.canEnableTool('laser')) {
      this.setLaserPointer(false);
    }
    if (this.highlighterActive && !this.canEnableTool('highlighter')) {
      this.setHighlighter(false);
    }
    if (this.commentToolActive && !this.canEnableTool('comment')) {
      this.setCommentTool(false);
    }
    if (this.textToolActive && !this.canEnableTool('text')) {
      this.setTextTool(false);
    }
    if (this.penActive && !this.canEnableTool('pen')) {
      this.setPen(false);
    }
    if (this.cropActive && !this.canEnableTool('crop')) {
      this.setCrop(false);
    }
  }

  // ── Laser pointer ────────────────────────────────────────────────────

  /**
   * Turns the laser pointer overlay on or off (Ctrl+I, or `PageActions`'
   * toolbar button) — see `LaserPointerOverlay`. Unlike Focus Mode, this
   * never changes the window's own bounds, so there's no animation here:
   * `syncLaserPointerOverlay` just (un)mounts the overlay view in place.
   * @param enabled Whether the laser pointer should be on.
   * @returns The full browser state after the change.
   */
  public setLaserPointer(enabled: boolean): BrowserState {
    // Same rule as the toolbar button's disabled state — see `canEnableTool`.
    if (enabled && !this.canEnableTool('laser')) {
      return this.getState();
    }
    // Mutually exclusive with the highlighter, the comment tool, and the pen
    // — all four are full-window "the pointer does something else now"
    // modes, and having more than one on at once made no sense (each one's
    // own cursor/click-suppression would think it alone owns the pointer).
    if (enabled && this.highlighterActive) {
      this.setHighlighter(false);
    }
    if (enabled && this.commentToolActive) {
      this.setCommentTool(false);
    }
    if (enabled && this.textToolActive) {
      this.setTextTool(false);
    }
    if (enabled && this.penActive) {
      this.setPen(false);
    }
    if (enabled && this.cropActive) {
      this.setCrop(false);
    }
    this.laserPointerActive = enabled;
    this.syncLaserPointerOverlay();
    this.emitState();
    return this.getState();
  }

  /** Toggles the laser pointer to whichever state it isn't currently in. */
  public toggleLaserPointer(): BrowserState {
    // While a note is being edited Ctrl+I is Italic, as in any editor.
    if (this.activeTabId && this.formatMarkdown(this.activeTabId, 'italic')) {
      return this.getState();
    }
    return this.setLaserPointer(!this.laserPointerActive);
  }

  /**
   * Turns off the laser pointer, highlighter, comment tool, and/or pen,
   * whichever is on — Escape's own "back to the plain pointer" behavior
   * (`wireSharedInputHandling`), alongside its existing Focus Mode exit.
   * Turns off all four together rather than one press per tool, if more
   * than one somehow ended up on at once.
   * @returns Whether any tool was actually on (and is now off) — callers use
   *   this to decide whether Escape should be treated as handled.
   */
  private exitPointerTools(): boolean {
    const wasOn =
      this.laserPointerActive ||
      this.highlighterActive ||
      this.commentToolActive ||
      this.textToolActive ||
      this.penActive ||
      this.cropActive;
    if (this.laserPointerActive) {
      this.setLaserPointer(false);
    }
    if (this.highlighterActive) {
      this.setHighlighter(false);
    }
    if (this.commentToolActive) {
      this.setCommentTool(false);
    }
    if (this.textToolActive) {
      this.setTextTool(false);
    }
    if (this.penActive) {
      this.setPen(false);
    }
    if (this.cropActive) {
      this.setCrop(false);
    }
    return wasOn;
  }

  /**
   * Applies the laser pointer's current on/off state to its overlay,
   * sized to whatever the active tab's own view currently occupies. Called
   * whenever that could have changed: `setLaserPointer` itself, and every
   * `applyBounds` call (resize, sidebar toggle, Focus Mode's bounds
   * animation) — so the overlay never drifts out of alignment with the tab
   * view beneath it. Off entirely when there's no active tab, same as the
   * tab view itself would be.
   */
  private syncLaserPointerOverlay(): void {
    const left = this.targetLeftInset();
    const top = this.targetTopInset();
    this.laserPointerOverlay.setActive(
      this.laserPointerActive && this.activeTabId !== null,
      this.computeMainBounds(left, top),
    );
  }

  /**
   * Hands the active tab's page the pointer's place while the laser overlay covers it (the page sees no pointer
   * events then), so its stat bar's `x×y` keeps following. The overlay's point is the view's own; a page's CSS
   * pixels are that over its zoom (a terminal's page never zooms: it sizes its text instead).
   * @param point Where the pointer is over the view, or `null` once it has left.
   */
  private relayPointerPosition(point: { x: number; y: number } | null): void {
    const id = this.activeTabId;
    const view = id ? this.views.get(id) : undefined;
    if (!id || !view || view.webContents.isDestroyed()) {
      return;
    }
    const zoom =
      this.states.get(id)?.kind === 'terminal' ? 1 : (this.registry.zoomPercentByTabId.get(id) ?? ZOOM_PERCENT_DEFAULT) / 100;
    view.webContents.send(
      IpcChannel.TabPointerPosition,
      point ? { x: Math.round(point.x / zoom), y: Math.round(point.y / zoom) } : null,
    );
  }

  // ── Highlighter ──────────────────────────────────────────────────────

  /**
   * Turns the highlighter tool on or off (Ctrl+J, or `PageActions`' toolbar
   * button) for this window. Unlike the laser pointer, there's no separate
   * overlay to (un)mount — the active tab's own preload
   * (`src/preload/tabHighlighter.ts`) does the cursor/selection/mark work
   * directly in the page, so this just pushes the new state down to it (see
   * `HighlighterController.syncState`).
   * @param enabled Whether the highlighter tool should be on.
   * @returns The full browser state after the change.
   */
  public setHighlighter(enabled: boolean): BrowserState {
    // Same rule as the toolbar button's disabled state — see `canEnableTool`.
    if (enabled && !this.canEnableTool('highlighter')) {
      return this.getState();
    }
    // Mutually exclusive with the laser pointer, the comment tool, and the
    // pen — see `setLaserPointer`'s own comment.
    if (enabled && this.laserPointerActive) {
      this.setLaserPointer(false);
    }
    if (enabled && this.commentToolActive) {
      this.setCommentTool(false);
    }
    if (enabled && this.textToolActive) {
      this.setTextTool(false);
    }
    if (enabled && this.penActive) {
      this.setPen(false);
    }
    if (enabled && this.cropActive) {
      this.setCrop(false);
    }
    this.highlighterActive = enabled;
    this.pushHighlighterState();
    this.nudgeActiveTabCursor();
    this.emitState();
    return this.getState();
  }

  /** Toggles the highlighter tool to whichever state it isn't currently in. */
  public toggleHighlighter(): BrowserState {
    return this.setHighlighter(!this.highlighterActive);
  }

  /** Whether this window currently has the highlighter tool on — read by `main/index.ts`'s accent-color broadcast to tell a tab's preload the right cursor/selection state alongside its repainted highlight color, for whichever window currently has that specific tab mounted. */
  public isHighlighterActive(): boolean {
    return this.highlighterActive;
  }

  // ── Comment tool ─────────────────────────────────────────────────────

  /**
   * Turns the comment tool on or off (Ctrl+M, or `PageActions`' toolbar
   * button) for this window — see `CommentController`. Like the highlighter,
   * there's no separate overlay to (un)mount; the active tab's own preload
   * (`src/preload/tabComments.ts`) does the drop/edit/pin work directly in
   * the page, so this just pushes the new state down to it.
   * @param enabled Whether the comment tool should be on.
   * @returns The full browser state after the change.
   */
  public setCommentTool(enabled: boolean): BrowserState {
    // Same rule as the toolbar button's disabled state — see `canEnableTool`.
    if (enabled && !this.canEnableTool('comment')) {
      return this.getState();
    }
    // Mutually exclusive with the laser pointer, the highlighter, and the
    // pen — see `setLaserPointer`'s own comment.
    if (enabled && this.laserPointerActive) {
      this.setLaserPointer(false);
    }
    if (enabled && this.highlighterActive) {
      this.setHighlighter(false);
    }
    if (enabled && this.penActive) {
      this.setPen(false);
    }
    if (enabled && this.cropActive) {
      this.setCrop(false);
    }
    if (enabled && this.textToolActive) {
      this.setTextTool(false);
    }
    this.commentToolActive = enabled;
    this.pushCommentToolState();
    this.nudgeActiveTabCursor();
    this.emitState();
    return this.getState();
  }

  /** Toggles the comment tool to whichever state it isn't currently in. */
  public toggleCommentTool(): BrowserState {
    return this.setCommentTool(!this.commentToolActive);
  }

  /** Pushes this window's current comment-tool on/off state to whichever tab is active — call whenever that could have changed: `setCommentTool` itself and `activateTab`. */
  private pushCommentToolState(): void {
    if (this.activeTabId) {
      this.commentController.syncState(this.activeTabId, this.commentToolActive);
    }
  }

  /** Pushes this window's current comment-tool on/off state to a specific tab, active or not — `wireEvents`'s own `dom-ready` handler uses this directly, same reasoning as `pushHighlighterStateTo`. */
  private pushCommentToolStateTo(tabId: string): void {
    this.commentController.syncState(tabId, this.commentToolActive);
  }

  /** Whether this window currently has the comment tool on — read by `main/index.ts`'s accent-color broadcast, same reasoning as `isHighlighterActive`. */
  public isCommentToolActive(): boolean {
    return this.commentToolActive;
  }

  // ── Text box tool ────────────────────────────────────────────────────

  /**
   * Turns the text box tool on or off (Ctrl+E, or `PageActions`' toolbar
   * button) for this window — see `TextBoxController`. A browser tab's
   * preload (`src/preload/tabTextBoxes.ts`) and a PDF tab's page both do the
   * drop/edit work themselves; this just pushes the new state down.
   * @param enabled Whether the text box tool should be on.
   * @returns The full browser state after the change.
   */
  public setTextTool(enabled: boolean): BrowserState {
    // Same rule as the toolbar button's disabled state — see `canEnableTool`.
    if (enabled && !this.canEnableTool('text')) {
      return this.getState();
    }
    // Mutually exclusive with the other pointer tools — see `setLaserPointer`'s own comment.
    if (enabled && this.laserPointerActive) {
      this.setLaserPointer(false);
    }
    if (enabled && this.highlighterActive) {
      this.setHighlighter(false);
    }
    if (enabled && this.commentToolActive) {
      this.setCommentTool(false);
    }
    if (enabled && this.penActive) {
      this.setPen(false);
    }
    if (enabled && this.cropActive) {
      this.setCrop(false);
    }
    this.textToolActive = enabled;
    this.pushTextToolState();
    this.nudgeActiveTabCursor();
    this.emitState();
    return this.getState();
  }

  /** Toggles the text box tool; does nothing on a terminal tab, where the shortcut mustn't switch on an invisible tool. */
  public toggleTextTool(): BrowserState {
    const active = this.activeTabId ? this.states.get(this.activeTabId) : undefined;
    if (!this.textToolActive && active?.kind === 'terminal') {
      return this.getState();
    }
    return this.setTextTool(!this.textToolActive);
  }

  /** Pushes this window's text-tool on/off state to whichever tab is active — call on `setTextTool` and `activateTab`. */
  private pushTextToolState(): void {
    if (this.activeTabId) {
      this.pushTextToolStateTo(this.activeTabId);
    }
  }

  /** Pushes this window's text-tool on/off state to a specific tab, active or not — a fresh document's preload has never been told. */
  private pushTextToolStateTo(tabId: string): void {
    this.textBoxController.syncState(tabId, this.textToolActive);
  }

  /** Whether this window currently has the text box tool on — read by `main/index.ts`'s accent-color broadcast. */
  public isTextToolActive(): boolean {
    return this.textToolActive;
  }

  // ── Find ─────────────────────────────────────────────────────────────

  /**
   * Whether the find bar can search a tab: a browser tab's page, a terminal's
   * buffer, or a PDF or Markdown note that's open — not the History tab (its
   * table has its own search box) and not an empty PDF or Markdown tab.
   * @param tabId The tab to ask about.
   */
  private canFind(tabId: string | null): boolean {
    const state = tabId ? this.states.get(tabId) : undefined;
    if (!state) {
      return false;
    }
    // A web tab with no site loaded (its home page, or nothing yet) has nothing of a site's to search.
    return (
      (state.kind === 'browser' && hasSiteLoaded(state.url)) ||
      state.kind === 'terminal' ||
      ((state.kind === 'pdf' || state.kind === 'markdown') && state.fileName !== null)
    );
  }

  /**
   * Opens the find bar (Ctrl+F, or the toolbar's find button) over the active
   * tab and gives it the keyboard — or, if it's already open, just pulls the
   * keyboard back to it with the query selected, as Ctrl+F does in an editor.
   * A no-op where find can't search (see `canFind`).
   * @returns The full browser state after the change.
   */
  public openFind(): BrowserState {
    if (!this.canFind(this.activeTabId)) {
      return this.getState();
    }
    const wasOpen = this.findOpen;
    this.findOpen = true;
    this.syncFindOverlay();
    this.findOverlay.focus();
    if (!wasOpen) {
      this.runFind();
      this.emitState();
    }
    return this.getState();
  }

  /**
   * Closes the find bar, clears its highlights from the tab, and hands the
   * keyboard back to the tab. A no-op if it isn't open.
   * @returns The full browser state after the change.
   */
  public closeFind(): BrowserState {
    if (!this.findOpen) {
      return this.getState();
    }
    this.sendFindCommand({ action: 'clear' });
    this.findOpen = false;
    this.findResult = NO_FIND_RESULT;
    this.findOverlay.hide();
    const view = this.activeTabId ? this.views.get(this.activeTabId) : undefined;
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.focus();
    }
    this.emitState();
    return this.getState();
  }

  /** Opens or closes the find bar — what the toolbar button does. */
  public setFind(enabled: boolean): BrowserState {
    return enabled ? this.openFind() : this.closeFind();
  }

  /** Puts the bar where the active tab's top-right corner is (or removes it), and tells it what to show. */
  private syncFindOverlay(): void {
    if (!this.findOpen || !this.activeTabId) {
      this.findOverlay.hide();
      return;
    }
    // Where it is in one screen, split or not; it finds in the active side.
    this.findOverlay.show(this.computeMainBounds(this.targetLeftInset(), this.targetTopInset()));
    this.pushFindState();
  }

  private pushFindState(): void {
    this.findOverlay.sync({ query: this.findQuery, options: this.findOptions, result: this.findResult });
  }

  /** Sends a command to the active tab's page, which does the searching. */
  private sendFindCommand(command: FindCommand): void {
    const view = this.activeTabId ? this.views.get(this.activeTabId) : undefined;
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.send(IpcChannel.FindCommand, command);
    }
  }

  /** Searches the active tab for the bar's current query and switches. An empty query just clears. */
  private runFind(): void {
    if (!this.findOpen || !this.canFind(this.activeTabId)) {
      return;
    }
    this.sendFindCommand({
      action: 'search',
      query: this.findQuery,
      options: this.findOptions,
      color: getCurrentAccent(),
    });
    if (this.findQuery === '') {
      this.findResult = NO_FIND_RESULT;
      this.pushFindState();
    }
  }

  /**
   * A page's answer to a search: how many matches and which is current.
   * Only the active tab's answer counts — a page that was searched and then
   * switched away from may still be replying.
   */
  private handleFindResult(sender: WebContents, raw: unknown): void {
    const parsed = findResultRequestSchema.safeParse(raw);
    const activeView = this.activeTabId ? this.views.get(this.activeTabId) : undefined;
    if (!parsed.success || !this.findOpen || !activeView || activeView.webContents !== sender) {
      return;
    }
    this.findResult = parsed.data;
    this.pushFindState();
  }

  /** Called when a tab is activated: clears the tab left behind, and searches the new one — or closes the bar if find can't search it. */
  private refreshFindAfterTabChange(previousTabId: string | null): void {
    if (!this.findOpen) {
      return;
    }
    const previous = previousTabId && previousTabId !== this.activeTabId ? this.views.get(previousTabId) : undefined;
    if (previous && !previous.webContents.isDestroyed()) {
      previous.webContents.send(IpcChannel.FindCommand, { action: 'clear' } satisfies FindCommand);
    }
    if (!this.canFind(this.activeTabId)) {
      this.closeFind();
      return;
    }
    this.findResult = NO_FIND_RESULT;
    this.syncFindOverlay();
    this.runFind();
  }

  // ── Pen ──────────────────────────────────────────────────────────────

  /**
   * Turns the pen tool on or off (Ctrl+P, or `PageActions`' toolbar button)
   * for this window. Like the highlighter/comment tool, there's no separate
   * overlay to (un)mount; the active tab's own preload
   * (`src/preload/tabPen.ts`) does the draw/hover/delete work directly in
   * the page, so this just pushes the new state down to it.
   * @param enabled Whether the pen tool should be on.
   * @returns The full browser state after the change.
   */
  public setPen(enabled: boolean): BrowserState {
    // Same rule as the toolbar button's disabled state — see `canEnableTool`.
    if (enabled && !this.canEnableTool('pen')) {
      return this.getState();
    }
    // Mutually exclusive with the laser pointer, the highlighter, and the
    // comment tool — see `setLaserPointer`'s own comment.
    if (enabled && this.laserPointerActive) {
      this.setLaserPointer(false);
    }
    if (enabled && this.highlighterActive) {
      this.setHighlighter(false);
    }
    if (enabled && this.commentToolActive) {
      this.setCommentTool(false);
    }
    if (enabled && this.textToolActive) {
      this.setTextTool(false);
    }
    if (enabled && this.cropActive) {
      this.setCrop(false);
    }
    this.penActive = enabled;
    this.pushPenState();
    this.nudgeActiveTabCursor();
    this.emitState();
    return this.getState();
  }

  /** Toggles the pen tool to whichever state it isn't currently in. */
  public togglePen(): BrowserState {
    return this.setPen(!this.penActive);
  }

  /** Whether this window currently has the pen tool on — read by `main/index.ts`'s accent-color broadcast, same reasoning as `isHighlighterActive`. */
  public isPenActive(): boolean {
    return this.penActive;
  }

  /** Pushes this window's current pen on/off state to whichever tab is active — call whenever that could have changed: `setPen` itself and `activateTab`. */
  private pushPenState(): void {
    if (this.activeTabId) {
      this.pushPenStateTo(this.activeTabId);
    }
  }

  /** Pushes this window's current pen on/off state to a specific tab, active or not — `wireEvents`'s own `dom-ready` handler uses this directly, same reasoning as `pushHighlighterStateTo`. */
  private pushPenStateTo(tabId: string): void {
    this.penController.syncState(tabId, this.penActive);
  }

  // ── Crop ─────────────────────────────────────────────────────────────

  /**
   * Turns the PDF crop tool on or off (Ctrl+Shift+X, or `PageActions`' toolbar
   * button) for this window. Only a PDF tab's page draws anything for it; the
   * boxes themselves are edited in the page and persisted with the document's
   * other marks (see `PdfAnnotationStore`).
   * @param enabled Whether the crop tool should be on.
   * @returns The full browser state after the change.
   */
  public setCrop(enabled: boolean): BrowserState {
    // Same rule as the toolbar button's disabled state — see `canEnableTool`.
    if (enabled && !this.canEnableTool('crop')) {
      return this.getState();
    }
    // Mutually exclusive with the other pointer tools — see `setLaserPointer`'s own comment.
    if (enabled && this.laserPointerActive) {
      this.setLaserPointer(false);
    }
    if (enabled && this.highlighterActive) {
      this.setHighlighter(false);
    }
    if (enabled && this.commentToolActive) {
      this.setCommentTool(false);
    }
    if (enabled && this.textToolActive) {
      this.setTextTool(false);
    }
    if (enabled && this.penActive) {
      this.setPen(false);
    }
    this.cropActive = enabled;
    this.pushCropState();
    // The page needs keyboard focus to see Shift (multi-crop) and Ctrl+Z; a toolbar click leaves it with the chrome.
    const activeView = enabled && this.activeTabId ? this.views.get(this.activeTabId) : undefined;
    if (activeView && this.states.get(this.activeTabId!)?.kind === 'pdf' && !activeView.webContents.isDestroyed()) {
      activeView.webContents.focus();
    }
    this.emitState();
    return this.getState();
  }

  /** Toggles the crop tool; does nothing unless the active tab is a PDF (there is nothing to crop elsewhere, and the shortcut mustn't switch on an invisible tool). */
  public toggleCrop(): BrowserState {
    const active = this.activeTabId ? this.states.get(this.activeTabId) : undefined;
    if (!this.cropActive && active?.kind !== 'pdf') {
      return this.getState();
    }
    return this.setCrop(!this.cropActive);
  }

  /** Pushes the crop tool's on/off state to whichever tab is active — call on `setCrop` and `activateTab`. */
  private pushCropState(): void {
    if (this.activeTabId) {
      this.pushCropStateTo(this.activeTabId);
    }
  }

  /** Pushes the crop tool's on/off state to one PDF tab (others have no crop tool, so they're never told). */
  private pushCropStateTo(tabId: string): void {
    const view = this.views.get(tabId);
    if (view && !view.webContents.isDestroyed() && this.states.get(tabId)?.kind === 'pdf') {
      view.webContents.send(IpcChannel.PdfCropState, { active: this.cropActive });
    }
  }

  // ── Revert page ──────────────────────────────────────────────────────

  /**
   * Reverts a tab's page back to how it looked before any highlighting,
   * drawing, or commenting on it — Ctrl+Shift+R, or `PageActions`' toolbar
   * button. Unlike the laser pointer/highlighter/comment tool/pen, this
   * isn't a toggle: it's a single one-shot action with no on/off state of
   * its own, so it doesn't touch
   * `laserPointerActive`/`highlighterActive`/`commentToolActive`/`penActive`
   * at all. A no-op for a tab that doesn't exist or isn't a browser tab — a
   * terminal has none of the three to revert.
   * @param id The tab to revert.
   * @returns The full browser state (unchanged by this action beyond
   *   whatever `HighlighterController`/`CommentController`/`PenController`
   *   push to the tab's own preload).
   */
  public revertPage(id: string): BrowserState {
    // Nothing can have been marked on the blank home page or an empty PDF tab — the toolbar button is disabled there, and so is this.
    const target = this.states.get(id);
    if (
      (target?.kind === 'browser' && target.url === HOME_URL) ||
      ((target?.kind === 'pdf' || target?.kind === 'markdown') && target.fileName === null)
    ) {
      return this.getState();
    }
    if (this.states.get(id)?.kind === 'browser') {
      this.highlighter.clearTab(id);
      this.commentController.clearTab(id);
      this.textBoxController.clearTab(id);
      this.penController.clearTab(id);
    } else if (this.states.get(id)?.kind === 'pdf') {
      // The page clears its own marks and reports the empty set back, which removes them from the store too.
      this.views.get(id)?.webContents.send(IpcChannel.PdfClear);
    } else if (this.states.get(id)?.kind === 'markdown') {
      this.views.get(id)?.webContents.send(IpcChannel.MarkdownClear);
    }
    return this.getState();
  }

  /** Pushes this window's current highlighter on/off state to whichever tab is active — call whenever that could have changed: `setHighlighter` itself and `activateTab` (a different tab is now the one showing it). */
  private pushHighlighterState(): void {
    if (this.activeTabId) {
      this.pushHighlighterStateTo(this.activeTabId);
    }
  }

  /** Pushes this window's current highlighter on/off state to a specific tab, active or not — `wireEvents`' own `dom-ready` handler uses this directly (rather than `pushHighlighterState`) since a fresh document has a fresh preload that's never been told anything, whether or not that tab happens to be the active one right now. */
  private pushHighlighterStateTo(tabId: string): void {
    // Terminal tabs have no highlighter; never tell one it's on.
    this.highlighter.syncState(tabId, this.highlighterActive && this.states.get(tabId)?.kind !== 'terminal');
  }

  /**
   * Forces Chromium to immediately re-evaluate the active tab's cursor at
   * its current position, rather than leaving the old pointer shape on
   * screen until the next time the mouse actually moves. A CSS `cursor`
   * change alone doesn't repaint on its own — Chromium only calls the OS's
   * `SetCursor` while processing a real input event, never as a side effect
   * of style recalculation — so toggling the highlighter tool while the
   * mouse sits still left the pointer showing whatever it was already
   * showing. Synthesizes a zero-distance `mouseMove` through
   * `sendInputEvent` (a real input event injected into Chromium's own
   * pipeline, unlike a DOM-dispatched `MouseEvent`, which never reaches the
   * OS cursor at all) at the cursor's actual current screen position,
   * translated into the active tab's own view-local coordinates. A no-op if
   * there's no active tab or the cursor isn't currently over its content
   * area (e.g. it's sitting over the toolbar when Ctrl+J is pressed) —
   * nothing to nudge in either case.
   */
  private nudgeActiveTabCursor(): void {
    if (!this.activeTabId) {
      return;
    }
    const view = this.views.get(this.activeTabId);
    if (!view) {
      return;
    }
    // Wherever the active tab's view is: the whole area, or its side of a split.
    const bounds = view.getBounds();
    const cursor = screen.getCursorScreenPoint();
    const contentBounds = this.window.getContentBounds();
    const x = cursor.x - contentBounds.x - bounds.x;
    const y = cursor.y - contentBounds.y - bounds.y;
    if (x < 0 || y < 0 || x > bounds.width || y > bounds.height) {
      return;
    }
    view.webContents.sendInputEvent({ type: 'mouseMove', x, y });
  }

  // ── Zoom ─────────────────────────────────────────────────────────────

  /**
   * Zooms in on the active tab's own content — its `WebContentsView` only,
   * never `this.window.webContents` (the chrome's sidebar, tab strip, and
   * toolbar), which is what Electron's built-in `zoomIn` menu role would
   * otherwise zoom instead. Works identically for a terminal tab, since
   * it's just as much its own `WebContentsView` as a browser tab's page.
   * @returns The full browser state after the change, including the new
   *   `zoomPercent` (`ZoomPercentInput` reads it from there).
   */
  public zoomIn(): BrowserState {
    this.adjustZoom(ZOOM_PERCENT_STEP);
    return this.getState();
  }

  /** Zooms out on the active tab's own content. See `zoomIn`. */
  public zoomOut(): BrowserState {
    this.adjustZoom(-ZOOM_PERCENT_STEP);
    return this.getState();
  }

  /** Resets the active tab's own content back to its native 100% zoom. */
  public resetZoom(): BrowserState {
    if (this.activeTabId && this.isZoomable(this.activeTabId)) {
      this.setZoomPercent(this.activeTabId, ZOOM_PERCENT_DEFAULT);
    }
    return this.getState();
  }

  /**
   * Sets the active tab's zoom to an exact percent — `ZoomPercentInput`,
   * typing a number directly rather than stepping by `ZOOM_PERCENT_STEP`.
   * Clamped and rounded to a whole number regardless of what's passed; the
   * input itself already restricts what a person can type to digits within
   * range (see that component), but this is the actual enforcement point.
   * @param percent The requested zoom percent.
   * @param tabId The tab to zoom, if not the active one: the split's right side (its own zoom in the toolbar). Any
   *   other tab is left be.
   * @returns The full browser state after the change.
   */
  public setZoom(percent: number, tabId?: string): BrowserState {
    const target = tabId ?? this.activeTabId;
    const onScreen = target === this.activeTabId || target === this.splitOtherTabId();
    if (target && onScreen && this.isZoomable(target)) {
      this.setZoomPercent(target, clampZoomPercent(percent));
    }
    return this.getState();
  }

  /**
   * One Ctrl+mouse-wheel tick on a tab's own view: steps that tab's zoom by
   * `ZOOM_PERCENT_WHEEL_STEP`. Resolved from the sender's `webContents`
   * (a tab's preload doesn't know its own id), and acts on that tab rather
   * than `activeTabId` — wheel events only reach a visible view, but in
   * split view the one under the pointer needn't be the active one.
   * @param sender The `webContents` the wheel event came from.
   * @param direction `1` to zoom in, `-1` to zoom out.
   * @param coarse Shift was held too: step by `ZOOM_PERCENT_WHEEL_STEP_COARSE` instead.
   */
  public wheelZoom(sender: WebContents, direction: 1 | -1, coarse = false): void {
    for (const [id, view] of this.views) {
      if (view.webContents === sender) {
        if (!this.isZoomable(id)) {
          return;
        }
        const current = this.registry.zoomPercentByTabId.get(id) ?? ZOOM_PERCENT_DEFAULT;
        const step = coarse ? ZOOM_PERCENT_WHEEL_STEP_COARSE : ZOOM_PERCENT_WHEEL_STEP;
        this.setZoomPercent(id, clampZoomPercent(current + direction * step));
        return;
      }
    }
  }

  /**
   * @param deltaPercent `±ZOOM_PERCENT_STEP`.
   */
  /** Whether a tab can be zoomed: every kind but the History, Bookmarks and Secrets tabs, whose pages are fixed-size tables with no zoom control. */
  private isZoomable(id: string): boolean {
    const kind = this.states.get(id)?.kind;
    return kind !== 'history' && kind !== 'bookmarks' && kind !== 'secrets';
  }

  private adjustZoom(deltaPercent: number): void {
    if (!this.activeTabId || !this.isZoomable(this.activeTabId)) {
      return;
    }
    const current = this.registry.zoomPercentByTabId.get(this.activeTabId) ?? ZOOM_PERCENT_DEFAULT;
    this.setZoomPercent(this.activeTabId, clampZoomPercent(current + deltaPercent));
  }

  /**
   * Records `id`'s zoom percent, pushes it to that tab's own view (see
   * `applyZoom`), and pushes the change to every window's own renderer —
   * unlike `applyZoom` alone (also called after a fresh navigation, where
   * nothing about the zoom itself changed), this is the entry point that
   * actually changes what `zoomPercent` a person reading `BrowserState`
   * sees.
   * @param id The tab to zoom.
   * @param percent The new zoom percent (already clamped by the caller).
   */
  private setZoomPercent(id: string, percent: number): void {
    this.registry.zoomPercentByTabId.set(id, percent);
    this.applyZoom(id);
    this.emitState();
  }

  /**
   * Re-sends `id`'s current stored zoom percent to its own view — via its
   * preload's `zoom:apply` listener (`webFrame.setZoomLevel`, converting
   * from percent to Chromium's own logarithmic units right at the point of
   * sending), not `view.webContents.zoomLevel` set directly from here.
   * That setter applies **per origin**, shared by every `webContents`
   * currently showing (or later loading) the same origin — which, since a
   * terminal tab's `terminal.html` and the chrome's own page are typically
   * served from the very same origin (the dev server in development; a
   * `file:`/custom-protocol origin in a packaged build too, depending on
   * how the chrome and a tab happen to be loaded), meant zooming a
   * terminal tab also silently zoomed the sidebar and toolbar right along
   * with it. `webFrame.setZoomLevel`, called from inside that specific
   * renderer instead, is scoped to that one frame only.
   *
   * Called both by `setZoomPercent` (something actually changed) and by
   * `wireEvents`'s `did-finish-load` (nothing changed, but a fresh
   * navigation is a fresh document, which resets `webFrame`'s own
   * frame-local zoom back to 0 unless this reapplies whatever the tab's
   * own zoom actually is). A no-op if the tab was never zoomed (nothing
   * stored, native 100% is already correct) or no longer exists.
   * @param id The tab whose stored zoom percent to (re)apply.
   */
  private applyZoom(id: string): void {
    const percent = this.registry.zoomPercentByTabId.get(id);
    if (percent === undefined) {
      return;
    }
    const zoomLevel = Math.log(percent / 100) / Math.log(1.2);
    this.views.get(id)?.webContents.send(IpcChannel.ZoomApply, zoomLevel);
  }

  // ── Sidebar ──────────────────────────────────────────────────────────

  /**
   * Shows or hides the workspace sidebar, animating both the native tab
   * content's bounds and (via the pushed `sidebarVisible` state) the
   * sidebar's own CSS transition together, so the content edge and the
   * sliding sidebar move in step instead of one snapping ahead of the
   * other. The top inset doesn't move — `fromTop`/`toTop` are both
   * whatever Focus Mode currently has it at.
   * @returns The full browser state after the change (the animation
   *   itself keeps running past this point; bounds settle asynchronously).
   */
  public toggleSidebar(): BrowserState {
    return this.startSidebarSlide(() => {
      this.sidebarVisible = !this.sidebarVisible;
    });
  }

  /**
   * Starts a sidebar's slide (`slideSidebar`), unless one is already under way: a press mid-slide is dropped rather
   * than fighting it for the views' bounds.
   * @param flip Shows or hides the sidebar, at the moment the slide begins.
   * @returns The full browser state; the slide itself goes on after.
   */
  private startSidebarSlide(flip: () => void): BrowserState {
    if (this.sidebarSliding) {
      return this.getState();
    }
    this.sidebarSliding = true;
    void this.slideSidebar(flip).finally(() => {
      this.sidebarSliding = false;
    });
    return this.getState();
  }

  /**
   * Shows the Tools sidebar in full or hides it to its rail of icons, the same slide as the workspace sidebar's
   * (`slideSidebar`): a picture of the pages moves with the chrome while the live views settle out of sight. In Focus
   * Mode the sidebar is gone whichever way it's set, so only the setting changes.
   * @returns The full browser state after the change; the slide itself goes on after.
   */
  /** @returns Whether each sidebar is open in this window, for the session to remember when it closes. */
  public getSidebarLayout(): SidebarLayout {
    return { workspaces: this.sidebarVisible, tools: this.toolsSidebarVisible };
  }

  public toggleToolsSidebar(): BrowserState {
    return this.startSidebarSlide(() => {
      this.toolsSidebarVisible = !this.toolsSidebarVisible;
    });
  }

  /**
   * The chrome has a sidebar slide's snapshot on screen (`ContentSnapshotShown`).
   * @param id The snapshot's id.
   */
  public contentSnapshotShown(id: number): void {
    this.contentSnapshot.shown(id);
  }

  /**
   * Shows or hides the sidebar (`toggleSidebar`). The chrome slides it by
   * CSS; the pages beside it are native views, which don't animate. So a
   * picture of them goes up in the chrome's own tab area first, which its
   * layout moves in step with the sidebar, while the live views lay out at
   * their new size out of sight; once the slide is done they come back,
   * already painted, over the picture. Without a picture (nothing on show,
   * or the capture failed), the views are resized frame by frame instead
   * (`animateBoundsInset`). Serves both sidebars: the left one moves the views' left edge, the Tools one their right.
   * @param flip Shows or hides the sidebar, once the picture is up.
   */
  private async slideSidebar(flip: () => void): Promise<void> {
    // Captured before flipping the flag below, same reasoning as
    // `setFocusMode`'s own `fromLeft` — whatever the sidebar is actually
    // showing right now (which, mid-Focus-Mode, is 0 regardless of
    // `sidebarVisible` — see `targetLeftInset`).
    const fromLeft = this.targetLeftInset();
    const top = this.targetTopInset();
    const willMove = !this.focusMode && this.htmlFullScreenTabId === null;
    const panes = willMove ? this.panesOnShow(fromLeft, top) : [];
    // Owns the views' bounds from here: a resize meanwhile waits for the slide.
    const token = ++this.boundsAnimationToken;
    this.isAnimatingBounds = true;
    const area = this.computeMainBounds(fromLeft, top);
    const [width = 0, height = 0] = this.window.getContentSize();
    const snapshotId =
      panes.length > 0
        ? await this.contentSnapshot.cover(
            panes,
            area,
            // Measured from the tab area's own edges, which the snapshot is pinned to: its right edge is the Tools
            // sidebar's left one, not the window's.
            {
              left: area.x - fromLeft,
              top: area.y - top,
              right: width - this.rightInsetNow - area.x - area.width,
              bottom: height - area.y - area.height,
            },
            this.framesActiveView() ? CONTENT_FRAME_RADIUS_PX - CONTENT_FRAME_BORDER_PX : 0,
          )
        : null;
    if (token !== this.boundsAnimationToken || this.window.isDestroyed()) {
      // Superseded while capturing (Focus Mode toggled): that animation owns the bounds now.
      if (snapshotId !== null) {
        this.contentSnapshot.uncover(snapshotId, 0);
      }
      return;
    }
    flip();
    this.emitState();
    const toLeft = this.targetLeftInset();
    if (snapshotId === null) {
      this.animateBoundsInset(fromLeft, toLeft, top, top);
      return;
    }
    // Out of sight but still drawn (a hidden page wouldn't paint), at the size the slide ends on.
    this.rightInsetNow = this.targetRightInset();
    this.applyBounds(toLeft, top);
    for (const { view } of panes) {
      const bounds = view.getBounds();
      view.setBounds({ ...bounds, x: bounds.x + width + PARKED_OFFSET_PX });
    }
    await new Promise((resolve) => setTimeout(resolve, SIDEBAR_TOGGLE_DURATION_MS));
    if (this.window.isDestroyed()) {
      return;
    }
    if (token === this.boundsAnimationToken) {
      this.isAnimatingBounds = false;
      this.applyBounds(toLeft, top);
    }
    this.contentSnapshot.uncover(snapshotId);
  }

  /**
   * The views the tab area shows for a sidebar/chrome inset: the active tab's,
   * or a split pair, each with where it sits.
   * @param left Horizontal inset, in CSS pixels.
   * @param top Vertical inset, in CSS pixels.
   */
  private panesOnShow(left: number, top: number): { view: WebContentsView; bounds: Rect }[] {
    const main = this.computeMainBounds(left, top);
    const panes: { view: WebContentsView | undefined; bounds: Rect }[] = [];
    if (this.splitView) {
      const { primary, secondary } = this.computeSplitPanes(left, top);
      panes.push({ view: this.views.get(this.splitView.primaryTabId), bounds: primary });
      panes.push({ view: this.views.get(this.splitView.secondaryTabId), bounds: secondary });
    } else if (this.activeTabId) {
      panes.push({ view: this.views.get(this.activeTabId), bounds: main });
    }
    return panes.filter(
      (pane): pane is { view: WebContentsView; bounds: Rect } =>
        pane.view !== undefined && !pane.view.webContents.isDestroyed() && pane.view.getVisible(),
    );
  }

  /**
   * Drives the sidebar's and/or chrome's show/hide transition frame by
   * frame, since a native `WebContentsView`'s bounds — unlike a CSS
   * `width`/`height` — don't animate on their own. Used by both
   * `toggleSidebar` (left inset only) and `setFocusMode` (left and top
   * together, since entering Focus Mode hides the sidebar too). Cancels
   * itself if superseded by a newer call (`boundsAnimationToken` changes)
   * so rapid toggles don't fight over the view's bounds.
   * @param fromLeft Left inset at the start of the animation.
   * @param toLeft Left inset the animation settles on.
   * @param fromTop Top inset at the start of the animation.
   * @param toTop Top inset the animation settles on.
   */
  private animateBoundsInset(fromLeft: number, toLeft: number, fromTop: number, toTop: number): void {
    const token = ++this.boundsAnimationToken;
    this.isAnimatingBounds = true;
    const start = Date.now();
    // The right edge moves with every slide too: to the Tools sidebar's new width, or to 0 entering Focus Mode.
    const fromRight = this.rightInsetNow;
    const toRight = this.targetRightInset();
    const step = (): void => {
      if (token !== this.boundsAnimationToken) {
        return;
      }
      const t = Math.min(1, (Date.now() - start) / SIDEBAR_TOGGLE_DURATION_MS);
      // Ease-out cubic — matches the `cubic-bezier(0.33, 1, 0.68, 1)` timing
      // function on the sidebar's and chrome's own CSS transitions (see
      // workspace-bar.css and app.css).
      const eased = 1 - (1 - t) ** 3;
      this.rightInsetNow = fromRight + (toRight - fromRight) * eased;
      this.applyBounds(fromLeft + (toLeft - fromLeft) * eased, fromTop + (toTop - fromTop) * eased);
      if (t < 1) {
        setTimeout(step, 16);
      } else {
        this.isAnimatingBounds = false;
      }
    };
    step();
  }

  // ── Navigation shortcuts ─────────────────────────────────────────────

  /**
   * Cycles the active tab within the active workspace, wrapping around at
   * either end. A no-op with zero or one tab in the workspace. Only cycles
   * through tabs this window's own tab bar actually lists (see
   * `shouldListTabForThisWindow`) — otherwise Ctrl+Right/Left could land on
   * a linked twin (see `createLinkedTwin`) this window doesn't even show a
   * row for, stealing it away from wherever it's actually mounted.
   *
   * The workspace's split pair (`pairByWorkspace`) is one stop, as the row
   * draws it as one tab: from either of its two the step goes to the tab
   * beside the pair, never to the other of the two; and a step onto the pair
   * shows its split again (`activateTab`).
   * @param direction `1` for the next tab, `-1` for the previous one.
   * @returns The full browser state after the change.
   */
  public cycleTab(direction: 1 | -1): BrowserState {
    const pair = this.pairByWorkspace.get(this.activeWorkspaceId);
    // Each stop once: the pair by its left tab, its right one left out.
    const stops = this.listedTabIds(this.activeWorkspaceId).filter((tabId) => tabId !== pair?.secondaryTabId);
    const current = this.activeTabId && this.activeTabId === pair?.secondaryTabId ? pair.primaryTabId : this.activeTabId;
    const currentIndex = current ? stops.indexOf(current) : -1;
    if (stops.length <= 1 || currentIndex === -1) {
      return this.getState();
    }
    const nextIndex = (currentIndex + direction + stops.length) % stops.length;
    return this.activateTab(stops[nextIndex]!);
  }

  /**
   * Cycles the active workspace, wrapping around at either end. A no-op
   * with only one workspace.
   * @param direction `1` for the next workspace, `-1` for the previous one.
   * @returns The full browser state after the change.
   */
  public cycleWorkspace(direction: 1 | -1): BrowserState {
    const workspaceIds = Array.from(this.workspaces.keys());
    if (workspaceIds.length <= 1) {
      return this.getState();
    }
    const currentIndex = workspaceIds.indexOf(this.activeWorkspaceId);
    const nextIndex = (currentIndex + direction + workspaceIds.length) % workspaceIds.length;
    return this.switchWorkspace(workspaceIds[nextIndex]!);
  }

  /**
   * Grabs a tab for keyboard reordering (Ctrl+Space held) — the keyboard
   * equivalent of picking it up with the mouse, down to sharing the same
   * `--dragging` blue highlight in the tab bar (see `TabBar.tsx`, which
   * reads `grabbedTabId` off this state the same way it reads a live
   * mouse-drag's `draggedId`). `nudgeTab` moves it while held; releasing
   * Ctrl or Space (`releaseGrabbedTab`) drops it in place.
   * @param id The tab to grab. A no-op if it doesn't exist.
   */
  public grabTabForReorder(id: string): void {
    if (!this.states.has(id)) {
      return;
    }
    this.grabbedTabId = id;
    if (this.grabMaxDurationTimeout !== null) {
      clearTimeout(this.grabMaxDurationTimeout);
    }
    this.grabMaxDurationTimeout = setTimeout(() => this.releaseGrabbedTab(), GRAB_MAX_DURATION_MS);
    this.emitState();
  }

  /** Ends keyboard reorder mode, if it's active — dropping the grabbed tab wherever `nudgeTab` last left it. */
  public releaseGrabbedTab(): void {
    this.disarmSpaceHoldTimeout();
    if (this.grabMaxDurationTimeout !== null) {
      clearTimeout(this.grabMaxDurationTimeout);
      this.grabMaxDurationTimeout = null;
    }
    if (this.grabbedTabId === null) {
      return;
    }
    this.grabbedTabId = null;
    this.emitState();
  }

  /**
   * (Re)starts the grace-period timer that stands in for Space's own
   * `keyUp`. Electron's `before-input-event` doesn't reliably deliver a
   * `keyUp` for a key whose `keyDown` was `preventDefault`-ed — which every
   * Space keydown is, while grabbed — so waiting for that event to release
   * the grab left it stuck blue with no way out. Control has no such
   * problem (its own keydown is never prevented, so its keyup is trustworthy
   * and still handled directly), but Space needs this instead: called on
   * the initial grab and on every subsequent Space repeat, so it only ever
   * fires once repeats actually stop, i.e. once Space is physically let go.
   */
  private armSpaceHoldTimeout(): void {
    this.disarmSpaceHoldTimeout();
    this.spaceHoldTimeout = setTimeout(() => this.releaseGrabbedTab(), SPACE_HOLD_GRACE_MS);
  }

  /** Cancels the pending timer from `armSpaceHoldTimeout`, if any. */
  private disarmSpaceHoldTimeout(): void {
    if (this.spaceHoldTimeout !== null) {
      clearTimeout(this.spaceHoldTimeout);
      this.spaceHoldTimeout = null;
    }
  }

  /**
   * Moves the grabbed tab one position left or right within its own
   * workspace — each Left/Right arrow press while Ctrl+Space is held. A
   * no-op past either end of its workspace's tabs. Expressed as a call to
   * `moveTab` (itself "insert before this id"), so it inherits that
   * method's own same-workspace guard and `states` rebuild rather than
   * duplicating them.
   * @param id The grabbed tab.
   * @param direction `1` to move it right (later), `-1` to move it left (earlier).
   */
  public nudgeTab(id: string, direction: 1 | -1): void {
    const workspaceId = this.states.get(id)?.workspaceId;
    const workspaceTabIds = Array.from(this.states.entries())
      .filter(([, state]) => state.workspaceId === workspaceId)
      .map(([tabId]) => tabId);
    const currentIndex = workspaceTabIds.indexOf(id);
    const targetIndex = currentIndex + direction;
    if (currentIndex === -1 || targetIndex < 0 || targetIndex >= workspaceTabIds.length) {
      return;
    }
    const beforeId = direction === 1 ? (workspaceTabIds[targetIndex + 1] ?? null) : workspaceTabIds[targetIndex]!;
    this.moveTab(id, beforeId);
  }

  /**
   * F1 to F7: the first to the seventh tab of the workspace, as this
   * window's tab bar lists them (a number past the last tab does nothing).
   * Handled with the window's own keys, ahead of everything else, so it works
   * from the chrome and from any tab, a terminal or a text box included —
   * none of them gives Ctrl+digit a meaning.
   * @param event The input event, so a handled key can `preventDefault`.
   * @param input Electron's parsed key info.
   * @returns Whether the key was one of them and was handled.
   */
  private handleTabJumpShortcut(event: Electron.Event, input: Electron.Input): boolean {
    const index = input.type === 'keyDown' ? tabJumpIndex(input) : null;
    if (index === null) {
      return false;
    }
    event.preventDefault();
    const tabId = this.listedTabIds(this.activeWorkspaceId)[index];
    if (!input.isAutoRepeat && tabId && tabId !== this.activeTabId) {
      this.activateTab(tabId);
    }
    return true;
  }

  /**
   * The Window menu's keyboard commands for this window: Ctrl+Alt+M minimizes it and
   * Ctrl+Alt+Enter maximizes or restores it. Also handled here, on the tab's own input,
   * because menu accelerators are unreliable while a tab's view holds the keyboard (see
   * `wireSharedInputHandling`). Matched by physical key (`code`), since on Windows
   * Ctrl+Alt is AltGr and can turn `key` into another character.
   * F1–F7 (`handleTabJumpShortcut`) ride along, from the chrome and from a tab's page alike.
   * @param event The input event, so a handled key can `preventDefault`.
   * @param input Electron's parsed key info.
   * @returns Whether the key was one of them and was handled.
   */
  private handleWindowShortcut(event: Electron.Event, input: Electron.Input): boolean {
    if (this.handleTabJumpShortcut(event, input)) {
      return true;
    }
    // Ctrl+Shift+? (the ? key, Shift+/): the search bar, emptied, from anywhere. Matched by physical key, since
    // Shift turns `/` into `?` (or something else on another layout).
    if (
      input.type === 'keyDown' &&
      (input.control || input.meta) &&
      input.shift &&
      !input.alt &&
      input.code === 'Slash'
    ) {
      event.preventDefault();
      if (!input.isAutoRepeat) {
        this.requestFocusAddressBar(true);
      }
      return true;
    }
    if (input.type !== 'keyDown' || input.isAutoRepeat || !(input.control || input.meta) || !input.alt || input.shift) {
      return false;
    }
    if (input.code !== 'KeyM' && input.code !== 'Enter' && input.code !== 'KeyS') {
      return false;
    }
    event.preventDefault();
    if (this.window.isDestroyed()) {
      return true;
    }
    if (input.code === 'KeyS') {
      // Split screen: the two selected tabs side by side, or back to one.
      this.toggleSplitScreen();
    } else if (input.code === 'KeyM') {
      this.window.minimize();
    } else if (this.window.isMaximized()) {
      this.window.unmaximize();
    } else {
      this.window.maximize();
    }
    return true;
  }

  /**
   * The chrome's half of the shortcuts whose menu entries are display-only
   * (see buildMenu.ts): Ctrl+←/→ (tabs), Ctrl+↑/↓ (workspaces), Alt+←/→
   * (back/forward), Ctrl+/ (address bar), and the tools' (see
   * `handleToolShortcut`). A registered accelerator would take these even from a text box
   * that edits with them, so they're dispatched here, after the text-box
   * check, instead; a tab's own view handles them in `wireSharedInputHandling`.
   * @param event The input event, so a handled key can `preventDefault`.
   * @param input Electron's parsed key info.
   * @returns Whether the key was one of them and was handled.
   */
  private handleTextSensitiveShortcut(event: Electron.Event, input: Electron.Input): boolean {
    if (input.type !== 'keyDown') {
      return false;
    }
    if (this.handleToolShortcut(event, input, this.activeTabId)) {
      return true;
    }
    const key = input.key.toLowerCase();
    const cmdOrCtrl = input.control || input.meta;
    if (input.alt && !cmdOrCtrl && !input.shift && (key === 'arrowleft' || key === 'arrowright')) {
      event.preventDefault();
      if (this.activeTabId) {
        if (key === 'arrowleft') {
          this.goBack(this.activeTabId);
        } else {
          this.goForward(this.activeTabId);
        }
      }
      return true;
    }
    if (!cmdOrCtrl || input.alt || input.shift) {
      return false;
    }
    switch (key) {
      case 'arrowleft':
      case 'arrowright':
        event.preventDefault();
        this.cycleTab(key === 'arrowright' ? 1 : -1);
        return true;
      case 'arrowup':
      case 'arrowdown':
        event.preventDefault();
        this.cycleWorkspace(key === 'arrowdown' ? 1 : -1);
        return true;
      case '/':
        event.preventDefault();
        // A held key repeats; only the first press counts.
        if (!input.isAutoRepeat) {
          this.requestFocusAddressBar();
        }
        return true;
      default:
        return false;
    }
  }

  /**
   * The toolbar tools' keyboard shortcuts — the laser pointer (Ctrl+I), pen
   * (Ctrl+P), highlighter (Ctrl+J), comments (Ctrl+M), text box (Ctrl+E),
   * Pan and Select (Alt+1, Alt+2), crop (Ctrl+Shift+X) and Revert
   * Annotations (Ctrl+Shift+R). Pressed in the chrome only: with the keyboard
   * in a page they're the page's (a web app binds the same keys), which is why
   * their menu entries are display-only (see buildMenu.ts) — a registered
   * accelerator takes its key before any page sees it.
   * @param event The input event, so a handled key can `preventDefault`.
   * @param input Electron's parsed key info.
   * @param tabId The tab the key acts on: the active one.
   * @returns Whether the key was one of them and was handled, so the caller looks no further.
   */
  private handleToolShortcut(event: Electron.Event, input: Electron.Input, tabId: string | null): boolean {
    if (input.type !== 'keyDown') {
      return false;
    }
    const pointerMode = pointerModeShortcut(input);
    if (!isToolShortcut(input) && !pointerMode) {
      return false;
    }
    event.preventDefault();
    // A held key repeats; these are toggles, so only the first press counts.
    if (input.isAutoRepeat) {
      return true;
    }
    if (pointerMode) {
      if (tabId) {
        this.setPointerMode(tabId, pointerMode);
      }
      return true;
    }
    switch (input.key.toLowerCase()) {
      case 'i':
        this.toggleLaserPointer();
        break;
      case 'p':
        this.togglePen();
        break;
      case 'j':
        this.toggleHighlighter();
        break;
      case 'm':
        this.toggleCommentTool();
        break;
      case 'e':
        this.toggleTextTool();
        break;
      case 'x':
        this.toggleCrop();
        break;
      case 'r':
        // Confirmed first, as the Tools sidebar's Revert is: the chrome asks for "REVERT" to be typed, then reverts.
        if (tabId) {
          this.requestRevert();
        }
        break;
      default:
        break;
    }
    return true;
  }

  /**
   * Which extra chords the text box with the caret in a tab's page binds for
   * itself (see `isTextEditingChord`): a note's editor binds its own, and a web
   * page's rich editor binds Ctrl+B/I/U.
   * @param id The tab.
   * @param wc The tab's own webContents.
   */
  private textBoxContextOf(id: string, wc: WebContents): TextBoxContext {
    const kind = this.states.get(id)?.kind;
    return { codeEditor: kind === 'markdown', richText: kind === 'browser' && editableKindOf(wc.id) === 'rich' };
  }

  /**
   * The Ctrl+Space keyboard-reorder gesture's input handling — grab,
   * nudge, release — shared between every tab's own `before-input-event`
   * (`wireEvents`) and the chrome window's own (wired in the constructor).
   * Both are needed: a mouse drag-and-drop, a click on a workspace pill,
   * or Tab-navigating into the tab bar can all leave OS keyboard focus on
   * the chrome instead of tab content, and unlike the tab-scoped shortcuts
   * below (which have a menu-accelerator fallback for exactly that case),
   * this gesture has no accelerator equivalent — accelerators fire once
   * per press, with no notion of "held" or a matching key-up.
   * @param event The input event, so a handled key can `preventDefault`.
   * @param input Electron's parsed key info.
   * @returns Whether this event belonged to the gesture and was fully
   *   handled — callers should stop processing it themselves when `true`.
   */
  private handleReorderGestureInput(event: Electron.Event, input: Electron.Input): boolean {
    const key = input.key.toLowerCase();

    if (input.type === 'keyUp') {
      if (key === 'control' || key === ' ') {
        this.releaseGrabbedTab();
        return true;
      }
      return false;
    }

    if (input.type !== 'keyDown') {
      return false;
    }

    // While a tab is grabbed, every key involved in the gesture is fully
    // consumed here — Left/Right nudges it (auto-repeat deliberately
    // allowed, unlike every other shortcut in this app, so holding an
    // arrow keeps nudging). Space's own repeats (not just the very first
    // press) re-arm the grace-period timer that stands in for its
    // unreliable `keyUp` — see `armSpaceHoldTimeout`. Control's repeats
    // are left alone entirely (not even `preventDefault`-ed): unlike
    // Space, its keydown is never prevented in the first place, so its
    // own keyUp stays a trustworthy release signal.
    if (this.grabbedTabId !== null) {
      if (key === 'arrowleft' || key === 'arrowright') {
        event.preventDefault();
        this.nudgeTab(this.grabbedTabId, key === 'arrowright' ? 1 : -1);
        // The OS only auto-repeats whichever key was pressed most
        // recently, so a Left/Right press while Space is held stops
        // Space's own repeats from arriving at all — without this, only
        // `armSpaceHoldTimeout`'s Space-repeat branch below would ever
        // re-arm the grace timer, which would then fire (and drop the
        // grab) mid-nudge even though both keys are still physically
        // held. Nudging is itself proof the gesture is still active, so
        // it re-arms the same timer Space's own repeats do.
        this.armSpaceHoldTimeout();
        return true;
      }
      if (key === ' ') {
        event.preventDefault();
        // A brand-new (non-repeat) Ctrl+Space while something's already
        // grabbed resets the grab onto whatever tab is active *now*,
        // instead of just extending the existing hold. This is also the
        // escape hatch if a grab ever gets stuck (its release signal
        // missed for whatever reason): pressing Ctrl+Space again always
        // breaks out of it rather than silently doing nothing forever.
        if (input.control && !input.isAutoRepeat && this.activeTabId) {
          this.grabTabForReorder(this.activeTabId);
        }
        this.armSpaceHoldTimeout();
      }
      return true;
    }

    // Ctrl+Space grabs the active tab for keyboard reordering; see
    // `grabTabForReorder` and the grabbed-mode branch just above.
    if (input.control && key === ' ' && !input.isAutoRepeat) {
      if (this.activeTabId) {
        event.preventDefault();
        this.grabTabForReorder(this.activeTabId);
        this.armSpaceHoldTimeout();
      }
      return true;
    }

    return false;
  }

  // ── Cross-window UI requests ─────────────────────────────────────────

  /** Asks this window's chrome to open the workspace images popup (menu/accelerator-driven) — same hand-off as `requestTabSearch`. */
  public requestWorkspaceImages(): void {
    this.window.webContents.focus();
    this.window.webContents.send(IpcChannel.UiOpenWorkspaceImages);
  }

  /**
   * Asks this window's chrome to open the tab search overlay
   * (menu/accelerator-driven). Explicitly hands native OS keyboard focus
   * to the chrome's own `webContents` first — it and a tab's content are
   * separate native surfaces, so without this, the overlay's input would
   * render but the tab still catch the keystrokes typed into it.
   */
  public requestTabSearch(): void {
    this.window.webContents.focus();
    this.window.webContents.send(IpcChannel.UiOpenTabSearch);
  }

  /**
   * Asks this window's chrome to focus the address bar
   * (menu/accelerator-driven, Ctrl+/). See `requestTabSearch` for why
   * `webContents.focus()` has to happen here too.
   * @param clear Whether to empty it too (Ctrl+Shift+?), ready for a new search.
   */
  public requestFocusAddressBar(clear = false): void {
    this.window.webContents.focus();
    this.window.webContents.send(IpcChannel.UiFocusAddressBar, { clear });
  }

  /**
   * Asks this window's chrome to focus (and select) `ZoomControl`'s
   * percent field (menu/accelerator-driven, Ctrl+Shift+0). See
   * `requestTabSearch` for why `webContents.focus()` has to happen here
   * too.
   */
  public requestFocusZoom(): void {
    if (this.activeTabId && !this.isZoomable(this.activeTabId)) {
      return;
    }
    this.window.webContents.focus();
    this.window.webContents.send(IpcChannel.UiFocusZoom);
  }

  /**
   * Hands native OS keyboard focus back to this window's own chrome
   * `webContents` — the Ctrl+` escape hatch out of a terminal tab (see
   * `wireSharedInputHandling`), so every other chrome shortcut (which is
   * otherwise deliberately left alone while a terminal tab holds the
   * keyboard, to avoid stealing keys the shell itself binds) starts
   * working again. Unlike `requestFocusAddressBar`/`requestTabSearch`,
   * there's no specific control to focus afterward — a terminal tab has no
   * address bar — so this is just the bare `webContents.focus()` half.
   */
  public focusChrome(): void {
    // Given to the chrome on purpose (Shift+Escape, Ctrl+`): the tab is left without the keyboard.
    if (this.activeTabId) {
      pageHadKeyboard.set(this.activeTabId, false);
    }
    this.window.webContents.focus();
  }

  /**
   * Leaves a tab just selected without the keyboard, whatever it had when it was last left: the chrome keeps it, so the
   * page shows unfocused until a click in it, or Escape in the chrome, hands it over. Its remembered focus
   * (`pageHadKeyboard`) is let go with it, so nothing later gives the page the keyboard back unasked.
   * @param id The tab selected.
   */
  private showWithoutKeyboard(id: string): void {
    pageHadKeyboard.set(id, false);
    if (!this.window.isDestroyed()) {
      this.window.webContents.focus();
    }
  }

  /**
   * Gives the keyboard back to a tab shown again after a preview of it (`restoreTabPreview`), as it was before: its
   * page if it had it, otherwise the chrome. Selecting a tab never does this (`showWithoutKeyboard`).
   * @param id The tab.
   * @param view Its view, just mounted.
   */
  private giveKeyboardAsLeft(id: string, view: WebContentsView): void {
    if (pageHadKeyboard.get(id) === true) {
      view.webContents.focus();
    } else {
      this.window.webContents.focus();
    }
  }

  /**
   * A press on a page with a tool in hand (the laser pointer, pen, highlighter or crop) marks the page, and doesn't
   * give it the keyboard: the keyboard goes straight back to the chrome, so the tools' keys and the keys between tabs
   * keep working while the tool is used. The comment and text box tools type into the page, so they keep the
   * keyboard there while a box of theirs has the caret, and give it back to the chrome otherwise.
   * @param wc The page's webContents, which has just got the keyboard.
   * @returns Whether the keyboard is being taken back from the page.
   */
  private keepKeyboardOffPage(wc: WebContents): boolean {
    const giveBack = (): void => {
      if (!wc.isDestroyed() && wc.isFocused() && !this.window.isDestroyed()) {
        this.window.webContents.focus();
      }
    };
    if (this.laserPointerActive || this.penActive || this.highlighterActive || this.cropActive) {
      setImmediate(giveBack);
      return true;
    }
    if (this.commentToolActive || this.textToolActive) {
      // The box a press makes takes the caret a moment after the page gets the keyboard, and says so (`hasEditableFocus`).
      setTimeout(() => {
        if ((this.commentToolActive || this.textToolActive) && !hasEditableFocus(wc.id)) {
          giveBack();
        }
      }, TOOL_BOX_FOCUS_SETTLE_MS);
      return true;
    }
    return false;
  }

  /**
   * Hands the keyboard to the active tab's own page — a web page, PDF, note or terminal — when Escape is pressed in
   * the chrome with nothing there using it: the other half of Shift+Escape, which gives it back to the chrome. The page comes back with whatever it had focused (a text box keeps its caret).
   */
  public focusActiveContent(): void {
    const kind = this.activeTabId ? this.states.get(this.activeTabId)?.kind : undefined;
    const view = this.activeTabId ? this.views.get(this.activeTabId) : undefined;
    if (!view || view.webContents.isDestroyed() || !(kind === 'browser' || kind === 'pdf' || kind === 'markdown' || kind === 'terminal')) {
      return;
    }
    view.webContents.focus();
  }

  /**
   * Whether the active tab has any marks for Revert to take off (`BrowserState.canRevert`): a web page's saved
   * highlights, comments, text boxes or pen strokes; a PDF's or note's saved marks. The home page, an empty PDF or note,
   * and every other kind of tab have none.
   */
  private canRevertActiveTab(): boolean {
    const id = this.activeTabId;
    const state = id ? this.states.get(id) : undefined;
    if (!id || !state) {
      return false;
    }
    if (state.kind === 'browser') {
      const { url } = state;
      return (
        url !== HOME_URL &&
        (this.highlighter.hasMarksFor(url) ||
          this.commentController.hasMarksFor(url) ||
          this.textBoxController.hasMarksFor(url) ||
          this.penController.hasMarksFor(url))
      );
    }
    if (state.kind === 'pdf') {
      const key = pdfFileKeys.get(id);
      if (key === undefined) {
        return false;
      }
      const marks = pdfAnnotationStore.get(key);
      return (
        marks.strokes.length + marks.comments.length + marks.highlights.length + marks.textBoxes.length + marks.crops.length >
        0
      );
    }
    if (state.kind === 'markdown') {
      const path = markdownDocuments.pathOf(id);
      if (path === undefined) {
        return false;
      }
      const marks = markdownAnnotationStore.get(path);
      return marks.strokes.length + marks.comments.length + marks.highlights.length > 0;
    }
    return false;
  }

  /** Whether the active tab's own page has the keyboard — see `BrowserState.contentFocused`. */
  private isContentFocused(): boolean {
    const view = this.activeTabId ? this.views.get(this.activeTabId) : undefined;
    return view !== undefined && !view.webContents.isDestroyed() && view.webContents.isFocused();
  }

  /**
   * Hands native OS keyboard focus into the active tab's own view, if it's
   * a terminal — the constructor's chrome-wide Ctrl+` handler's other
   * half, for whenever that's pressed while the chrome (rather than a
   * terminal tab) currently has OS focus. A no-op if the active tab is a
   * browser tab or there isn't one — Ctrl+` only ever means "move the
   * cursor into the terminal," never "activate one."
   */
  private focusActiveTerminal(): void {
    if (!this.activeTabId || this.states.get(this.activeTabId)?.kind !== 'terminal') {
      return;
    }
    this.views.get(this.activeTabId)?.webContents.focus();
  }

  /**
   * Asks this window's chrome to toggle its light/dark theme
   * (menu/accelerator-driven, Ctrl+D). A purely client-local UI
   * preference (see `useTheme`), not a text input — unlike
   * `requestTabSearch`/`requestFocusAddressBar`, there's no keyboard
   * focus to hand back to the chrome first.
   */
  public requestToggleTheme(): void {
    this.window.webContents.send(IpcChannel.UiToggleTheme);
  }

  /**
   * Focuses the address bar now, and again the next time `tabId`'s own
   * `WebContentsView` grabs native OS focus for itself — which a freshly
   * created tab does on its own once it's attached and showing content
   * (even the near-instant local `portalogia://home` page), stealing focus
   * back from the address bar a tick after we set it. The reassertion is
   * deferred a tick past that `focus` event rather than made from directly
   * inside its callback: Electron silently drops a same-tick re-entrant
   * `webContents.focus()` call made while it's still mid-transition into
   * focusing the view that's newly stealing it. Used by
   * `createTabAndFocusAddressBar` and `createWorkspace`, whose fresh tab
   * this races with; a plain `requestFocusAddressBar()` (e.g. Ctrl+/) has
   * no such race since it never creates or loads a tab.
   * @param tabId The tab whose native focus grab this request would otherwise race.
   */
  private focusAddressBarPastTabLoad(tabId: string | null): void {
    const view = tabId ? this.views.get(tabId) : undefined;
    view?.webContents.once('focus', () => setImmediate(() => this.requestFocusAddressBar()));
    this.requestFocusAddressBar();
  }

  // ── State & bounds ───────────────────────────────────────────────────

  /** @returns The current tabs, workspaces, bookmarks, and view mode. */
  public getState(): BrowserState {
    return {
      tabs: this.listedTabIds().map((tabId) => this.states.get(tabId)!),
      activeTabId: this.activeTabId,
      workspaces: Array.from(this.workspaces.values()),
      activeWorkspaceId: this.activeWorkspaceId,
      bookmarks: this.bookmarkStore.list(),
      workspaceImages: this.workspaceImages.listStates(),
      savedWorkspaceImages: this.savedWorkspaceImages(),
      splitView: this.splitClosing ? null : this.splitView,
      splitPair: this.pairByWorkspace.get(this.activeWorkspaceId) ?? null,
      focusMode: this.focusMode,
      contentFocused: this.isContentFocused(),
      sidebarVisible: this.sidebarVisible,
      toolsSidebarVisible: this.toolsSidebarVisible,
      canRevert: this.canRevertActiveTab(),
      grabbedTabId: this.grabbedTabId,
      selectedTabIds: this.currentTabSelection(),
      tabSelectionOrder: this.tabSelectionInOrder(),
      focusedTabId: this.focusedPageTabId(),
      selectedWorkspaceIds: this.currentWorkspaceSelection(),
      zoomPercent: this.activeTabId
        ? (this.registry.zoomPercentByTabId.get(this.activeTabId) ?? ZOOM_PERCENT_DEFAULT)
        : ZOOM_PERCENT_DEFAULT,
      splitZoomPercent: this.splitOtherTabId()
        ? (this.registry.zoomPercentByTabId.get(this.splitOtherTabId() ?? '') ?? ZOOM_PERCENT_DEFAULT)
        : ZOOM_PERCENT_DEFAULT,
      laserPointerActive: this.laserPointerActive,
      highlighterActive: this.highlighterActive,
      commentToolActive: this.commentToolActive,
      textToolActive: this.textToolActive,
      findOpen: this.findOpen,
      penActive: this.penActive,
      cropActive: this.cropActive,
    };
  }

  /**
   * Re-fits the mounted view(s) to the window; call this on resize. A
   * no-op while `animateBoundsInset` is running (see `isAnimatingBounds`)
   * — that includes the native 'resize' event `setFullScreen` fires when
   * Focus Mode toggles, which would otherwise jump straight to the
   * animation's final bounds one frame early instead of animating there.
   */
  public updateBounds(): void {
    if (this.isAnimatingBounds) {
      return;
    }
    this.rightInsetNow = this.targetRightInset();
    this.applyBounds(this.targetLeftInset(), this.targetTopInset());
  }

  /**
   * Activates whichever tab a workspace should show when it becomes
   * active: its last-active tab if that still exists, else its first
   * remaining tab, else a fresh home tab.
   * @param workspaceId The workspace to focus a tab within.
   */
  private focusWorkspaceDefaultTab(workspaceId: string): void {
    const lastActive = this.lastActiveTabIdByWorkspace.get(workspaceId);
    // Also checks the recorded tab's *current* workspace, not just that it
    // still exists — `moveTabToWorkspace` can leave a workspace's
    // last-active entry pointing at a tab that's since relocated
    // elsewhere, which would otherwise resurrect it in the wrong
    // workspace's tab strip.
    if (lastActive && this.states.get(lastActive)?.workspaceId === workspaceId) {
      this.activateTab(lastActive);
      return;
    }
    const anyTab = Array.from(this.states.entries()).find(
      ([, state]) => state.workspaceId === workspaceId,
    )?.[0];
    if (anyTab) {
      this.activateTab(anyTab);
    } else {
      this.createTab(undefined, workspaceId);
    }
  }

  /** Unmounts the split's other side (not the active tab), if split, and clears split state. The active side stays mounted. */
  private teardownSplitView(): void {
    if (!this.splitView) {
      return;
    }
    this.restoreSplitMargins();
    this.splitClosing = true;
    this.syncSplitStatBars();
    ++this.splitAnimationToken;
    this.splitProgress = 1;
    this.splitClosing = false;
    const otherId = this.splitOtherTabId() ?? this.splitView.secondaryTabId;
    const otherView = this.views.get(otherId);
    if (otherView) {
      this.window.contentView.removeChildView(otherView);
    }
    this.registry.mountOwners.delete(otherId);
    this.splitView = null;
  }

  /**
   * The sidebar's resting horizontal inset: `SIDEBAR_WIDTH_PX` while
   * shown, 0 in Focus Mode (nothing left to clear — full immersion, no
   * lingering rail), or `SIDEBAR_COLLAPSED_WIDTH_PX` when toggled off
   * (`toggleSidebar`) but Focus Mode isn't on — just enough room for the
   * rail of workspace icons and `WorkspaceBar`'s own `.sidebar__toggle`
   * button to stay clear of the tab's native content instead of being covered by it. Mid-toggle,
   * `applyBounds` is driven by the animation loop instead — this is only
   * the value things settle back to.
   */
  private targetLeftInset(): number {
    if (this.focusMode) {
      return 0;
    }
    return this.sidebarVisible ? SIDEBAR_WIDTH_PX : SIDEBAR_COLLAPSED_WIDTH_PX;
  }

  /**
   * The Tools sidebar's resting width on the right: `TOOLS_SIDEBAR_WIDTH_PX` shown, its rail
   * (`SIDEBAR_COLLAPSED_WIDTH_PX`) hidden, and 0 in Focus Mode — the left sidebar's `targetLeftInset`, mirrored.
   */
  private targetRightInset(): number {
    if (this.focusMode) {
      return 0;
    }
    return this.toolsSidebarVisible ? TOOLS_SIDEBAR_WIDTH_PX : SIDEBAR_COLLAPSED_WIDTH_PX;
  }

  /**
   * The chrome's resting vertical inset: `CHROME_HEIGHT_FOCUSED_PX` (the
   * whole titlebar/tab-strip/toolbar slid away) in Focus Mode, else
   * `CHROME_HEIGHT_PX`. Mid-toggle, `applyBounds` is driven by
   * `animateBoundsInset` instead — this is only the value things settle
   * back to, same relationship `targetLeftInset` has with the sidebar.
   */
  private targetTopInset(): number {
    return this.focusMode ? CHROME_HEIGHT_FOCUSED_PX : CHROME_HEIGHT_PX;
  }

  /**
   * The strip kept free along the window's bottom for the web page stat bar the chrome draws there
   * (`STATUS_BAR_HEIGHT_PX`): only below a web page, and not in Focus Mode or while a page has the whole window
   * for its own fullscreen (a video).
   */
  private bottomInset(): number {
    const active = this.activeTabId ? this.states.get(this.activeTabId) : undefined;
    return active?.kind === 'browser' && !this.focusMode && this.htmlFullScreenTabId === null ? STATUS_BAR_HEIGHT_PX : 0;
  }

  /**
   * Whether the active tab's view sits inside the content frame (`CONTENT_FRAME_*`): a web page, outside Focus Mode
   * and a page's own fullscreen. A note, PDF, terminal or History page fills its view and draws its own frame.
   */
  private framesActiveView(): boolean {
    const active = this.activeTabId ? this.states.get(this.activeTabId) : undefined;
    return active?.kind === 'browser' && !this.focusMode && this.htmlFullScreenTabId === null;
  }

  /** @returns The bounds a single full-width tab view should occupy for a given sidebar/chrome inset. */
  private computeMainBounds(left: number, top: number): Rect {
    // Electron types getContentSize() as number[], not a fixed tuple, so
    // noUncheckedIndexedAccess sees each element as possibly undefined.
    const [width = 0, height = 0] = this.window.getContentSize();
    // A web page sits inside the content frame, just within the border the chrome draws around it.
    const insetX = this.framesActiveView() ? CONTENT_FRAME_INSET_X_PX + CONTENT_FRAME_BORDER_PX : 0;
    const insetY = this.framesActiveView() ? CONTENT_FRAME_INSET_Y_PX + CONTENT_FRAME_BORDER_PX : 0;
    return {
      x: left + insetX,
      y: top + insetY,
      // The Tools sidebar takes the right edge (`rightInsetNow`), as the workspaces take the left.
      width: Math.max(0, width - left - this.rightInsetNow - 2 * insetX),
      height: Math.max(0, height - top - this.bottomInset() - 2 * insetY),
    };
  }

  /**
   * Where the split's two views go: two frames side by side over the background, with the same gap between them as
   * between a single frame and the sidebar (`CONTENT_FRAME_INSET_X_PX`), at the height a single frame has. A web
   * page's view sits just inside its frame (the chrome draws the frame, `.tab-content__frame--split-*`); a page that
   * draws its own frame gets its frame's area plus the margins it keeps around it (`narrowSplitMargins`), down to the
   * window's bottom, where it draws its own stat bar. In Focus Mode or a page's own fullscreen there are no frames:
   * the two just share the area (`computeSplitBoundsFor`).
   * @param left Horizontal inset, in CSS pixels.
   * @param top Vertical inset, in CSS pixels.
   */
  private computeSplitPanes(left: number, top: number): { primary: Rect; secondary: Rect } {
    const settled = this.settledSplitPanes(left, top);
    if (this.splitProgress >= 1) {
      return settled;
    }
    // Coming apart (or together): the active side grows out of one whole screen (or back into it), the other side out
    // of its own edge of the area (or back into it).
    const main = this.computeMainBounds(left, top);
    const p = this.splitProgress;
    const lerp = (from: Rect, to: Rect): Rect => ({
      x: Math.round(from.x + (to.x - from.x) * p),
      y: Math.round(from.y + (to.y - from.y) * p),
      width: Math.max(0, Math.round(from.width + (to.width - from.width) * p)),
      height: Math.max(0, Math.round(from.height + (to.height - from.height) * p)),
    });
    const leftActive = this.splitView?.primaryTabId === this.activeTabId;
    return {
      primary: lerp(leftActive ? main : { ...settled.primary, x: main.x, width: 0 }, settled.primary),
      secondary: lerp(leftActive ? { ...settled.secondary, x: main.x + main.width, width: 0 } : main, settled.secondary),
    };
  }

  /** Where the split's two views settle (`computeSplitPanes`, once they've come apart). */
  private settledSplitPanes(left: number, top: number): { primary: Rect; secondary: Rect } {
    const split = this.splitView;
    if (!split || this.focusMode || this.htmlFullScreenTabId !== null) {
      return this.computeSplitBoundsFor(this.computeMainBounds(left, top));
    }
    const [width = 0, height = 0] = this.window.getContentSize();
    const gap = CONTENT_FRAME_INSET_X_PX;
    const areaWidth = Math.max(0, width - left - this.rightInsetNow);
    const frameWidth = Math.max(0, (areaWidth - 3 * gap) / 2);
    const frameTop = top + CONTENT_FRAME_INSET_Y_PX;
    const frameHeight = Math.max(0, height - top - STATUS_BAR_HEIGHT_PX - 2 * CONTENT_FRAME_INSET_Y_PX);
    const pane = (tabId: string, frameLeft: number): Rect => {
      if (this.states.get(tabId)?.kind === 'browser') {
        return {
          x: Math.round(frameLeft + CONTENT_FRAME_BORDER_PX),
          y: Math.round(frameTop + CONTENT_FRAME_BORDER_PX),
          width: Math.max(0, Math.round(frameWidth - 2 * CONTENT_FRAME_BORDER_PX)),
          height: Math.max(0, Math.round(frameHeight - 2 * CONTENT_FRAME_BORDER_PX)),
        };
      }
      // Down to the bar along the window's bottom, which the chrome draws in split screen (its own bar hidden).
      return {
        x: Math.round(frameLeft - SPLIT_PAGE_MARGIN_PX),
        y: Math.round(top),
        width: Math.max(0, Math.round(frameWidth + 2 * SPLIT_PAGE_MARGIN_PX)),
        height: Math.max(0, Math.round(height - top - STATUS_BAR_HEIGHT_PX)),
      };
    };
    return {
      primary: pane(split.primaryTabId, left + gap),
      secondary: pane(split.secondaryTabId, left + 2 * gap + frameWidth),
    };
  }

  /** @returns The bounds the primary (left) and secondary (right) split-view panes should occupy, for a single-view `main` rect. */
  private computeSplitBoundsFor(main: Rect): { primary: Rect; secondary: Rect } {
    const dividerPx = 1;
    const leftWidth = Math.floor(main.width / 2);
    return {
      primary: {
        x: main.x,
        y: main.y,
        width: Math.max(0, leftWidth - dividerPx),
        height: main.height,
      },
      secondary: {
        x: main.x + leftWidth,
        y: main.y,
        width: Math.max(0, main.width - leftWidth),
        height: main.height,
      },
    };
  }

  /**
   * Applies bounds for a given sidebar/chrome inset to whichever view(s)
   * are currently mounted — the single shared code path for both the
   * settled state (`updateBounds`) and every frame of
   * `animateBoundsInset`'s animation.
   * @param left Horizontal inset to clear, in CSS pixels.
   * @param top Vertical inset to clear, in CSS pixels.
   */
  private applyBounds(left: number, top: number): void {
    if (this.htmlFullScreenTabId !== null && this.htmlFullScreenTabId === this.activeTabId) {
      this.findOverlay.hide(true);
      const [width = 0, height = 0] = this.window.getContentSize();
      this.views.get(this.htmlFullScreenTabId)?.setBounds({ x: 0, y: 0, width, height });
      return;
    }
    const main = this.computeMainBounds(left, top);
    this.laserPointerOverlay.setActive(this.laserPointerActive && this.activeTabId !== null, main);
    this.syncFindOverlay();
    this.secretPrompt.layout(main);
    if (this.splitView) {
      const { primary, secondary } = this.computeSplitPanes(left, top);
      this.views.get(this.splitView.primaryTabId)?.setBounds(primary);
      this.views.get(this.splitView.secondaryTabId)?.setBounds(secondary);
      return;
    }
    if (this.activeTabId) {
      this.views.get(this.activeTabId)?.setBounds(main);
    }
  }

  /**
   * Merges a partial update into one tab's state and notifies the caller.
   * @param id Tab to update.
   * @param patch Fields to overwrite.
   */
  private patchState(id: string, patch: Partial<Omit<BrowserTabState, 'kind' | 'id' | 'workspaceId'>>): void {
    const current = this.states.get(id);
    if (!current || current.kind !== 'browser') {
      return;
    }
    this.states.set(id, { ...current, ...patch });
    this.emitState();
  }

  /**
   * Notifies every open window (this one included) that shared tab/
   * workspace data changed — each pushes its own fresh `BrowserState` to
   * its own renderer and reschedules a session save (see
   * `SharedTabRegistry.registerWindow`, where that per-window push is
   * actually registered). Every existing call site of this method
   * (unchanged from before tabs/workspaces were shared) still means
   * exactly what it always did: "something changed, tell whoever's
   * listening" — it just has more listeners now.
   */
  private emitState(): void {
    this.prunePairs();
    this.registry.notifyAll();
  }

  /**
   * The workspace's split pair, if the tab is one of its two.
   * @param tabId The tab.
   * @returns The pair, or `null`.
   */
  private pairContaining(tabId: string): SplitViewState | null {
    const workspaceId = this.states.get(tabId)?.workspaceId;
    const pair = workspaceId ? this.pairByWorkspace.get(workspaceId) : undefined;
    return pair && (pair.primaryTabId === tabId || pair.secondaryTabId === tabId) ? pair : null;
  }

  /** Lets go of any split pair a tab has left: closed, or moved to another workspace. */
  private prunePairs(): void {
    for (const [workspaceId, pair] of this.pairByWorkspace) {
      const inWorkspace = (tabId: string): boolean => this.states.get(tabId)?.workspaceId === workspaceId;
      if (!inWorkspace(pair.primaryTabId) || !inWorkspace(pair.secondaryTabId)) {
        this.pairByWorkspace.delete(workspaceId);
      }
    }
  }

  /**
   * Moves a tab to just after another in the row's order (`states`, whose insertion order the row follows).
   * @param id The tab to move.
   * @param anchorId The tab it goes after.
   */
  private placeTabAfter(id: string, anchorId: string): void {
    const moving = this.states.get(id);
    if (!moving || id === anchorId || !this.states.has(anchorId)) {
      return;
    }
    const entries = Array.from(this.states.entries()).filter(([tabId]) => tabId !== id);
    entries.splice(entries.findIndex(([tabId]) => tabId === anchorId) + 1, 0, [id, moving]);
    this.states.clear();
    for (const [tabId, state] of entries) {
      this.states.set(tabId, state);
    }
  }

  /** @returns The current tabs/workspaces reduced to `SessionStore`'s minimal recreatable shape — see `restoreSession` for why it's not the full `TabState`. */
  private buildSessionSnapshot(): SessionContents {
    return {
      workspaces: Array.from(this.workspaces.values()),
      // Twins are per-window views of a tab that's already saved via its
      // canonical member; persisting them too would restore duplicates.
      tabs: Array.from(this.states.values())
        .filter((state) => (this.registry.getLinkGroup(state.id)?.[0] ?? state.id) === state.id)
        .map((state) => ({
          kind: state.kind,
          // A note's tab comes back with the note it had open.
          url: state.kind === 'browser' ? state.url : state.kind === 'markdown' ? (state.filePath ?? '') : '',
          workspaceId: state.workspaceId,
          active: (this.registry.getLinkGroup(state.id) ?? [state.id]).includes(this.activeTabId ?? ''),
        })),
      activeWorkspaceId: this.activeWorkspaceId,
    };
  }

  /**
   * Wires every `WebContents` event that keeps a tab's `TabState` (and,
   * for navigation, its actual destination) in sync with reality.
   * @param id Tab the events belong to.
   * @param view The tab's view.
   */
  private wireEvents(id: string, view: WebContentsView): void {
    const wc = view.webContents;
    const historyFlags = (): Pick<BrowserTabState, 'canGoBack' | 'canGoForward'> => ({
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
    });

    this.wireSharedInputHandling(id, wc);
    trackPageSelectionAccent(wc);
    trackDomainLoadBlur(wc);

    const contentsId = wc.id;
    wc.once('destroyed', () => pagePointerModesSent.delete(contentsId));

    // A fresh document — the initial load or any later navigation/reload —
    // has none of the previous one's highlights, undo/redo history, or
    // preload-side highlighter state (a brand new preload instance that's
    // never been told anything). `did-navigate`'s own listener below has
    // already updated `this.states.get(id)?.url` to the new URL by the time
    // `dom-ready` fires (navigation commit precedes DOM parsing), so it's
    // safe to read here.
    wc.on('dom-ready', () => {
      this.highlighter.resetTab(id);
      this.pushHighlighterStateTo(id);
      this.commentController.resetTab(id);
      this.pushCommentToolStateTo(id);
      this.textBoxController.resetTab(id);
      this.pushTextToolStateTo(id);
      this.penController.resetTab(id);
      this.pushPenStateTo(id);
      // A fresh document has a fresh preload that has never been told its pointer mode.
      pagePointerModesSent.delete(wc.id);
      this.syncPagePointerMode(id);
      if (this.findOpen && id === this.activeTabId) {
        this.runFind();
      }
      const state = this.states.get(id);
      if (state?.kind === 'browser') {
        this.highlighter.restoreFor(id, state.url);
        this.commentController.restoreFor(id, state.url);
        this.textBoxController.restoreFor(id, state.url);
        this.penController.restoreFor(id, state.url);
      }
      // The secrets saved for this site go into their boxes (the page fills only what's still empty).
      this.secretsController.fill(wc);
    });

    wc.on('page-title-updated', (_event, title) => this.patchState(id, { title }));
    wc.on('page-favicon-updated', (_event, favicons) => {
      this.patchState(id, { favicon: favicons[0] ?? null });
    });
    // The address bar's progress line: estimated from the page's requests while it loads, 100 when it finishes, kept
    // there a second so it can be read, then cleared. A new load in that second takes over from it.
    // Only a website's load shows it: the app's own pages (a new tab's home page) load from disk in an instant, and a
    // progress line for them would just flash. Started when the page begins navigating to an http(s) address.
    let progressClear: NodeJS.Timeout | null = null;
    let webLoad = false;
    wc.on('did-start-loading', () => this.patchState(id, { isLoading: true }));
    // The frame around the page lights up while it has the keyboard (`BrowserState.contentFocused`); the chrome draws
    // that frame, so it hears of each change.
    wc.on('focus', () => this.emitState());
    wc.on('blur', () => this.emitState());
    wc.on('did-start-navigation', (details) => {
      if (!details.isMainFrame || details.isSameDocument || !/^https?:/i.test(details.url)) {
        return;
      }
      if (progressClear) {
        clearTimeout(progressClear);
        progressClear = null;
      }
      webLoad = true;
      beginLoad(wc.id, (percent, bytes) => this.patchState(id, { loadProgress: percent, loadBytes: bytes }));
    });
    wc.on('did-stop-loading', () => {
      const bytes = endLoad(wc.id);
      if (!webLoad) {
        this.patchState(id, { isLoading: false, loadProgress: null, loadBytes: null, ...historyFlags() });
        return;
      }
      webLoad = false;
      this.patchState(id, { isLoading: false, loadProgress: 100, loadBytes: bytes, ...historyFlags() });
      progressClear = setTimeout(() => {
        progressClear = null;
        if (!wc.isDestroyed() && !wc.isLoading()) {
          this.patchState(id, { loadProgress: null, loadBytes: null });
        }
      }, LOAD_PROGRESS_HOLD_MS);
    });
    wc.once('destroyed', () => {
      endLoad(wc.id);
      if (progressClear) {
        clearTimeout(progressClear);
      }
    });
    wc.on('did-navigate', (_event, url) => {
      this.patchState(id, { url, ...historyFlags() });
      if (id === this.activeTabId) {
        // Navigating to the home page leaves nothing to mark, so any tool left on turns off.
        this.releaseUnavailableTools();
      }
      this.propagateLinkedNavigation(id, url);
    });
    wc.on('did-navigate-in-page', (_event, url) => {
      this.patchState(id, { url });
      this.propagateLinkedNavigation(id, url);
    });
    // A fresh navigation is a fresh document, which resets `webFrame`'s own
    // frame-local zoom back to 0 — reapply whatever this tab's own zoom
    // actually is (a no-op if it was never zoomed) so it survives clicking
    // a link or typing a new address, not just page reloads.
    wc.on('did-finish-load', () => this.applyZoom(id));

    // A page's own fullscreen (a video's fullscreen button) only fills this
    // tab's view, which is inset below the chrome — so the window goes
    // fullscreen and the view takes all of it, until the page leaves again.
    wc.on('enter-html-full-screen', () => this.setHtmlFullScreen(id, true));
    wc.on('leave-html-full-screen', () => this.setHtmlFullScreen(id, false));
    wc.once('destroyed', () => this.setHtmlFullScreen(id, false));

    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      // -3 is ERR_ABORTED, which fires on ordinary cancelled/redirected
      // loads (e.g. a download, or a second navigation superseding this
      // one) — not a real failure, so it shouldn't show an error page.
      if (!isMainFrame || errorCode === -3) {
        return;
      }
      void wc.loadURL(this.buildErrorPageUrl(errorDescription, validatedURL));
    });

    // Links that would open a new OS window (target="_blank", window.open)
    // become a new tab instead — this is a browser, not an app shell.
    wc.once('destroyed', () => this.adBlocker.forget(contentsId));
    wc.setWindowOpenHandler(({ url }) => {
      // Popups to ad hosts, and floods of them, are dropped rather than made tabs.
      if (this.adBlocker.shouldBlockPopup(url, wc.getURL(), contentsId)) {
        return { action: 'deny' };
      }
      if (isNavigableUrl(url)) {
        this.createTab(url);
      }
      return { action: 'deny' };
    });

    // A compromised or malicious page can request navigation to a
    // disallowed scheme (e.g. `file:`); refuse it here as well as at the
    // IPC boundary, since this path doesn't go through IPC at all.
    wc.on('will-navigate', (event, url) => {
      if (!isNavigableUrl(url)) {
        event.preventDefault();
      }
    });
  }

  /**
   * Wires the OS-focus/keyboard-shortcut handling every tab's own
   * `WebContentsView` needs, regardless of kind — shared by `wireEvents`
   * (browser tabs) and `createTerminalTab`, since a terminal's own view is
   * just as capable of holding OS keyboard focus (in fact holds it most of
   * the time, same as a browser tab's page) and needs the exact same
   * safety nets.
   *
   * The blur handler is a safety net for the Ctrl+Space keyboard-reorder
   * gesture: if this view loses OS focus mid-hold (e.g. a click elsewhere,
   * or the tab being nudged out from under the cursor), its `keyUp` for
   * Space might never arrive here at all, since keyup goes to whichever
   * surface has focus at release time, not necessarily this one. Blurring
   * is treated the same as releasing the keys, so the grab can't get stuck.
   *
   * The `before-input-event` handler is belt-and-suspenders for the
   * chrome-wide shortcuts also bound as menu accelerators in buildMenu.ts
   * (close/new/reopen tab, bookmark, close all tabs, toggle sidebar, cycle
   * tabs/workspaces, home, back/forward): Electron's menu accelerators are
   * unreliable once a WebContentsView (as opposed to the chrome window's
   * own webContents) has OS focus — which, for a tab's content, is almost
   * all the time — so a page could otherwise swallow Ctrl+W etc. or the
   * accelerator could simply not fire. Handling it here too, directly on
   * the tab's own webContents, means it fires regardless of the menu's
   * focus quirks and beats the page's own keydown handling since
   * `before-input-event` runs first.
   *
   * A terminal tab is the one exception, and deliberately skips this
   * switch entirely rather than "just no-op[ping] on the browser-only
   * ones" the way it used to: a shell's own readline bindings overlap
   * these letters for real (Ctrl+L clears the screen, Ctrl+W deletes a
   * word, Ctrl+T transposes two characters, Ctrl+Space sets the mark,
   * Ctrl+Left/Right jumps by word — all live keys the person is actively
   * relying on), so stealing them here wouldn't no-op, it would silently
   * eat shell input. While a terminal tab actually holds OS keyboard
   * focus, every one of these chrome shortcuts is left alone and passed
   * straight through untouched; the only exceptions are Ctrl+` (the
   * escape hatch back to the chrome) and zoom in/out/reset (no shell binds
   * those either, and — unlike every other shortcut here — zoom is
   * something a terminal tab needs just as much as a browser one).
   * @param id The tab this view belongs to.
   * @param wc The view's own webContents.
   */
  private wireSharedInputHandling(id: string, wc: WebContents): void {
    // Resolved fresh on every event rather than captured as `this` — this
    // listener is attached once, at tab-creation time, but the tab itself
    // can outlive that: `activateTab` lets any window steal it away (a
    // shared-workspace tab click, or `tearOffTab` mounting it into a brand
    // new window) without ever re-wiring its input handling. Without this,
    // every shortcut below would keep acting on whichever window happened
    // to create the tab, even after a different window is the one actually
    // showing it and holding OS focus on it — e.g. Ctrl+L toggling the
    // *origin* window's sidebar while the torn-off window's own content
    // fills the screen. Falls back to `this` for a tab that's currently
    // unmounted everywhere (`mountOwners` has no entry), which can't
    // actually receive input anyway but keeps this total.
    const owningManager = (): TabManager => this.registry.mountOwners.get(id) ?? this;

    wc.on('blur', () => owningManager().releaseGrabbedTab());

    // The page's keyboard focus, remembered for when its tab is next shown (`pageHadKeyboard`).
    wc.on('focus', () => {
      // In split screen, the side the keyboard goes to becomes the active one (its tools shown, Find in it).
      owningManager().focusSplitSide(id);
      if (owningManager().keepKeyboardOffPage(wc)) {
        return;
      }
      pageHadKeyboard.set(id, true);
    });
    wc.on('blur', () => {
      setTimeout(() => {
        const owner = owningManager();
        // Still the tab showing, in a window that still has the focus, and the page hasn't got the keyboard back: it
        // was left. Switching tabs, or the window losing focus, leaves the page as it was.
        // The window can be gone by now (the page blurs as it closes), and asking a closed one throws.
        if (
          !wc.isDestroyed() &&
          !owner.window.isDestroyed() &&
          owner.activeTabId === id &&
          owner.window.isFocused() &&
          !wc.isFocused()
        ) {
          pageHadKeyboard.set(id, false);
        }
      }, PAGE_FOCUS_SETTLE_MS);
    });

    wc.on('before-input-event', (event, input) => {
      const owner = owningManager();

      // Window shortcuts (Ctrl+Alt+M, Ctrl+Alt+Enter), ahead of everything else: a terminal returns early
      // on any Alt chord below, and a page could swallow them, so the Window menu's accelerators alone
      // never fired while a tab had the keyboard.
      if (owner.handleWindowShortcut(event, input)) {
        return;
      }
      if (owner.handleMarkdownFormatShortcut(event, input, id)) {
        return;
      }

      if (this.states.get(id)?.kind === 'terminal') {
        if (input.type !== 'keyDown' || input.isAutoRepeat) {
          return;
        }
        // Shift+Escape gives the keyboard back to the chrome, as it does from a web page; Escape in the chrome hands it
        // back. Plain Escape can't: it belongs to the shell (a vi-mode readline leaves insert mode with it).
        if (input.key.toLowerCase() === 'escape' && input.shift && !input.control && !input.meta && !input.alt) {
          event.preventDefault();
          owner.focusChrome();
          return;
        }
        // Checked before the `cmdOrCtrl` gate below, since Escape carries no
        // modifier — unlike every other shortcut in this branch, only acted
        // on here when the laser pointer/highlighter is actually on (a
        // deliberate, uncommon, user-initiated state), so plain Escape still
        // reaches the shell untouched the rest of the time — a vi-mode
        // readline binds it to leave insert mode, a real use this app must
        // not shadow by default.
        if (
          input.key.toLowerCase() === 'escape' &&
          !input.control &&
          !input.meta &&
          !input.alt &&
          !input.shift &&
          owner.exitPointerTools()
        ) {
          event.preventDefault();
          return;
        }
        const cmdOrCtrl = input.control || input.meta;
        if (!cmdOrCtrl || input.alt) {
          return;
        }
        // Ctrl+` (no shell or readline binding uses backtick) hands OS
        // keyboard focus back to the chrome, so every other shortcut works
        // normally again. See this method's own doc comment for why
        // nothing else here runs while a terminal tab has the keyboard.
        if (!input.shift && input.key.toLowerCase() === '`') {
          event.preventDefault();
          owner.focusChrome();
          return;
        }
        // Find is taken here too, deliberately: a terminal has a buffer worth searching, and Ctrl+F is the
        // shortcut for it (VS Code's integrated terminal does the same). It costs the shell its Ctrl+F
        // forward-one-character binding; the Right arrow does the same job.
        if (!input.shift && input.key.toLowerCase() === 'f') {
          event.preventDefault();
          owner.openFind();
          return;
        }
        // Zoom, unlike every other chrome shortcut, isn't suppressed here
        // — a terminal tab's text needs to be resizable exactly as much as
        // a page's does, and no shell binds these either. Matched on
        // `input.code` (the physical key, e.g. "Equal") rather than
        // `input.key` (the character it produces): that keeps Shift out of
        // it entirely — no separate "Shift produces '+' on this layout"
        // case needed — and numpad +/-/0 report their own distinct codes
        // that still mean the same thing here.
        if (input.code === 'Equal' || input.code === 'NumpadAdd') {
          event.preventDefault();
          owner.zoomIn();
        } else if (input.code === 'Minus' || input.code === 'NumpadSubtract') {
          event.preventDefault();
          owner.zoomOut();
        } else if (input.code === 'Digit0' || input.code === 'Numpad0') {
          event.preventDefault();
          // Shift is the one thing that *does* still matter for this one
          // key — Ctrl+0 resets the zoom, Ctrl+Shift+0 jumps the cursor to
          // `ZoomControl`'s own percent field instead of touching zoom at
          // all, same pairing as the browser-tab switch below.
          if (input.shift) {
            owner.requestFocusZoom();
          } else {
            owner.resetZoom();
          }
        }
        return;
      }

      if (owner.handleReorderGestureInput(event, input)) {
        return;
      }
      if (input.type !== 'keyDown') {
        return;
      }
      const key = input.key.toLowerCase();

      if (input.isAutoRepeat) {
        return;
      }

      // Shift+Escape always takes the caret out of a page's text box and gives the keyboard back to the chrome (Escape
      // there hands it back). It is the only way out: plain Escape is the page's own (closing a popup, or Google Docs'
      // every use of it). Ctrl+Escape and Alt+Escape would read better, but Windows keeps both (the Start menu,
      // switching windows), so neither ever reaches the app.
      const kind = this.states.get(id)?.kind;
      if (
        key === 'escape' &&
        input.shift &&
        !input.control &&
        !input.meta &&
        !input.alt &&
        (kind === 'browser' || kind === 'pdf' || kind === 'markdown')
      ) {
        event.preventDefault();
        if (kind === 'browser') {
          wc.send(IpcChannel.TabLeaveTextBox);
        }
        owner.focusChrome();
        return;
      }

      // The caret is in a text box: every key it edits with stays with it, Escape included, so no shortcut below can
      // take one. Once out of the box (Shift+Escape, or a click elsewhere), they all work again.
      if (hasEditableFocus(wc.id) && isTextEditingChord(input, owner.textBoxContextOf(id, wc))) {
        return;
      }

      // The tools' keys (Ctrl+I, P, J, M, E, Alt+1, 2, Ctrl+Shift+X, R) work only from the chrome: with the keyboard
      // in the page they are the page's, like every key that moves between tabs.

      // No modifier, so it falls outside the `cmdOrCtrl`-gated switch below
      // — Escape exits Focus Mode if it's on, and/or turns off the laser
      // pointer/highlighter if either is on; a no-op (falls through
      // untouched to the page) if none of the three are active.
      if (key === 'escape') {
        if (owner.focusMode) {
          event.preventDefault();
          owner.setFocusMode(false);
          owner.exitPointerTools();
          return;
        }
        if (owner.exitPointerTools()) {
          event.preventDefault();
          return;
        }
      }

      const cmdOrCtrl = input.control || input.meta;

      if (input.alt && !cmdOrCtrl && !input.shift) {
        if (key === 'arrowleft') {
          event.preventDefault();
          owner.goBack(id);
        } else if (key === 'arrowright') {
          event.preventDefault();
          owner.goForward(id);
        }
        return;
      }

      if (cmdOrCtrl && input.alt && key === 'w') {
        event.preventDefault();
        if (input.shift) {
          // Ctrl+Shift+Alt+W — the workspace equivalent of Ctrl+Shift+W:
          // closes every workspace and resets the last one, same as
          // repeating the combo below until only one is left.
          owner.closeAllWorkspaces();
        } else {
          // The deliberately-harder-to-hit combo for closing the whole
          // workspace — plain Ctrl+W (below) only ever closes a tab.
          // `removeWorkspace` itself refuses to act when this is the last
          // remaining workspace, so this can never close the window.
          owner.removeSelectionOrActiveWorkspace();
        }
        return;
      }

      if (!cmdOrCtrl || input.alt) {
        return;
      }

      // Zoom, checked by physical key (`input.code`) rather than the
      // character it produces (`key`, used by every case below) — that
      // way it fires the same whether or not Shift is held (some layouts
      // need it to actually produce '+'), and ahead of the Shift/non-Shift
      // switches below so neither needs its own copy of this check. Same
      // reasoning as the terminal branch's own version above.
      if (input.code === 'Equal' || input.code === 'NumpadAdd') {
        event.preventDefault();
        owner.zoomIn();
        return;
      }
      if (input.code === 'Minus' || input.code === 'NumpadSubtract') {
        event.preventDefault();
        owner.zoomOut();
        return;
      }
      if (input.code === 'Digit0' || input.code === 'Numpad0') {
        event.preventDefault();
        // Ctrl+Shift+0 jumps the cursor to `ZoomControl`'s own percent
        // field instead of resetting the zoom — Shift is the one thing
        // that still distinguishes this key, since every other zoom key
        // above deliberately ignores it.
        if (input.shift) {
          owner.requestFocusZoom();
        } else {
          owner.resetZoom();
        }
        return;
      }

      if (input.shift) {
        switch (key) {
          case 't':
            event.preventDefault();
            owner.restoreLastClosedTab();
            return;
          case 'w':
            event.preventDefault();
            owner.closeAllTabs();
            return;
          case 'f':
            event.preventDefault();
            owner.toggleFocusMode();
            return;
          case 'd':
            event.preventDefault();
            owner.duplicateTab(id);
            return;
          case 'p':
            // Same as buildMenu.ts's `CmdOrCtrl+Shift+P` ("New PDF Viewer").
            event.preventDefault();
            owner.createPdfTab();
            return;
          case 's':
            // Same as buildMenu.ts's `CmdOrCtrl+Shift+S` ("Workspace Images…").
            event.preventDefault();
            owner.requestWorkspaceImages();
            return;
          case 'u':
            // Make a link (the editor's right-click menu has the same command); a no-op unless a note is being edited.
            event.preventDefault();
            owner.formatMarkdown(id, 'link');
            return;
          case 'l':
            event.preventDefault();
            owner.formatMarkdown(id, 'latex');
            return;
          case 'k':
            event.preventDefault();
            owner.formatMarkdown(id, 'code');
            return;
          case 'g':
            // Same as buildMenu.ts's `CmdOrCtrl+Shift+G` ("Toggle View/Edit"); a no-op off a Markdown tab.
            event.preventDefault();
            owner.toggleMarkdownMode(id);
            return;
          case 'c':
            // Same as buildMenu.ts's `CmdOrCtrl+Shift+C` ("Close Note or PDF"): the toolbar's Close button, on a PDF or Markdown tab.
            event.preventDefault();
            owner.closePdfFile(id);
            owner.closeMarkdownFile(id);
            return;
          case 'm':
            // Same as buildMenu.ts's `CmdOrCtrl+Shift+M` ("New Markdown Tab").
            event.preventDefault();
            owner.createMarkdownTab();
            return;
          case 'h':
            // Same as buildMenu.ts's `CmdOrCtrl+Shift+H` ("New History Tab").
            event.preventDefault();
            owner.createHistoryTab();
            return;
          case '>':
            // Shift is what actually produces '>' (it's Shift+Period on a
            // US layout) — this is Ctrl+> from a key-event's perspective,
            // not a separate Ctrl+Shift+> binding, same as buildMenu.ts's
            // `CmdOrCtrl+>` accelerator for the same action.
            event.preventDefault();
            owner.createTerminalTab();
            return;
          default:
            return;
        }
      }

      switch (key) {
        case 'o':
          // Same as buildMenu.ts's `CmdOrCtrl+O` ("Open PDF"); each is a no-op on a tab of the other kind.
          event.preventDefault();
          void owner.openPdfFile(id);
          void owner.openMarkdownFile(id);
          return;
        case 'w':
          event.preventDefault();
          owner.closeSelectionOrTab(id);
          return;
        case 'n':
          event.preventDefault();
          owner.createTabAndFocusAddressBar();
          return;
        case 'q':
          // Same action as Ctrl+Shift+N, under a second accelerator — see
          // buildMenu.ts's hidden "New Workspace" (Ctrl+Q) entry for why.
          event.preventDefault();
          owner.createWorkspace();
          return;
        case 't':
          event.preventDefault();
          owner.restoreLastClosedTab();
          return;
        case 'b':
          event.preventDefault();
          owner.toggleBookmark(id);
          return;
        case 'z':
          // Only intercepted while the highlighter or pen tool is on —
          // otherwise this falls through untouched, so a page's own undo (a
          // text field, a rich editor) and Electron's native `role: 'undo'`
          // menu item both keep working exactly as before. Never stolen on a
          // terminal tab at all (see this method's own doc comment): this
          // `case` only exists in the browser-tab branch of the switch, and
          // Ctrl+Z suspends a Unix shell's foreground process — a binding
          // this app must never shadow. The two tools are mutually
          // exclusive (`setHighlighter`/`setPen`), so at most one branch
          // below ever actually runs.
          if (owner.states.get(id)?.kind === 'markdown') {
            // A note's page keeps its own history of marks; it undoes when told to.
            if (owner.highlighterActive || owner.penActive) {
              event.preventDefault();
              owner.views.get(id)?.webContents.send(IpcChannel.MarkdownUndo);
            }
          } else if (owner.states.get(id)?.kind === 'pdf') {
            // A PDF page keeps its own history (marks and crops); it undoes when told to.
            if (owner.highlighterActive || owner.penActive || owner.cropActive) {
              event.preventDefault();
              owner.views.get(id)?.webContents.send(IpcChannel.PdfUndo);
            }
          } else if (owner.highlighterActive) {
            event.preventDefault();
            owner.highlighter.undo(id);
          } else if (owner.penActive) {
            event.preventDefault();
            owner.penController.undo(id);
          }
          return;
        case 'y':
          if (owner.states.get(id)?.kind === 'markdown') {
            if (owner.highlighterActive || owner.penActive) {
              event.preventDefault();
              owner.views.get(id)?.webContents.send(IpcChannel.MarkdownRedo);
            }
          } else if (owner.states.get(id)?.kind === 'pdf') {
            if (owner.highlighterActive || owner.penActive || owner.cropActive) {
              event.preventDefault();
              owner.views.get(id)?.webContents.send(IpcChannel.PdfRedo);
            }
          } else if (owner.highlighterActive) {
            event.preventDefault();
            owner.highlighter.redo(id);
          } else if (owner.penActive) {
            event.preventDefault();
            owner.penController.redo(id);
          }
          return;
        case 'f':
          // Same as buildMenu.ts's `CmdOrCtrl+F` ("Find"). Shift+F is Focus Mode, handled above.
          event.preventDefault();
          owner.openFind();
          return;
        case 'h':
          event.preventDefault();
          owner.goHome(id);
          return;
        case 'l':
          event.preventDefault();
          owner.toggleSidebar();
          return;
        case '/':
          event.preventDefault();
          owner.requestFocusAddressBar();
          return;
        // Ctrl+←/→/↑/↓ (tabs and workspaces) are left to the page: they move between tabs only from the chrome
        // (`handleTextSensitiveShortcut`), once Shift+Escape has left the page. F1–F7 work from anywhere.
        default:
          return;
      }
    });
  }

  /**
   * Builds a minimal, self-contained error page for a failed navigation.
   * @param description Chromium's human-readable error description.
   * @param failedUrl The URL that failed to load.
   * @returns A `data:` URL the tab can load in place of the failed page.
   */
  private buildErrorPageUrl(description: string, failedUrl: string): string {
    const html =
      '<!doctype html><meta charset="utf-8">' +
      '<title>Cannot reach page</title>' +
      '<style>body{font:15px system-ui;color:#333;padding:3rem;max-width:36rem;margin:auto}' +
      'code{background:#f1f1f1;padding:.15em .4em;border-radius:.25em;word-break:break-all}</style>' +
      `<h1>This page couldn't load</h1><p>${escapeHtml(description)}</p>` +
      `<p><code>${escapeHtml(failedUrl)}</code></p>`;
    return `data:text/html,${encodeURIComponent(html)}`;
  }
}

/**
 * Whether a web tab has a site loaded: not its home page, a blank page or nothing at all.
 * @param url The tab's address.
 */
function hasSiteLoaded(url: string): boolean {
  return url !== '' && url !== HOME_URL && !url.startsWith('about:');
}

/**
 * Strips characters that aren't valid in a filename and caps the length, so
 * a page's title (attacker-controlled text, for a malicious page) can be
 * used as a suggested PDF filename without producing an invalid or
 * absurdly long path.
 * @param title The tab's title.
 * @returns A filename-safe string, never empty.
 */
function sanitizeFileName(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 80);
  return cleaned || 'page';
}

/**
 * The code a run prompt shows. A long block is cut, and the cut is stated
 * plainly — a quiet "…" let harmless-looking first lines stand in for code
 * the person never saw.
 * @param code The block's source.
 */
function codePreview(code: string): string {
  const lines = code.split('\n');
  let shown = lines.slice(0, CODE_PREVIEW_MAX_LINES).join('\n');
  if (shown.length > CODE_PREVIEW_MAX_CHARS) {
    shown = shown.slice(0, CODE_PREVIEW_MAX_CHARS);
  }
  if (shown.length === code.length) {
    return code;
  }
  const hiddenLines = lines.length - shown.split('\n').length;
  const rest = hiddenLines > 0 ? `${hiddenLines} more line${hiddenLines === 1 ? '' : 's'}` : 'the rest of this line';
  return `${shown}\n\n⚠ Not shown: ${rest}. Read the whole block in the note before running it.`;
}

/**
 * Clamps and rounds a requested zoom percent to `ZOOM_PERCENT_MIN`–`ZOOM_PERCENT_MAX`.
 * @param percent The requested percent — `NaN`-safe: `Math.max`/`Math.min`
 *   propagate a `NaN` input straight through rather than clamping it, so an
 *   invalid value (in practice, `ZoomPercentInput` never sends one) falls
 *   back to `ZOOM_PERCENT_DEFAULT` instead of setting an actual `NaN` zoom.
 * @returns A whole number within range.
 */
function clampZoomPercent(percent: number): number {
  if (!Number.isFinite(percent)) {
    return ZOOM_PERCENT_DEFAULT;
  }
  return Math.min(ZOOM_PERCENT_MAX, Math.max(ZOOM_PERCENT_MIN, Math.round(percent)));
}

/**
 * Marks a view as its tab's last: the tab has closed. Its page is muted at once, so nothing it plays is heard while it
 * fades out, and `releaseView` closes it once it's off the window.
 * @param view The closed tab's view.
 */
function retireView(view: WebContentsView): void {
  retiredViews.add(view);
  if (!view.webContents.isDestroyed()) {
    view.webContents.setAudioMuted(true);
  }
}

/**
 * Takes a view off a window and, if its tab has closed (`retireView`), closes its page too: that stops whatever it was
 * still doing (a video, a sound, a timer) and frees it.
 * @param view The view.
 * @param window The window it's on.
 */
function releaseView(view: WebContentsView, window: BrowserWindow): void {
  if (!window.isDestroyed()) {
    window.contentView.removeChildView(view);
  }
  if (retiredViews.has(view) && !view.webContents.isDestroyed()) {
    view.webContents.close();
  }
}

/** The "+" menu's rows (`NewTabMenuAction`), as against the export menu's. */
const NEW_TAB_MENU_ACTIONS: ReadonlySet<string> = new Set<NewTabMenuAction>([
  'new-tab',
  'new-pdf',
  'new-markdown',
  'new-terminal',
  'new-bookmarks',
  'new-secrets',
  'new-history',
]);

/** @returns Whether a row picked in a menu overlay is one of the "+" menu's. */
function isNewTabMenuAction(action: MenuOverlayAction): action is NewTabMenuAction {
  return NEW_TAB_MENU_ACTIONS.has(action);
}
