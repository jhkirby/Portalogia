// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

/**
 * Height, in CSS pixels, of the browser chrome (titlebar row + toolbar) at
 * the top of the window. The titlebar row doubles as the frameless
 * window's drag region and its tab strip (see MainWindow.ts's
 * `frame: false` and `.titlebar` in app.css) — the main process uses this
 * constant to position each tab's WebContentsView below the chrome; the
 * renderer uses it to reserve space so the chrome never overlaps the
 * native tab content.
 *
 * Kept as a fixed constant rather than measured at runtime (e.g. via
 * ResizeObserver + IPC) to keep the first version simple — revisit if the
 * chrome ever needs a variable height beyond the two fixed states below.
 */
export const CHROME_HEIGHT_PX = 92;

/**
 * Chrome height while Focus Mode is on: 0 — the titlebar row and toolbar
 * both slide fully out of view (see `.app--focus-mode` in app.css) and the
 * window itself goes OS-fullscreen (`setFocusMode` in TabManager.ts), so
 * the page has the entire screen to itself with no chrome reserved at all.
 * Must equal `--size-chrome-height-focused` in `sizes.css`, the same way
 * `CHROME_HEIGHT_PX` must equal `--size-chrome-height`.
 */
export const CHROME_HEIGHT_FOCUSED_PX = 0;

/**
 * Height, in CSS pixels, of the titlebar grip strip along the window's top
 * edge. Must equal `.titlebar__grip`'s `height` in app.css; main uses it to
 * tell when the cursor is over the grip while the window is maximized
 * (`GripHoverWatcher`).
 */
export const TITLEBAR_GRIP_HEIGHT_PX = 12;

/**
 * Width, in CSS pixels, of the workspace sidebar on the left edge of the
 * window. The main process uses this to shift each tab's WebContentsView
 * right by this much (and shrink its width to match) so it never sits
 * underneath the sidebar — must equal `--size-sidebar-width` in
 * `sizes.css`, the same relationship `CHROME_HEIGHT_PX` has with
 * `--size-chrome-height`. Collapses to `SIDEBAR_COLLAPSED_WIDTH_PX` when
 * toggled off (Ctrl+L), or fully to 0 in Focus Mode, alongside the tab row.
 */
export const SIDEBAR_WIDTH_PX = 180;

/**
 * Width, in CSS pixels, the sidebar collapses to when toggled off (Ctrl+L)
 * — not all the way to 0: kept as a narrow icon rail (workspace dots stay
 * visible *and* clickable, and so does `WorkspaceBar`'s own
 * `.sidebar__toggle` nub) instead of disappearing outright, which the main
 * process makes room for by shifting the tab's own native content right by
 * exactly this much (`TabManager.targetLeftInset`) whenever the sidebar is
 * off but Focus Mode isn't on. That native content is a separate compositor
 * surface layered above this chrome, immune to CSS z-index — which is why
 * `.sidebar__toggle` and `.workspace-bar__new`'s own tooltips switch to
 * `TooltipOverlay` (a second native view stacked *above* the tab's own,
 * same idea as `SuggestionsOverlay`) instead of the plain CSS one the rest
 * of the chrome uses, the moment the sidebar collapses to this width — see
 * `useOverlayTooltip`. Must equal `--size-sidebar-collapsed-width` in
 * `sizes.css`, the same relationship `SIDEBAR_WIDTH_PX` has with
 * `--size-sidebar-width`. Focus Mode collapses all the way to 0 instead —
 * full immersion, no lingering rail — which is why this is a separate
 * constant from that 0 rather than the sidebar's only "off" state.
 */
export const SIDEBAR_COLLAPSED_WIDTH_PX = 40;

/**
 * How long the sidebar's show/hide slide takes, in milliseconds, when
 * toggled via `toggleSidebar` (Ctrl+L) — and also how long the chrome's
 * slide-away takes when Focus Mode (Ctrl+Shift+F) toggles, since both
 * reuse the same `animateBoundsInset` in TabManager.ts. Must equal
 * `--size-sidebar-toggle-duration` in `sizes.css` — the main process
 * animates the native tab content's bounds over exactly this long so it
 * moves in step with the sidebar's/chrome's own CSS transitions rather
 * than snapping ahead of or behind them.
 */
export const SIDEBAR_TOGGLE_DURATION_MS = 220;

/** Internal scheme serving Northstar's own pages (currently just the home page). */
export const NORTHSTAR_SCHEME = 'northstar';

/**
 * The browser's home page and every new tab's starting page — a local page
 * we control rather than a real site, so a fresh window or tab never
 * silently sends anything to a third party before the user has typed
 * anything. Normalized with a trailing slash to match how the WHATWG URL
 * parser renders a path-less "standard" scheme, so equality checks against
 * a navigated tab's reported URL (e.g. "is this tab on the home page?")
 * don't have to special-case the slash.
 */
export const HOME_URL = 'northstar://home/';

/** Default page loaded into a freshly created tab. */
export const DEFAULT_TAB_URL = HOME_URL;

/** Template used to build a web search URL from free-text address bar input. */
export const SEARCH_URL_TEMPLATE = 'https://www.google.com/search?q=';

/** Id and name of the workspace every window starts with. */
export const DEFAULT_WORKSPACE_ID = 'default';
export const DEFAULT_WORKSPACE_NAME = 'Home';

/**
 * Height, in CSS pixels, of one row in the address bar's bookmark
 * suggestions dropdown — the main process uses this (with
 * `ADDRESS_SUGGESTIONS_PADDING_PX`) to size the dropdown's own dedicated
 * `WebContentsView` to exactly its visible content, no more and no less
 * (see `SuggestionsOverlay`). Must equal `.address-bar__suggestion`'s
 * `height` in `suggestions-overlay.css`, the same relationship
 * `CHROME_HEIGHT_PX` has with `--size-chrome-height`.
 */
export const ADDRESS_SUGGESTION_ROW_HEIGHT_PX = 32;

/**
 * Padding, in CSS pixels, above and below the suggestion rows inside the
 * dropdown — must equal `--size-spacing-xs` in `sizes.css`, the value
 * `.address-bar__suggestions`'s own `padding` in `suggestions-overlay.css`
 * resolves to. See `ADDRESS_SUGGESTION_ROW_HEIGHT_PX`.
 */
export const ADDRESS_SUGGESTIONS_PADDING_PX = 4;

/**
 * A tab's own zoom range and default, as a whole percent — shared by main
 * (`TabManager.setZoom`/`clampZoomPercent`, the actual enforcement point)
 * and the renderer (`ZoomPercentInput`, which restricts what a person can
 * even type to this same range) so the two can't quietly drift apart.
 */
export const ZOOM_PERCENT_MIN = 25;
export const ZOOM_PERCENT_MAX = 200;
export const ZOOM_PERCENT_DEFAULT = 100;
/** How far one Ctrl+mouse-wheel tick moves a tab's zoom, in percentage points — applies to browser, terminal and PDF tabs alike. */
export const ZOOM_PERCENT_WHEEL_STEP = 5;

/**
 * Font size, in CSS pixels, `TooltipOverlay`'s own page renders its text
 * at — must equal `--size-font-sm` in `sizes.css`. The chrome measures a
 * tooltip's text at this same size (`measureTooltipTextWidth`) *before*
 * ever mounting the overlay's view, so the two have to stay in lockstep or
 * the measured width silently stops matching what actually gets rendered.
 */
export const TOOLTIP_OVERLAY_FONT_PX = 12;

/**
 * Horizontal padding, in CSS pixels, inside `TooltipOverlay`'s own box on
 * each side — must equal `--size-spacing-sm` in `sizes.css` and
 * `tooltip-overlay.css`'s own `padding`. See `TOOLTIP_OVERLAY_FONT_PX` for
 * why this has to be kept in sync rather than read from the CSS directly.
 */
export const TOOLTIP_OVERLAY_PADDING_X_PX = 8;

/**
 * Vertical padding, in CSS pixels, inside `TooltipOverlay`'s own box on
 * each side — must equal `--size-spacing-xs` in `sizes.css` and
 * `tooltip-overlay.css`'s own `padding`.
 */
export const TOOLTIP_OVERLAY_PADDING_Y_PX = 4;

/**
 * Line height, in CSS pixels, `TooltipOverlay`'s own page renders its
 * (always single-line) text at — must equal `tooltip-overlay.css`'s own
 * `line-height`. Fixed rather than left to the font's natural leading so
 * the chrome can compute the overlay's exact height up front
 * (`TOOLTIP_OVERLAY_PADDING_Y_PX * 2 + this`) the same way it computes the
 * width, with nothing left for the overlay's own page to measure and
 * report back.
 */
export const TOOLTIP_OVERLAY_LINE_HEIGHT_PX = 16;

/**
 * Gap, in CSS pixels, between `TooltipOverlay`'s own box and the element
 * it's anchored above — must equal tooltip.css's plain `::after` tooltip's
 * own `margin-bottom`, the same visual relationship this overlay is
 * standing in for.
 */
export const TOOLTIP_OVERLAY_GAP_PX = 6;

/**
 * Width/height, in CSS pixels, of `ColorPicker`'s dropdown — the hue
 * ring, saturation/value square, recent-color swatches, and RGB/hex
 * fields all together. Unlike the suggestions dropdown, this content
 * never varies in size (no row count to account for), so the main
 * process can size `ColorPickerOverlay`'s own `WebContentsView` to these
 * two fixed constants instead of anything measured. Must equal
 * `.color-picker__panel`'s own `width`/`height` in color-picker.css —
 * chosen so the panel's content (192px wheel + gaps + a fixed-size
 * recents grid + the fields row, all padding and border included) fits
 * exactly, with `box-sizing: border-box` making the CSS side of that
 * arithmetic explicit.
 */
export const COLOR_PICKER_PANEL_WIDTH_PX = 224;

/**
 * Size of `ExportMenu`'s dropdown. Fixed (two rows, never more), so main
 * sizes `ExportMenuOverlay`'s view from these. Height = 2 x 32px rows +
 * 2 x 4px padding + 2 x 1px border; must match export-menu.css.
 */
export const EXPORT_MENU_WIDTH_PX = 112;
export const EXPORT_MENU_HEIGHT_PX = 74;
/** A Markdown tab's export menu has a third row (PDF, .md, .txt): 3 x 32px rows plus the same padding and border. */
export const EXPORT_MENU_MARKDOWN_HEIGHT_PX = 106;

/**
 * The name of the function a Markdown tab's own page defines on `window`
 * for `TabManager.exportMarkdown` to call (via `executeJavaScript`, in the
 * page's own world) right before `printToPDF()`. Called with `true` it
 * switches the page to its print layout and resolves once that's drawn;
 * with `false` it goes back to the screen layout — same idea as
 * `TERMINAL_PREPARE_PRINT_GLOBAL`.
 */
export const MARKDOWN_PRINT_GLOBAL = '__northstarMarkdownPrint';
export const COLOR_PICKER_PANEL_HEIGHT_PX = 330;

/**
 * The `window` global `Terminal.tsx` hangs its print-preparation function
 * off of, and the exact source string `TabManager.exportToPdf` calls via
 * `executeJavaScript` to invoke it on a terminal tab's own
 * `WebContentsView` right before `printToPDF()` — see both call sites'
 * own doc comments. A shared constant rather than each side hard-coding
 * the name is what keeps them from silently drifting apart if either one
 * is ever renamed.
 */
export const TERMINAL_PREPARE_PRINT_GLOBAL = '__northstarPrepareTerminalPrint';

/** Accent colors cycled through, in order, as new workspaces are created. */
export const WORKSPACE_COLORS = [
  '#4285f4',
  '#ea4335',
  '#34a853',
  '#fbbc04',
  '#a142f4',
  '#00acc1',
] as const;

/**
 * Height, in CSS pixels, of the tab strip (the `.titlebar` row) at the top
 * of the window. Main uses it to tell when a dragged-out tab is hovering
 * another window's tab strip (see `TabManager.isOverTabDropRegion`). Must
 * equal `--size-tab-bar-height` in `sizes.css`.
 */
export const TAB_STRIP_HEIGHT_PX = 48;

/**
 * The most tabs one workspace can hold. Enforced in the main process
 * (`TabManager.isWorkspaceFull`) for every way a tab can arrive — new tab,
 * terminal, duplicate, reopen, link-opened, dragged in from another
 * workspace — and mirrored in the tab bar, which hides its "+" button at the
 * limit. A tab shown from several windows counts once.
 */
export const MAX_TABS_PER_WORKSPACE = 8;

/**
 * The most workspaces that can exist at once. Enforced in the main process
 * (`TabManager.createWorkspace`, `createWorkspaceWithTab`,
 * `createStandaloneWorkspaceFor`) and mirrored in the sidebar, which hides
 * its "New workspace" button at the limit and brings it back once one is
 * removed.
 */
export const MAX_WORKSPACES = 20;

/**
 * Smallest and largest font size, and the starting one, of a text box
 * (browser tab: CSS px; PDF tab: points, so the export matches the screen at
 * 100% zoom). `src/preload/tabTextBoxes.ts` and `ipc-schemas.ts` hold their
 * own copies of the range, for the reasons given there — keep all three in step.
 */
export const TEXT_BOX_FONT_SIZE_MIN = 8;
export const TEXT_BOX_FONT_SIZE_MAX = 48;
export const TEXT_BOX_FONT_SIZE_DEFAULT = 16;

/** How a text box's lines sit within its own width. */
export type TextBoxAlign = 'left' | 'center' | 'right';

/**
 * The units "Clear History" can clear back through, and the most of each it
 * offers (the History tab's number box is capped to match). Enforced in main
 * (`historyClearRequestSchema`) too, since the page that sends it isn't trusted.
 */
export const HISTORY_UNIT_LIMITS = {
  hours: 23,
  days: 6,
  weeks: 4,
  months: 12,
} as const;
export type HistoryUnit = keyof typeof HISTORY_UNIT_LIMITS;

/** The most visits the history keeps; past this, the oldest are dropped. */
export const HISTORY_MAX_ENTRIES = 50_000;

/**
 * The find bar's overlay view: its size, and its gap from the top-right
 * corner of the area the tab occupies. The bar's own page (`FindBar`) lays
 * itself out to fit this exactly — keep `find-bar.css` in step.
 */
export const FIND_BAR_WIDTH_PX = 440;
export const FIND_BAR_HEIGHT_PX = 44;
export const FIND_BAR_MARGIN_PX = 12;
/** How long the find bar's slide in from / out to the right edge takes. */
export const FIND_BAR_SLIDE_MS = 160;
