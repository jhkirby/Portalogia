// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-12

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
export const CHROME_HEIGHT_PX = 84;

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
 * Width, in CSS pixels, of the workspace sidebar on the left edge of the
 * window. The main process uses this to shift each tab's WebContentsView
 * right by this much (and shrink its width to match) so it never sits
 * underneath the sidebar — must equal `--size-sidebar-width` in
 * `sizes.css`, the same relationship `CHROME_HEIGHT_PX` has with
 * `--size-chrome-height`. Hidden (width 0) in Focus Mode, alongside the
 * tab row.
 */
export const SIDEBAR_WIDTH_PX = 180;

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

/** Accent colors cycled through, in order, as new workspaces are created. */
export const WORKSPACE_COLORS = [
  '#4285f4',
  '#ea4335',
  '#34a853',
  '#fbbc04',
  '#a142f4',
  '#00acc1',
] as const;
