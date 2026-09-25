# Status — where we left off (2026-09-24)

## In progress: shared workspaces/tabs across windows

User's ask: workspaces and tabs are currently per-window (each `TabManager`
owns its own independent copy), so a second window (created via drag-out
tear-off) gets its own disconnected "Home" workspace, a new workspace made
in one window doesn't show in another, and a tab made in one window can't
be reached from another. Goal: make workspaces/tabs/views **shared** across
every open window, with only per-window UI state (active tab, active
workspace, split view, focus mode, sidebar visibility) staying local. Also:
tearing a tab out to a new window should give it a genuinely new,
standalone workspace, not a second "Home".

### What's done (uncommitted — see `git status`)

- **New file `src/main/browser/SharedTabRegistry.ts`** — one shared
  instance (constructed once in `main/index.ts`) holding `workspaces`,
  `states` (tabs), `views`, and `mountOwners` (which `TabManager`/window
  currently has a given tab visually mounted — active tab or split-view
  secondary). Also tracks the open `BrowserWindow`s for
  `detachViewFromAllWindows`, and a listener set for `notifyAll()` (every
  window re-pushes its own state whenever anything shared changes).

- **`TabManager.ts` rewritten to alias onto the shared registry** instead
  of owning its own `Map`s:
  - Constructor now takes `registry: SharedTabRegistry` and a shared
    `terminals: TerminalManager` (terminals are shared now too, since a
    terminal tab can move between windows same as a browser tab).
    `this.views`/`this.states`/`this.workspaces` are now references into
    `registry`'s own maps, not `new Map()`. Only seeds the default "Home"
    workspace `if (this.workspaces.size === 0)` (a second window's
    constructor must not stomp an already-renamed Home back to defaults).
  - `emitState()` now calls `this.registry.notifyAll()`; the actual
    per-window push-to-renderer + session-save happens in the callback
    each `TabManager` registers via `registry.registerWindow(...)` in its
    constructor.
  - `activateTab` now steals a tab away from whichever *other* window
    currently has it mounted first (`registry.mountOwners`, via the new
    `releaseTab` method), then detaches/mounts via
    `registry.detachViewFromAllWindows` + `mountOwners.set`.
  - New public method `releaseTab(id)` — unmounts a tab from *this*
    window if it's currently showing it (active tab or split secondary),
    picking a fallback exactly like `closeTab` would, without deleting the
    tab. Called on the actual owner by `activateTab`/`enterSplitView` when
    a different window claims a tab.
  - `closeTab` and `moveTabToWorkspace` now delegate to the tab's actual
    `mountOwners` owner first if it isn't `this` (a tab's close button /
    a workspace pill can now be interacted with from *any* window showing
    that shared workspace, not just whichever window has the tab mounted).
  - `enterSplitView`/`teardownSplitView` updated to maintain
    `mountOwners` for the secondary pane the same way.
  - New method `createStandaloneWorkspaceFor(tabId)` — creates a fresh
    workspace and reassigns one tab into it (via `moveTabToWorkspace`,
    so the unmount/fallback bookkeeping is reused), *without* switching
    this window to it — used by tear-off.
  - Removed `disposeAllTerminals()` (terminals are shared app-wide now,
    not per-window — killing all of them on one window's close would kill
    other windows' terminals too). Added `dispose()` (disposes this
    window's own `SuggestionsOverlay` + unregisters from the registry).

- **`main/index.ts` rewritten**:
  - Constructs one `SharedTabRegistry` and one shared `TerminalManager`
    (its `onData`/`onExit` callbacks now reference `sharedRegistry.views`/
    `.states` directly) at module scope, passed into every `TabManager`.
  - `window.on('closed', ...)` now calls `tabManager.dispose()` instead of
    the old `disposeAllTerminals()+disposeSuggestionsOverlay()`.
  - `app.on('window-all-closed', ...)` now calls
    `sharedTerminalManager.disposeAll()` once, before quitting (moved from
    per-window to app-wide, since terminals are shared).
  - `registerTearOffIpc` simplified drastically: since tabs/views are
    shared, tear-off no longer closes-and-recreates the tab (which used to
    lose navigation history) — it now calls
    `sourceManager.createStandaloneWorkspaceFor(id)` to give the tab a
    fresh workspace, then `launchWindow((tabManager) =>
    tabManager.activateTab(id), position)` to mount the *same* existing
    view into the new window, preserving live page state.
  - **Deleted** `registerCrossWindowTabMoveIpc` entirely — no longer
    needed now that tabs are shared (see next bullet).

- **`registerTabIpc.ts`**: `TabsMove` (`moveTab`, TabBar's drag-reorder)
  moved back into this file as an ordinary per-window-resolved handler.
  Since tabs/workspaces are shared, a plain `moveTab` already works
  correctly regardless of which window's `TabManager` instance runs it;
  the handler just reassigns the tab's `workspaceId` first (via
  `moveTabToWorkspace`) if the drop landed in a window showing a
  *different* workspace than the tab's own — same idea as dragging onto a
  `WorkspaceBar` pill, just triggered by dropping into another window's
  tab bar instead.

### Verified so far

- `npm run typecheck` and `npm run lint` are both clean (only the two
  pre-existing, unrelated issues remain: `Terminal.tsx:141` unused
  eslint-disable warning, `useTabs.ts:43` prefer-const error — neither
  touched this session).
- **Not yet live-tested.** I was mid-setup for a two-window CDP test
  (`npx electron-vite dev --remoteDebuggingPort=9222`, Playwright
  `connectOverCDP`) when we stopped — no dev server is currently running
  (confirmed via `tasklist`, no `electron.exe` processes).

### Next steps when resuming

1. Restart dev app with `--remoteDebuggingPort=9222` (see this
   conversation's earlier two-window testing pattern: tear off a tab via
   `window.northstar.tearOffTab(id, farOffX, farOffY)` through
   `page.evaluate`, find the new window's Page by listening for `ctx.on('page', ...)`
   and filtering by URL — NOT by `ctx.pages()` re-enumeration, which
   proved unreliable for disambiguating same-URL Electron windows in this
   session's earlier testing).
2. Verify, with two real windows: (a) creating a workspace in window A
   shows up in window B's sidebar immediately; (b) a tab created in window
   A's Home workspace is visible and clickable from window B (and clicking
   it there actually moves the live view into B, unmounting it from A);
   (c) tearing a tab out of window A creates a window B with a **new**,
   uniquely-named workspace (not a second "Home").
3. Also sanity-check the two things most likely to have regressed from
   the refactor: split view (`enterSplitView`/`exitSplitView`) and
   Ctrl+Shift+T "reopen last closed tab" — neither was touched much, but
   both interact with the same mount/unmount machinery.
4. Watch for `session.json`/restore edge cases: `restoreSession()` is
   still only ever called on the very first window (verified this holds
   given how `launchWindow`'s default `onReady` is only reached from
   `app.whenReady()`'s initial call and macOS's `activate`-with-zero-windows
   path — the latter is unreachable on this user's Windows machine anyway).
5. Once verified, clean up any temp CDP test scripts (`*.tmp.cjs` in the
   project root) before considering this done — same convention followed
   all session.

### Useful context for a fresh session

- This is a long-running feature-building session on an Electron/React
  browser app called Northstar. Prior work this session (all committed?
  — **check `git log`**, most of it may still be uncommitted alongside the
  above): app icon, session persistence across restarts
  (`SessionStore`), drag tab out → new window (`tearOffTab`), drag tab
  onto a workspace pill → move workspace (`moveTabToWorkspace`), drag tab
  onto "+ New workspace" (`createWorkspaceWithTab`), a floating
  shared drop-indicator line for tab reordering (replacing a per-tab
  box-shadow), and cross-window tab-bar dragging (superseded/simplified
  by this session's shared-registry work).
- Two-window testing requires `--remoteDebuggingPort` + Playwright
  `connectOverCDP` — see earlier turns in this conversation for the exact
  working incantations (page disambiguation, synthetic `DragEvent`
  dispatch with a real `DataTransfer`, the 50ms yield needed between a
  dispatched `dragover` and `drop` for React to actually commit its state
  update in between).
- The user has been testing manually in parallel with automated
  verification — check with them before assuming this feature is "done."
