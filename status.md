# Terminal feature — status (paused mid-debug)

## What was asked
Add a real bash terminal into the app. Each terminal is a new tab within a
workspace. Ctrl+S opens a new terminal. A toolbar button between PDF and the
magnifying glass (search tabs) also opens one.

## Decisions made (with the user, via AskUserQuestion)
- **Shell resolution**: macOS/Linux use `$SHELL`/`/bin/bash`. Windows prefers
  Git Bash (`C:\Program Files\Git\bin\bash.exe`) if present, else WSL
  (`wsl.exe`), else falls back to PowerShell/COMSPEC. See `src/main/terminal/shell.ts`.
- **Real PTY via `node-pty`** (not a plain child_process pipe) — chosen over
  the no-native-deps alternative for full interactivity (readline history,
  tab completion, full-screen apps like vim).
  - Switched from `@homebridge/node-pty-prebuilt-multiarch` to the **official
    `node-pty`** package after the homebridge fork had no prebuilt binary for
    this Electron version's ABI. Official `node-pty` ships N-API prebuilt
    binaries in the package itself (`node_modules/node-pty/prebuilds/`) — no
    native compile, no per-Electron-version rebuild needed. Verified working
    standalone under Electron's runtime before integrating.
- **Terminal tabs render in the chrome's own DOM** (`xterm.js`), NOT as a
  separate `WebContentsView` like browser tabs. Mirrors VS Code's own
  integrated terminal. Avoids a second preload/sandbox scheme and lets the
  pty persist across workspace switches the same way browser tabs already do.
- Shared tab model became a discriminated union: `BrowserTabState |
  TerminalTabState` (`src/shared/tab-state.ts`).

## What's implemented (functionally complete, pending the render bug below)
**New files:**
- `src/main/terminal/shell.ts` — per-OS shell resolution.
- `src/main/terminal/TerminalManager.ts` — owns one `node-pty` process per
  terminal tab (create/write/resize/dispose/disposeAll).
- `src/renderer/components/Terminal/Terminal.tsx` + `index.ts` — xterm.js
  wrapper, one instance per terminal tab, kept mounted (hidden via CSS, not
  unmounted) across tab switches so the pty/scrollback survive.
- `src/renderer/styles/components/terminal.css`

**Modified:**
- `package.json` — added `node-pty`, `@xterm/xterm`, `@xterm/addon-fit`.
- `electron-builder.yml` — packages `node_modules/node-pty/**/*`, unpacked
  from asar (native `.node` binaries can't load from inside an asar).
- `src/shared/tab-state.ts`, `ipc-contract.ts`, `ipc-schemas.ts` — new
  terminal channels/types (`TabsCreateTerminal`, `TerminalInput`,
  `TerminalResize`, `TerminalData` push).
- `src/main/browser/TabManager.ts` — `createTerminalTab()`,
  `sendTerminalInput()`, `resizeTerminal()`, `disposeAllTerminals()`;
  `activateTab`/`closeTab`/`focusWorkspaceDefaultTab`/`removeWorkspace`
  refactored to handle tabs with no `WebContentsView`; `patchState` narrowed
  to browser tabs, new `patchTerminalState` for terminal tabs; `toggleBookmark`
  guarded to browser tabs only; `'s'` key case added to the per-tab
  `before-input-event` handler (mirrors existing `'n'`/`'w'` handling).
- `src/main/ipc/registerTabIpc.ts`, `src/preload/index.ts` — wired the new
  channels (`sendTerminalInput`/`resizeTerminal` are fire-and-forget
  `ipcRenderer.send`, not `invoke`).
- `src/main/menu/buildMenu.ts` — "New Terminal" item, accelerator `CmdOrCtrl+S`.
- `src/main/index.ts` — `window.on('closed', () => tabManager.disposeAllTerminals())`.
- `src/renderer/App.tsx` — layout restructured: `.app-shell` is now
  `[.app, .main-row]` where `.main-row` is `[WorkspaceBar, .tab-content]`
  (`.tab-content` holds the terminal instances); toolbar shows a plain label
  instead of NavControls/AddressBar when the active tab is a terminal;
  `browserTab` narrowing helper added throughout.
- `src/renderer/hooks/useTabs.ts` — `createTerminalTab()`.
- `PageActions.tsx` — new terminal button between PDF and search-tabs (⌕).
- `TabBar.tsx` — `>_` icon for terminal tabs instead of favicon/spinner.
- `TabSearch.tsx`, `SplitIndicator.tsx`, `lib/searchTabs.ts` — narrowed for
  the tab-state union (terminal tabs have no `url`/`favicon`; hidden from
  split-view picking, since split view is browser-tab-only).
- `styles/pages/app.css` — `.main-row`, `.tab-content`, `.toolbar__terminal-label`.
- `styles/components/workspace-bar.css` — `.sidebar` no longer needs
  `flex: 1` now that it's nested one level deeper in the new row layout
  (default flex `align-items: stretch` handles its height).
- `styles/components/tab-bar.css` — `.tab-bar__terminal-icon`.
- `index.html` — links `terminal.css`.
- `tests/unit/searchTabs.spec.ts` — fixture helper now includes `kind: 'browser'`.

All of the above **typechecks clean** (`npm run typecheck`) and **builds**
(`npm run build`). Tab creation itself works end-to-end and was verified with
real OS-level clicks/keystrokes: Ctrl+S, the toolbar button, and the menu
item all correctly create exactly one terminal tab each (no double-firing —
an earlier "3 terminals from 1 press" observation was a testing artifact,
confirmed not reproducible across several clean retests).

## Current blocker: xterm.js renders nothing past the first paint
**Symptom:** after creating a terminal tab, the pty spawns correctly (bash
starts, `onData` fires with real ANSI output, confirmed via main-process
logs), and the data correctly reaches the renderer over IPC (confirmed via
renderer-side logs, `dataId === id` matches every time) — but `xterm.js`
never visibly displays it. The terminal surface stays blank.

**Isolated step by step** (via a temporary Playwright diagnostic,
`tests/e2e/terminal-debug.spec.ts` — NOT a real test, delete before
shipping):
1. Pure `xterm.js` in a bare `BrowserWindow` (no React, no Electron IPC, no
   app code) renders fine — rules out the library/Electron-Chromium version.
2. Inside the real app's React tree, a **synchronous** `term.write('...')`
   called immediately in the mount effect (right after `term.open()`)
   **works** — text appears.
3. The exact same real pty data, replayed **synchronously** (bypassing IPC
   entirely) right after `term.open()`, **fails** to render — so it's not
   about IPC/async timing, and not about StrictMode double-invoking effects
   (verified: exactly one mount, zero cleanups, during the whole flow).
4. Bisected the content: plain text (`'STATIC_TEST_TEXT\r\n'`) → renders.
   SGR-colored text with no leading newline (`'\u001b[32mGREEN_TEXT\u001b[m'`)
   → renders. But `'\r\nSECOND_LINE_TEXT\r\n'` (content landing on **row
   index 1**, not row 0) → does **not** render, even though the row divs
   already exist in the DOM (confirmed via HTML dump — they're just empty).
5. **Confirmed workaround**: calling `term.refresh(0, term.rows - 1)`
   manually (in `write()`'s completion callback) **does** force the second
   row to render correctly.

**Working theory**: xterm.js's automatic DOM-refresh scheduling (likely
`requestAnimationFrame`-based) isn't completing for anything beyond
whatever the very first paint covers, in this app's specific Electron
window/webContents setup. `term.refresh()` forcing it manually confirms the
data and DOM structure are fine — only the *automatic* refresh trigger is
broken.

## Next steps (in order to try)
1. **Try `backgroundThrottling: false`** in `MainWindow.ts`'s
   `webPreferences` first — if Electron is throttling rAF for the chrome's
   own webContents (e.g. because a tab's `WebContentsView` has focus/is
   considered foregrounded instead), this is the principled fix and might
   resolve it with no further workaround needed. Untested — try this first.
2. If that doesn't fix it, fall back to the **confirmed-working manual
   refresh**: in `Terminal.tsx`, change the `onTerminalData` handler to call
   `term.write(data, () => term.refresh(0, term.rows - 1))` instead of plain
   `term.write(data)`. Simple, confirmed to work, but a workaround rather
   than a root-cause fix — would be good to understand *why* first if time
   allows.
3. Once rendering is confirmed fixed, **remove the temporary diagnostic
   `term.write(...)` call** currently sitting in `Terminal.tsx`'s mount
   effect (the `'\r\nSECOND_LINE_TEXT\r\n'` line with the `refresh()`
   callback) — that was only there to isolate the bug.
4. **Remove all `[DEBUG]` console.log statements** added during this
   investigation:
   - `TabManager.ts` constructor (the `TerminalManager` data callback).
   - `TerminalManager.create()` (four log lines: create, spawn, onData, onExit).
   - `Terminal.tsx` (mount, cleanup, onTerminalData, resizeObserver ×2).
5. **Delete `tests/e2e/terminal-debug.spec.ts`** — temporary diagnostic only.
6. Delete scratchpad files if still present: `xterm-isolated-test.html`,
   `xterm-isolated-launcher.js` (harmless either way, outside the repo).
7. Resume full manual verification once rendering works: typing real
   commands, workspace-switch persistence (pty survives switching away and
   back), tab-close kills the pty process, multiple terminal tabs at once.
8. Run the full suite before calling it done: `npm run typecheck`,
   `npx playwright test tests/e2e` (note: `tabs.spec.ts`'s "closing the only
   tab in a workspace" test has a **pre-existing, unrelated** flaky worker-
   teardown timeout when run alongside others — not caused by this work).

## Things to flag to the user once done (not blocking, just surface them)
- **Ctrl+A** is already bound app-wide to "New Workspace" (a prior,
  deliberate decision). Bash's readline binds Ctrl+A to "move to beginning
  of line" — these now conflict inside a terminal tab.
- **Ctrl+W** closes the tab app-wide (by design, see the earlier Ctrl+W
  bug-fix work this session). Bash's readline binds Ctrl+W to "delete
  previous word" — same kind of conflict.
- Neither is fixed; worth letting the user decide whether/how to resolve
  since both are pre-existing, intentional app-wide bindings.

## Files currently containing temporary/debug code (must be cleaned up)
- `src/main/browser/TabManager.ts` — one `[DEBUG]` console.log.
- `src/main/terminal/TerminalManager.ts` — four `[DEBUG]` console.log calls.
- `src/renderer/components/Terminal/Terminal.tsx` — five `[DEBUG]`
  console.log calls, plus the temporary hardcoded
  `term.write('\r\nSECOND_LINE_TEXT\r\n', ...)` diagnostic line in the mount
  effect that must be replaced with the real fix.
- `tests/e2e/terminal-debug.spec.ts` — whole file is temporary, delete it.
